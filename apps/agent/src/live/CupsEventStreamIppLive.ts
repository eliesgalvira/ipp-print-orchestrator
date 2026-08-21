import {
  cancelSubscriptionRequest,
  createPrinterSubscriptionRequest,
  extractNotifyGetIntervalSeconds,
  extractSubscriptionId,
  getNotificationsRequest,
  IppClient,
  type IppMessage,
  type IppRequestMessage,
  makePrinter,
  notificationRecords,
} from "@ipp/ipp"
import { Effect, Layer, Schedule } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { decideCupsNotification } from "../cups-observation/CupsNotificationPolicy.js"
import { ippFailureMessage } from "../cups-observation/IppFailureMessage.js"
import { CupsIppProtocolError, CupsIppUnavailable } from "../domain/Errors.js"
import { CupsEventStream } from "../services/CupsEventStream.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

type IppClientService = Parameters<typeof IppClient.of>[0]

const queueIppUriForName = (queueName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(queueName)}`

const queueHttpUrlForName = (queueName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(queueName)}`

const executeIpp = (
  ippClient: IppClientService,
  printer: ReturnType<typeof makePrinter>,
  operation: string,
  message: IppRequestMessage | null,
): Effect.Effect<IppMessage, CupsIppUnavailable> =>
  printer.execute(operation, message).pipe(
    Effect.provideService(IppClient, ippClient),
    Effect.mapError(
      (error) =>
        new CupsIppUnavailable({
          message: String(error),
        }),
    ),
  )

const ensureSuccessfulResponse = (
  operation: string,
  response: IppMessage,
): Effect.Effect<IppMessage, CupsIppProtocolError> => {
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

const subscriptionTemplate = {
  "notify-pull-method": "ippget",
  "notify-events": ["printer-state-changed", "printer-modified"],
  "notify-lease-duration": 0,
} as const

const reconnectSchedule = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
)

export const CupsEventStreamIppLive = Layer.effect(
  CupsEventStream,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const ippClient = yield* IppClient
    const statusRuntime = yield* StatusRuntime
    const queueIppUri = queueIppUriForName(appConfig.cupsQueueName)
    const queueHttpUrl = queueHttpUrlForName(appConfig.cupsQueueName)
    const ippPrinter = makePrinter({
      endpoint: queueHttpUrl,
      language: "en",
      uri: queueIppUri,
    })

    const recordCupsDisconnected = (message: string) =>
      statusRuntime.recordCupsUnavailable({
        observationReason: "cups-stream-disconnect",
        message,
      })

    const createPrinterSubscription = () =>
      executeIpp(
        ippClient,
        ippPrinter,
        "Create-Printer-Subscriptions",
        createPrinterSubscriptionRequest(
          queueIppUri,
          "ipp-print-orchestrator",
          subscriptionTemplate,
        ),
      ).pipe(
        Effect.flatMap((response) =>
          ensureSuccessfulResponse("Create-Printer-Subscriptions", response),
        ),
        Effect.flatMap((response) => {
          const subscriptionId = extractSubscriptionId(response)
          return subscriptionId === null
            ? Effect.fail(
                new CupsIppProtocolError({
                  message:
                    "IPP subscription response missing one valid notify-subscription-id",
                }),
              )
            : Effect.succeed(subscriptionId)
        }),
      )

    const cancelSubscription = (subscriptionId: number) =>
      executeIpp(
        ippClient,
        ippPrinter,
        "Cancel-Subscription",
        cancelSubscriptionRequest(
          queueIppUri,
          "ipp-print-orchestrator",
          subscriptionId,
        ),
      ).pipe(
        Effect.flatMap((response) =>
          ensureSuccessfulResponse("Cancel-Subscription", response),
        ),
        Effect.catch(() => Effect.void),
      )

    const getNotifications = (
      subscriptionId: number,
      nextSequenceNumber: number,
    ) =>
      executeIpp(
        ippClient,
        ippPrinter,
        "Get-Notifications",
        getNotificationsRequest(
          queueIppUri,
          "ipp-print-orchestrator",
          subscriptionId,
          nextSequenceNumber,
        ),
      ).pipe(
        Effect.flatMap((response) =>
          ensureSuccessfulResponse("Get-Notifications", response),
        ),
      )

    const runNotificationSession = Effect.gen(function* () {
      const subscriptionId = yield* Effect.acquireRelease(
        createPrinterSubscription(),
        (id) => cancelSubscription(id),
      )

      yield* statusRuntime.observeNow("cups-stream-reconnect")
      let nextSequenceNumber = 1

      while (true) {
        const response = yield* getNotifications(
          subscriptionId,
          nextSequenceNumber,
        )
        const notifications = notificationRecords(response)
        const notifyGetIntervalSeconds =
          extractNotifyGetIntervalSeconds(response)
        const decision = decideCupsNotification({
          notifications,
          nextSequenceNumber,
        })
        nextSequenceNumber = decision.nextSequenceNumber

        if (decision.observePrinterStatus) {
          yield* statusRuntime.observeNow("cups-notification")
        }

        if (notifyGetIntervalSeconds !== null && notifyGetIntervalSeconds > 0) {
          yield* Effect.sleep(`${notifyGetIntervalSeconds} seconds`)
        }
      }
    })

    const run: () => Effect.Effect<never> = () =>
      Effect.scoped(
        runNotificationSession.pipe(
          Effect.catchTag("CupsIppUnavailable", (error) =>
            recordCupsDisconnected(error.message).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
          Effect.catchTag("CupsIppProtocolError", (error) =>
            recordCupsDisconnected(error.message).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
          Effect.retry(reconnectSchedule),
          Effect.catch(() => Effect.never),
        ),
      )

    return CupsEventStream.of({
      run,
    })
  }),
)
