import { createRequire } from "node:module"

import { Effect, Layer } from "effect"

import {
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import {
  CupsObserver,
} from "./CupsObserver.js"
import {
  makeJobObservation,
  makePrinterObservation,
} from "./CupsObservation.js"
import { AppConfig } from "../config/AppConfig.js"

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

interface IppResponse {
  readonly statusCode?: string
  readonly ["operation-attributes-tag"]?: Record<string, unknown>
  readonly ["unsupported-attributes-tag"]?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
  readonly ["printer-attributes-tag"]?: Record<string, unknown>
  readonly ["job-attributes-tag"]?:
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

const summarizeRecord = (value: Record<string, unknown>): string =>
  Object.entries(value)
    .map(([key, item]) => `${key}=${JSON.stringify(item)}`)
    .join(", ")

const summarizeUnsupportedAttributes = (
  value: IppResponse["unsupported-attributes-tag"],
): string | null => {
  if (value === undefined) {
    return null
  }

  const records = Array.isArray(value) ? value : [value]
  const summary = records.map(summarizeRecord).filter((item) => item.length > 0)
  return summary.length === 0 ? null : summary.join("; ")
}

export const ippFailureMessage = (response: IppResponse): string => {
  const statusCode = response.statusCode ?? "unknown"
  const statusMessage = response["operation-attributes-tag"]?.["status-message"]
  const unsupportedAttributes = summarizeUnsupportedAttributes(
    response["unsupported-attributes-tag"],
  )
  const details = [
    typeof statusMessage === "string" && statusMessage.length > 0
      ? `status-message=${JSON.stringify(statusMessage)}`
      : null,
    unsupportedAttributes === null
      ? null
      : `unsupported-attributes=${unsupportedAttributes}`,
  ].flatMap((item) => (item === null ? [] : [item]))

  return details.length === 0
    ? `IPP request failed: ${statusCode}`
    : `IPP request failed: ${statusCode} (${details.join("; ")})`
}

const executeIpp = (
  printerHttpUrl: string,
  printerIppUri: string,
  operation: string,
  message: Record<string, unknown> | null,
): Effect.Effect<IppResponse, CupsIppUnavailable> =>
  Effect.tryPromise({
    try: () =>
      new Promise<IppResponse>((resolve, reject) => {
        ipp.Printer(printerHttpUrl, {
          language: "en",
          uri: printerIppUri,
        }).execute(operation, message, (error, response) => {
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
  response: A,
): Effect.Effect<A, CupsIppProtocolError> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  return Effect.fail(new CupsIppProtocolError({
    message: ippFailureMessage(response),
  }))
}

const ensureSuccessfulJobResponse = <A extends IppResponse>(
  response: A,
): Effect.Effect<A, CupsIppProtocolError | CupsIppJobNotFound> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  if (statusCode.includes("not-found")) {
    return Effect.fail(new CupsIppJobNotFound({
      message: `IPP object not found: ${ippFailureMessage(response)}`,
    }))
  }

  return Effect.fail(new CupsIppProtocolError({
    message: ippFailureMessage(response),
  }))
}

export const CupsObserverIppLive = Layer.effect(
  CupsObserver,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const printerHttpUrl = printerHttpUrlForName(appConfig.printerName)
    const printerIppUri = printerIppUriForName(appConfig.printerName)

    const observePrinter = Effect.fn("CupsObserver.observePrinter")(function* () {
      yield* Effect.annotateCurrentSpan({
        "cups.printer_name": appConfig.printerName,
        "cups.printer_uri": printerIppUri,
      })

      const response = yield* executeIpp(
        printerHttpUrl,
        printerIppUri,
        "Get-Printer-Attributes",
        printerAttributesRequestMessage(),
      ).pipe(Effect.flatMap(ensureSuccessfulPrinterResponse))

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
    })

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
        Effect.flatMap(ensureSuccessfulJobResponse),
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
