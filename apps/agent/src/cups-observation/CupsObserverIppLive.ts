import {
  attributeGroups,
  attributeValues,
  type IppAttributeGroup,
  type IppAttributeMap,
  IppClient,
  type IppMessage,
  type IppRequestMessage,
  makePrinter,
} from "@ipp/ipp"
import { Effect, Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { CupsIppProtocolError, CupsIppUnavailable } from "../domain/Errors.js"
import { makePrinterObservation } from "./CupsObservation.js"
import { CupsObserver } from "./CupsObserver.js"
import { ippFailureMessage } from "./IppFailureMessage.js"

type IppClientService = Parameters<typeof IppClient.of>[0]

const printerHttpUrlForName = (printerName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(printerName)}`

const printerIppUriForName = (printerName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(printerName)}`

const requestMessage = (attributes: IppAttributeMap): IppRequestMessage => ({
  "operation-attributes-tag": attributes,
})

export const printerAttributesRequestMessage = (): IppRequestMessage =>
  requestMessage({
    "requested-attributes": ["all", "media-col-database"],
  })

const executeIpp = (
  ippClient: IppClientService,
  printer: ReturnType<typeof makePrinter>,
  operation: string,
  message: IppRequestMessage,
): Effect.Effect<IppMessage, CupsIppUnavailable> =>
  printer.execute(operation, message).pipe(
    Effect.provideService(IppClient, ippClient),
    Effect.mapError(
      (error) => new CupsIppUnavailable({ message: String(error) }),
    ),
  )

const ensureSuccessfulResponse = (
  operation: string,
  response: IppMessage,
): Effect.Effect<IppMessage, CupsIppProtocolError> =>
  response.statusCode === undefined ||
  response.statusCode.startsWith("successful-ok")
    ? Effect.succeed(response)
    : Effect.fail(
        new CupsIppProtocolError({
          message: ippFailureMessage(response, { operation }),
        }),
      )

const singlePrinterGroup = (
  response: IppMessage,
): Effect.Effect<IppAttributeGroup, CupsIppProtocolError> => {
  const groups = attributeGroups(response, "printer-attributes-tag")
  const group = groups[0]
  if (groups.length !== 1 || group === undefined) {
    return Effect.fail(
      new CupsIppProtocolError({
        message: `IPP printer response expected one printer-attributes-tag, received ${groups.length}`,
      }),
    )
  }
  return Effect.succeed(group)
}

const value = (group: IppAttributeGroup, name: string): unknown => {
  const values = attributeValues(group, name)
  return values.length === 1 ? values[0] : undefined
}

export const CupsObserverIppLive = Layer.effect(
  CupsObserver,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const ippClient = yield* IppClient
    const printerIppUri = printerIppUriForName(appConfig.printerName)
    const printer = makePrinter({
      endpoint: printerHttpUrlForName(appConfig.printerName),
      language: "en",
      uri: printerIppUri,
    })

    const observePrinter = Effect.fn("CupsObserver.observePrinter")(
      function* () {
        const response = yield* executeIpp(
          ippClient,
          printer,
          "Get-Printer-Attributes",
          printerAttributesRequestMessage(),
        ).pipe(
          Effect.flatMap((response) =>
            ensureSuccessfulResponse("Get-Printer-Attributes", response),
          ),
        )
        const attrs = yield* singlePrinterGroup(response)
        const observedName = value(attrs, "printer-name")
        const observation = makePrinterObservation({
          printerName:
            typeof observedName === "string"
              ? observedName
              : appConfig.printerName,
          acceptingJobs: value(attrs, "printer-is-accepting-jobs"),
          state: value(attrs, "printer-state"),
          reasons: value(attrs, "printer-state-reasons"),
          message: value(attrs, "printer-state-message"),
        })

        yield* Effect.annotateCurrentSpan({
          "cups.printer_attached": observation.attached,
          "cups.printer_queue_available": observation.queueAvailable,
          "cups.printer_state": observation.state,
          "cups.printer_name": appConfig.printerName,
          "cups.printer_uri": printerIppUri,
        })

        return observation
      },
    )

    return CupsObserver.of({ observePrinter })
  }),
)
