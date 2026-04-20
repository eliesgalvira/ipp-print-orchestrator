import {
  type IppAttributeGroup,
  IppClient,
  type IppMessage,
  type IppRequestMessage,
  makePrinter,
} from "@ipp/ipp"
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

type IppResponse = IppMessage &
  IppFailureResponse & {
    readonly "printer-attributes-tag"?:
      | IppAttributeGroup
      | readonly IppAttributeGroup[]
    readonly "job-attributes-tag"?:
      | IppAttributeGroup
      | readonly IppAttributeGroup[]
  }

type IppAttributeGroups =
  | IppAttributeGroup
  | readonly IppAttributeGroup[]
  | undefined

type IppClientService = Parameters<typeof IppClient.of>[0]

const isAttributeGroupList = (
  value: IppAttributeGroups,
): value is readonly IppAttributeGroup[] => Array.isArray(value)

const singleRecord = (value: IppAttributeGroups): IppAttributeGroup | null => {
  if (value === undefined) {
    return null
  }

  if (isAttributeGroupList(value)) {
    return value[0] ?? null
  }

  return value
}

const printerHttpUrlForName = (printerName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(printerName)}`

const printerIppUriForName = (printerName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(printerName)}`

const parseJobId = (cupsJobId: string): number | null => {
  const numeric = Number(cupsJobId)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

const requestMessage = (attributes: IppAttributeGroup): IppRequestMessage => ({
  "operation-attributes-tag": attributes,
})

export const printerAttributesRequestMessage = (): IppRequestMessage =>
  requestMessage({
    "requested-attributes": ["all", "media-col-database"],
  })

export const jobAttributesRequestMessage = (jobId: number): IppRequestMessage =>
  requestMessage({
    "job-id": jobId,
  })

const executeIpp = (
  ippClient: IppClientService,
  printer: ReturnType<typeof makePrinter>,
  operation: string,
  message: IppRequestMessage | null,
): Effect.Effect<IppResponse, CupsIppUnavailable> =>
  printer.execute(operation, message).pipe(
    Effect.provideService(IppClient, ippClient),
    Effect.map((response) => response as IppResponse),
    Effect.mapError(
      (error) =>
        new CupsIppUnavailable({
          message: String(error),
        }),
    ),
  )

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
    const ippClient = yield* IppClient
    const printerHttpUrl = printerHttpUrlForName(appConfig.printerName)
    const printerIppUri = printerIppUriForName(appConfig.printerName)
    const printer = makePrinter({
      endpoint: printerHttpUrl,
      language: "en",
      uri: printerIppUri,
    })

    const observePrinter = Effect.fn("CupsObserver.observePrinter")(
      function* () {
        yield* Effect.annotateCurrentSpan({
          "cups.printer_name": appConfig.printerName,
          "cups.printer_uri": printerIppUri,
        })

        const response = yield* executeIpp(
          ippClient,
          printer,
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
        if (isAttributeGroupList(attrs)) {
          return yield* new CupsIppProtocolError({
            message: "IPP printer response repeated printer-attributes-tag",
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
        ippClient,
        printer,
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
