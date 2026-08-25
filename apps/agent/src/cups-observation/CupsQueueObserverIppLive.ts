import {
  attributeGroups,
  attributeValues,
  type IppAttributeGroup,
  IppClient,
  type IppMessage,
  type IppRequestMessage,
} from "@ipp/ipp"
import { Effect, Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { CupsIppProtocolError } from "../domain/Errors.js"
import { makeCupsIppQueueClient } from "./CupsIppQueueClient.js"
import { makeCupsQueueObservation } from "./CupsQueueObservation.js"
import { CupsQueueObserver } from "./CupsQueueObserver.js"

export const printerAttributesRequestMessage = (): IppRequestMessage => ({
  "operation-attributes-tag": {
    "requested-attributes": ["all", "media-col-database"],
  },
})

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

export const CupsQueueObserverIppLive = Layer.effect(
  CupsQueueObserver,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const ippClient = yield* IppClient
    const queue = makeCupsIppQueueClient(ippClient, appConfig.cupsQueueName)

    const observeQueue = Effect.fn("CupsQueueObserver.observeQueue")(
      function* () {
        const response = yield* queue.request(
          "Get-Printer-Attributes",
          printerAttributesRequestMessage(),
        )
        const attrs = yield* singlePrinterGroup(response)
        const observedName = value(attrs, "printer-name")
        const observation = makeCupsQueueObservation({
          queueName:
            typeof observedName === "string"
              ? observedName
              : appConfig.cupsQueueName,
          acceptingJobs: value(attrs, "printer-is-accepting-jobs"),
          state: value(attrs, "printer-state"),
          reasons: value(attrs, "printer-state-reasons"),
          message: value(attrs, "printer-state-message"),
        })

        yield* Effect.annotateCurrentSpan({
          "cups.queue_available": observation.available,
          "cups.queue_state": observation.state,
          "cups.queue_name": appConfig.cupsQueueName,
          "cups.queue_uri": queue.uri,
          "cups.physical_printer_appears_attached":
            observation.physicalPrinterAppearsAttached,
        })

        return observation
      },
    )

    return CupsQueueObserver.of({ observeQueue })
  }),
)
