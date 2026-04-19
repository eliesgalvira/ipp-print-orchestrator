import { createRequire } from "node:module"

import { Effect, Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import {
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import {
  makeJobObservation,
  makePrinterObservation,
} from "./CupsObservation.js"
import { CupsObserver } from "./CupsObserver.js"
import {
  type IppFailureResponse,
  ippFailureMessage,
} from "./IppFailureMessage.js"

const require = createRequire(import.meta.url)
const ipp = require("ipp") as {
  readonly Printer: (
    url: string,
    options?: {
      readonly uri?: string
      readonly language?: string
      readonly version?: string
    },
  ) => {
    readonly execute: (
      operation: string,
      message: Record<string, unknown> | null,
      callback: (error: unknown, response: Record<string, unknown>) => void,
    ) => void
  }
}

interface IppResponse extends IppFailureResponse {
  readonly "printer-attributes-tag"?: Record<string, unknown>
  readonly "job-attributes-tag"?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
}

const singleRecord = (
  value: IppResponse["job-attributes-tag"],
): Record<string, unknown> | null => {
  if (value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value as Record<string, unknown>
}

const printerHttpUrlForName = (printerName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(printerName)}`

const printerIppUriForName = (printerName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(printerName)}`

const parseJobId = (cupsJobId: string): number | null => {
  const numeric = Number(cupsJobId)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

const requestMessage = (
  attributes: Record<string, unknown>,
): Record<string, unknown> => ({
  "operation-attributes-tag": attributes,
})

export const printerAttributesRequestMessage = (): Record<string, unknown> =>
  requestMessage({
    "requested-attributes": ["all", "media-col-database"],
  })

export const jobAttributesRequestMessage = (
  jobId: number,
): Record<string, unknown> =>
  requestMessage({
    "job-id": jobId,
  })

const executeIpp = (
  printerHttpUrl: string,
  printerIppUri: string,
  operation: string,
  message: Record<string, unknown> | null,
): Effect.Effect<IppResponse, CupsIppUnavailable> =>
  Effect.tryPromise({
    try: () =>
      new Promise<IppResponse>((resolve, reject) => {
        ipp
          .Printer(printerHttpUrl, {
            language: "en",
            uri: printerIppUri,
          })
          .execute(operation, message, (error, response) => {
            if (error) {
              reject(error)
              return
            }

            resolve(response as IppResponse)
          })
      }),
    catch: (error) =>
      new CupsIppUnavailable({
        message: String(error),
      }),
  })

const ensureSuccessfulPrinterResponse = <A extends IppResponse>(
  operation: string,
  response: A,
): Effect.Effect<A, CupsIppProtocolError> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  return Effect.fail(
    new CupsIppProtocolError({
      message: ippFailureMessage(response, { operation }),
    }),
  )
}

const ensureSuccessfulJobResponse = <A extends IppResponse>(
  operation: string,
  response: A,
): Effect.Effect<A, CupsIppProtocolError | CupsIppJobNotFound> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  if (statusCode.includes("not-found")) {
    return Effect.fail(
      new CupsIppJobNotFound({
        message: `IPP object not found: ${ippFailureMessage(response, { operation })}`,
      }),
    )
  }

  return Effect.fail(
    new CupsIppProtocolError({
      message: ippFailureMessage(response, { operation }),
    }),
  )
}

export const CupsObserverIppLive = Layer.effect(
  CupsObserver,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const printerHttpUrl = printerHttpUrlForName(appConfig.printerName)
    const printerIppUri = printerIppUriForName(appConfig.printerName)

    const observePrinter = Effect.fn("CupsObserver.observePrinter")(
      function* () {
        yield* Effect.annotateCurrentSpan({
          "cups.printer_name": appConfig.printerName,
          "cups.printer_uri": printerIppUri,
        })

        const response = yield* executeIpp(
          printerHttpUrl,
          printerIppUri,
          "Get-Printer-Attributes",
          printerAttributesRequestMessage(),
        ).pipe(
          Effect.flatMap((response) =>
            ensureSuccessfulPrinterResponse("Get-Printer-Attributes", response),
          ),
        )

        const attrs = response["printer-attributes-tag"]
        if (attrs === undefined) {
          return yield* new CupsIppProtocolError({
            message: "IPP printer response missing printer-attributes-tag",
          })
        }

        const observation = makePrinterObservation({
          printerName:
            typeof attrs["printer-name"] === "string"
              ? attrs["printer-name"]
              : appConfig.printerName,
          acceptingJobs: attrs["printer-is-accepting-jobs"],
          state: attrs["printer-state"],
          reasons: attrs["printer-state-reasons"],
          message: attrs["printer-state-message"],
        })

        yield* Effect.annotateCurrentSpan({
          "cups.printer_attached": observation.attached,
          "cups.printer_queue_available": observation.queueAvailable,
          "cups.printer_state": observation.state,
        })

        return observation
      },
    )

    const observeJob = Effect.fn("CupsObserver.observeJob")(function* (
      cupsJobId: string,
    ) {
      yield* Effect.annotateCurrentSpan({
        "cups.job_id": cupsJobId,
        "cups.printer_name": appConfig.printerName,
      })

      const jobId = parseJobId(cupsJobId)
      if (jobId === null) {
        return yield* new CupsIppProtocolError({
          message: `Invalid numeric CUPS job id: ${cupsJobId}`,
        })
      }

      const response = yield* executeIpp(
        printerHttpUrl,
        printerIppUri,
        "Get-Job-Attributes",
        jobAttributesRequestMessage(jobId),
      ).pipe(
        Effect.flatMap((response) =>
          ensureSuccessfulJobResponse("Get-Job-Attributes", response),
        ),
        Effect.catchTag("CupsIppJobNotFound", () => Effect.succeed(null)),
      )

      if (response === null) {
        return null
      }

      const attrs = singleRecord(response["job-attributes-tag"])
      if (attrs === null) {
        return yield* new CupsIppProtocolError({
          message: `IPP job response missing job-attributes-tag for ${cupsJobId}`,
        })
      }

      const observation = makeJobObservation({
        cupsJobId,
        state: attrs["job-state"],
        reasons: attrs["job-state-reasons"],
        printerState: attrs["job-printer-state"],
        printerStateReasons: attrs["job-printer-state-reasons"],
        printerStateMessage: attrs["job-printer-state-message"],
        mediaSheetsCompleted: attrs["job-media-sheets-completed"],
      })

      yield* Effect.annotateCurrentSpan({
        "cups.job_state": observation.state,
      })

      return observation
    })

    return CupsObserver.of({
      observePrinter,
      observeJob,
    })
  }),
)
