import { hostname } from "node:os"
import {
  cancelSubscriptionRequest,
  createPrinterSubscriptionRequest,
  extractNotifyGetIntervalSeconds,
  extractSubscriptionId,
  getNotificationsRequest,
  IppClient,
  notificationRecords,
} from "@ipp/ipp"
import { Clock, Effect, Layer, Ref, Schedule } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { makeCupsIppQueueClient } from "../cups-observation/CupsIppQueueClient.js"
import {
  type CupsJobObservation,
  cupsJobAccountingAnomaly,
  reconcileRetainedCupsJobs,
  retainedJobsRequest,
} from "../cups-observation/CupsJobObservation.js"
import { decideCupsNotification } from "../cups-observation/CupsNotificationPolicy.js"
import { CupsIppProtocolError } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { CupsEventStream } from "../services/CupsEventStream.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

const subscriptionTemplate = {
  "notify-pull-method": "ippget",
  "notify-events": [
    "printer-state-changed",
    "printer-modified",
    "job-created",
    "job-progress",
    "job-state-changed",
    "job-stopped",
    "job-completed",
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
    const statusRuntime = yield* StatusRuntime
    const wideEventPublisher = yield* WideEventPublisher
    const queue = makeCupsIppQueueClient(ippClient, appConfig.cupsQueueName)
    const retainedJobsRef = yield* Ref.make<
      ReadonlyMap<number, CupsJobObservation>
    >(new Map())

    const recordCupsDisconnected = (message: string) =>
      statusRuntime.recordCupsUnavailable({
        observationReason: "cups-stream-disconnect",
        message,
      })

    const createPrinterSubscription = () =>
      queue
        .request(
          "Create-Printer-Subscriptions",
          createPrinterSubscriptionRequest(
            queue.uri,
            "ipp-print-orchestrator",
            subscriptionTemplate,
          ),
        )
        .pipe(
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
      queue
        .request(
          "Cancel-Subscription",
          cancelSubscriptionRequest(
            queue.uri,
            "ipp-print-orchestrator",
            subscriptionId,
          ),
        )
        .pipe(Effect.catch(() => Effect.void))

    const getNotifications = (
      subscriptionId: number,
      nextSequenceNumber: number,
    ) =>
      queue.request(
        "Get-Notifications",
        getNotificationsRequest(
          queue.uri,
          "ipp-print-orchestrator",
          subscriptionId,
          nextSequenceNumber,
        ),
      )

    const observeRetainedJobs = Effect.fn(
      "CupsEventStream.observeRetainedJobs",
    )(function* (observationReason: string) {
      const response = yield* queue.request(
        "Get-Jobs",
        retainedJobsRequest(queue.uri),
      )
      const previous = yield* Ref.get(retainedJobsRef)
      const reconciliation = reconcileRetainedCupsJobs(previous, response)

      if (reconciliation._tag === "InvalidResponse") {
        return yield* new CupsIppProtocolError({
          message: reconciliation.message,
        })
      }

      yield* Ref.set(retainedJobsRef, reconciliation.current)
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const host = hostname()

      yield* Effect.forEach(
        reconciliation.changed,
        (observation) => {
          const fields = {
            timestamp: now,
            hostname: host,
            observationReason,
            cupsQueueName: appConfig.cupsQueueName,
            cupsJobId: observation.cupsJobId,
            cupsJobState: observation.state,
            cupsJobStateReasons: [...observation.reasons],
            jobMediaSheetsCompleted: observation.mediaSheetsCompleted,
            jobImpressionsCompleted: observation.impressionsCompleted,
          }
          const observedEvent = {
            eventName: "cups.job.observed",
            ...fields,
          } satisfies WideEvent
          const anomaly = cupsJobAccountingAnomaly(observation)

          return wideEventPublisher.emit(observedEvent).pipe(
            Effect.flatMap(() =>
              anomaly === null
                ? Effect.void
                : wideEventPublisher.emit({
                    eventName: "cups.job.accounting.anomaly",
                    ...fields,
                    cupsJobAccountingAnomaly: anomaly,
                  } satisfies WideEvent),
            ),
          )
        },
        { discard: true },
      )
    })

    const runNotificationSession = Effect.gen(function* () {
      const subscriptionId = yield* Effect.acquireRelease(
        createPrinterSubscription(),
        (id) => cancelSubscription(id),
      )

      yield* statusRuntime.observeNow("cups-stream-reconnect")
      yield* observeRetainedJobs("cups-stream-reconnect")
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

        if (decision.observeRetainedJobs) {
          yield* observeRetainedJobs("cups-notification")
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
