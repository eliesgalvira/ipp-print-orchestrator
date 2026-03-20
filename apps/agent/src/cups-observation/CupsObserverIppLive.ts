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

const printerUriForName = (printerName: string): string =>
  `http://127.0.0.1:631/printers/${encodeURIComponent(printerName)}`

const parseJobId = (cupsJobId: string): number | null => {
  const numeric = Number(cupsJobId)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

const requestMessage = (
  attributes: Record<string, unknown>,
): Record<string, unknown> => ({
  "operation-attributes-tag": attributes,
})

const executeIpp = (
  printerUri: string,
  operation: string,
  message: Record<string, unknown> | null,
): Effect.Effect<IppResponse, CupsIppUnavailable> =>
  Effect.tryPromise({
    try: () =>
      new Promise<IppResponse>((resolve, reject) => {
        ipp.Printer(printerUri).execute(operation, message, (error, response) => {
          if (error) {
            reject(error)
            return
          }

          resolve(response as IppResponse)
        })
      }),
    catch: (error) =>
      CupsIppUnavailable.make({
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

  return CupsIppProtocolError.make({
    message: `IPP request failed: ${statusCode}`,
  })
}

const ensureSuccessfulJobResponse = <A extends IppResponse>(
  response: A,
): Effect.Effect<A, CupsIppProtocolError | CupsIppJobNotFound> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  if (statusCode.includes("not-found")) {
    return CupsIppJobNotFound.make({
      message: `IPP object not found: ${statusCode}`,
    })
  }

  return CupsIppProtocolError.make({
    message: `IPP request failed: ${statusCode}`,
  })
}

export const CupsObserverIppLive = Layer.effect(
  CupsObserver,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const printerUri = printerUriForName(appConfig.printerName)

    const observePrinter = Effect.fn("CupsObserver.observePrinter")(function* () {
      yield* Effect.annotateCurrentSpan({
        "cups.printer_name": appConfig.printerName,
        "cups.printer_uri": printerUri,
      })

      const response = yield* executeIpp(
        printerUri,
        "Get-Printer-Attributes",
        requestMessage({
          "requested-attributes": [
            "printer-name",
            "printer-state",
            "printer-state-reasons",
            "printer-state-message",
            "printer-is-accepting-jobs",
          ],
        }),
      ).pipe(Effect.flatMap(ensureSuccessfulPrinterResponse))

      const attrs = response["printer-attributes-tag"]
      if (attrs === undefined) {
        return yield* CupsIppProtocolError.make({
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
        return yield* CupsIppProtocolError.make({
          message: `Invalid numeric CUPS job id: ${cupsJobId}`,
        })
      }

      const response = yield* executeIpp(
        printerUri,
        "Get-Job-Attributes",
        requestMessage({
          "job-id": jobId,
          "requested-attributes": [
            "job-id",
            "job-state",
            "job-state-reasons",
            "job-media-sheets-completed",
            "job-printer-state-message",
            "job-printer-state-reasons",
            "job-printer-up-time",
            "job-printer-uri",
          ],
        }),
      ).pipe(
        Effect.flatMap(ensureSuccessfulJobResponse),
        Effect.catchTag("CupsIppJobNotFound", () => Effect.succeed(null)),
      )

      if (response === null) {
        return null
      }

      const attrs = singleRecord(response["job-attributes-tag"])
      if (attrs === null) {
        return yield* CupsIppProtocolError.make({
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
