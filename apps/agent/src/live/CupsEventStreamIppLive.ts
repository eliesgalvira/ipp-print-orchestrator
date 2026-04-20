import { hostname } from "node:os"
import {
  cancelSubscriptionRequest,
  createPrinterSubscriptionRequest,
  extractNotifyGetIntervalSeconds,
  extractSubscriptionId,
  getNotificationsRequest,
  type IppAttributeGroup,
  IppClient,
  type IppMessage,
  type IppRequestMessage,
  makePrinter,
  maxNotificationSequenceNumber,
  notificationIncludesEvent,
  notificationRecords,
} from "@ipp/ipp"
import { Effect, Layer, Schedule } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import {
  type IppFailureResponse,
  ippFailureMessage,
} from "../cups-observation/IppFailureMessage.js"
import { CupsIppProtocolError, CupsIppUnavailable } from "../domain/Errors.js"
import { CupsEventStream } from "../services/CupsEventStream.js"
import { Reconciler } from "../services/Reconciler.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

type IppResponse = IppMessage &
  IppFailureResponse & {
    readonly "subscription-attributes-tag"?:
      | IppAttributeGroup
      | readonly IppAttributeGroup[]
    readonly "event-notification-attributes-tag"?:
      | IppAttributeGroup
      | readonly IppAttributeGroup[]
  }

type IppClientService = Parameters<typeof IppClient.of>[0]

const printerUriForName = (printerName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(printerName)}`

const printerHttpUrlForName = (printerName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(printerName)}`

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

const ensureSuccessfulResponse = <A extends IppResponse>(
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

const jobNotificationEvents = new Set([
  "job-completed",
  "job-created",
  "job-progress",
  "job-stopped",
])

const printerNotificationEvents = new Set([
  "printer-modified",
  "printer-state-changed",
])

export const notificationsIncludeJobEvent = (
  notifications: readonly IppAttributeGroup[],
): boolean => notificationIncludesEvent(notifications, jobNotificationEvents)

export const notificationsIncludePrinterEvent = (
  notifications: readonly IppAttributeGroup[],
): boolean =>
  notificationIncludesEvent(notifications, printerNotificationEvents)

const subscriptionTemplate = {
  "notify-pull-method": "ippget",
  "notify-events": [
    "printer-state-changed",
    "printer-modified",
    "job-completed",
    "job-created",
    "job-progress",
    "job-stopped",
  ],
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
    const reconciler = yield* Reconciler
    const statusRuntime = yield* StatusRuntime
    const printerUri = printerUriForName(appConfig.printerName)
    const printerHttpUrl = printerHttpUrlForName(appConfig.printerName)
    const printer = makePrinter({
      endpoint: printerHttpUrl,
      language: "en",
      uri: printerUri,
    })

    const recordCupsDisconnected = (message: string, errorTag: string) =>
      statusRuntime
        .recordObservedStatus({
          timestamp: new Date().toISOString(),
          hostname: hostname(),
          observationReason: "cups-stream-disconnect",
          cupsReachable: false,
          printerQueueAvailable: false,
          printerState: null,
          printerReasons: [errorTag],
          printerMessage: message,
        })
        .pipe(Effect.catch(() => Effect.void))

    const createPrinterSubscription = () =>
      executeIpp(
        ippClient,
        printer,
        "Create-Printer-Subscriptions",
        createPrinterSubscriptionRequest(
          printerUri,
          "ipp-print-orchestrator",
          subscriptionTemplate,
        ),
      ).pipe(
        Effect.flatMap((response) =>
          ensureSuccessfulResponse("Create-Printer-Subscriptions", response),
        ),
        Effect.map((response) => extractSubscriptionId(response)),
      )

    const cancelSubscription = (subscriptionId: number) =>
      executeIpp(
        ippClient,
        printer,
        "Cancel-Subscription",
        cancelSubscriptionRequest(
          printerUri,
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
        printer,
        "Get-Notifications",
        getNotificationsRequest(
          printerUri,
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

      yield* statusRuntime.observeNow("cups-stream-reconnect").pipe(
        Effect.catch(() =>
          statusRuntime.recordObservedStatus({
            timestamp: new Date().toISOString(),
            hostname: hostname(),
            observationReason: "cups-stream-reconnect",
            cupsReachable: true,
          }),
        ),
      )
      yield* reconciler
        .repairCupsTrackedJobs()
        .pipe(Effect.catch(() => Effect.void))

      let nextSequenceNumber = 1

      while (true) {
        const response = yield* getNotifications(
          subscriptionId,
          nextSequenceNumber,
        )
        const notifications = notificationRecords(response)
        const maxSeen = maxNotificationSequenceNumber(notifications)
        const notifyGetIntervalSeconds =
          extractNotifyGetIntervalSeconds(response)
        const hasJobEvent = notificationsIncludeJobEvent(notifications)
        const hasPrinterEvent = notificationsIncludePrinterEvent(notifications)

        if (maxSeen >= nextSequenceNumber) {
          nextSequenceNumber = maxSeen + 1
        }

        if (hasPrinterEvent) {
          yield* statusRuntime
            .observeNow("cups-notification")
            .pipe(Effect.catch(() => Effect.void))
        }

        if (hasJobEvent) {
          yield* reconciler
            .repairCupsTrackedJobs()
            .pipe(Effect.catch(() => Effect.void))
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
            recordCupsDisconnected(error.message, error._tag).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
          Effect.catchTag("CupsIppProtocolError", (error) =>
            recordCupsDisconnected(error.message, error._tag).pipe(
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
