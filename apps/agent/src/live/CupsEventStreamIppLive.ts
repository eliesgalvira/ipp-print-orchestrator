import { createRequire } from "node:module"

import { Effect, Layer, Schedule } from "effect"
import { hostname } from "node:os"

import {
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import { AppConfig } from "../config/AppConfig.js"
import { CupsEventStream } from "../services/CupsEventStream.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

const require = createRequire(import.meta.url)
interface IppAttributeSyntax {
  readonly type: string
  readonly tag: number
  readonly min?: number
  readonly max?: number
  setof?: boolean
}

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
  readonly attributes: {
    readonly Operation: Record<string, unknown>
  }
  readonly tags: Record<string, number>
}

interface IppResponse {
  readonly statusCode?: string
  readonly ["operation-attributes-tag"]?: Record<string, unknown>
  readonly ["subscription-attributes-tag"]?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
  readonly ["event-notification-attributes-tag"]?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
}

const printerUriForName = (printerName: string): string =>
  `http://127.0.0.1:631/printers/${encodeURIComponent(printerName)}`

const installIppNotificationOperationAttributes = (): void => {
  const operationAttributes = ipp.attributes.Operation
  const requireTag = (name: string): number => {
    const value = ipp.tags[name]
    if (typeof value !== "number") {
      throw new Error(`IPP tag map missing ${name}`)
    }
    return value
  }
  const define = (name: string, syntax: IppAttributeSyntax) => {
    if (operationAttributes[name] === undefined) {
      operationAttributes[name] = syntax
    }
  }

  define("notify-subscription-ids", {
    type: "integer",
    tag: requireTag("integer"),
    min: 1,
    max: 2147483647,
    setof: true,
  })
  define("notify-sequence-numbers", {
    type: "integer",
    tag: requireTag("integer"),
    min: 1,
    max: 2147483647,
    setof: true,
  })
  define("notify-wait", {
    type: "boolean",
    tag: requireTag("boolean"),
  })
}

const requestMessage = (
  attributes: Record<string, unknown>,
  subscriptionAttributes?: Record<string, unknown>,
): Record<string, unknown> => ({
  "operation-attributes-tag": attributes,
  ...(subscriptionAttributes === undefined
    ? {}
    : { "subscription-attributes-tag": subscriptionAttributes }),
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
      new CupsIppUnavailable({
        message: String(error),
      }),
  })

const ensureSuccessfulResponse = <A extends IppResponse>(
  response: A,
): Effect.Effect<A, CupsIppProtocolError> => {
  const statusCode = response.statusCode
  if (statusCode === undefined || statusCode.startsWith("successful-ok")) {
    return Effect.succeed(response)
  }

  return Effect.fail(new CupsIppProtocolError({
    message: `IPP request failed: ${statusCode}`,
  }))
}

const singleRecord = (
  value: IppResponse["subscription-attributes-tag"],
): Record<string, unknown> | null => {
  if (value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value as Record<string, unknown>
}

export const extractSubscriptionId = (response: IppResponse): number => {
  const attrs = singleRecord(response["subscription-attributes-tag"])
  const id = attrs?.["notify-subscription-id"]
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("IPP subscription response missing notify-subscription-id")
  }
  return id
}

export const notificationRecords = (
  response: IppResponse,
): readonly Record<string, unknown>[] => {
  const attrs = response["event-notification-attributes-tag"]
  if (attrs === undefined) {
    return []
  }

  return Array.isArray(attrs) ? attrs : [attrs as Record<string, unknown>]
}

export const maxNotificationSequenceNumber = (
  notifications: readonly Record<string, unknown>[],
): number =>
  notifications.reduce((max, notification) => {
    const value = notification["notify-sequence-number"]
    return typeof value === "number" && Number.isInteger(value) && value > max
      ? value
      : max
  }, 0)

export const extractNotifyGetIntervalSeconds = (
  response: IppResponse,
): number | null => {
  const value = response["operation-attributes-tag"]?.["notify-get-interval"]
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export const getNotificationsRequestMessage = (
  printerUri: string,
  subscriptionId: number,
  nextSequenceNumber: number,
): Record<string, unknown> =>
  requestMessage({
    "printer-uri": printerUri,
    "requesting-user-name": "ipp-print-orchestrator",
    "notify-subscription-ids": [subscriptionId],
    "notify-sequence-numbers": [nextSequenceNumber],
    "notify-wait": true,
  })

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
    installIppNotificationOperationAttributes()

    const appConfig = yield* AppConfig
    const statusRuntime = yield* StatusRuntime
    const printerUri = printerUriForName(appConfig.printerName)

    const recordCupsDisconnected = (message: string, errorTag: string) =>
      statusRuntime.recordObservedStatus({
        timestamp: new Date().toISOString(),
        hostname: hostname(),
        observationReason: "cups-stream-disconnect",
        cupsReachable: false,
        printerAttached: false,
        printerQueueAvailable: false,
        printerState: null,
        printerReasons: [errorTag],
        printerMessage: message,
      }).pipe(Effect.catch(() => Effect.void))

    const createPrinterSubscription = () =>
      executeIpp(
        printerUri,
        "Create-Printer-Subscriptions",
        requestMessage(
          {
            "printer-uri": printerUri,
            "requesting-user-name": "ipp-print-orchestrator",
          },
          subscriptionTemplate,
        ),
      ).pipe(
        Effect.flatMap(ensureSuccessfulResponse),
        Effect.map((response) => extractSubscriptionId(response)),
      )

    const cancelSubscription = (subscriptionId: number) =>
      executeIpp(
        printerUri,
        "Cancel-Subscription",
        requestMessage(
          {
            "printer-uri": printerUri,
            "requesting-user-name": "ipp-print-orchestrator",
          },
          {
            "notify-subscription-id": subscriptionId,
          },
        ),
      ).pipe(
        Effect.flatMap(ensureSuccessfulResponse),
        Effect.catch(() => Effect.void),
      )

    const getNotifications = (subscriptionId: number, nextSequenceNumber: number) =>
      executeIpp(
        printerUri,
        "Get-Notifications",
        getNotificationsRequestMessage(
          printerUri,
          subscriptionId,
          nextSequenceNumber,
        ),
      ).pipe(
        Effect.flatMap(ensureSuccessfulResponse),
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

      let nextSequenceNumber = 1

      while (true) {
        const response = yield* getNotifications(subscriptionId, nextSequenceNumber)
        const notifications = notificationRecords(response)
        const maxSeen = maxNotificationSequenceNumber(notifications)
        const notifyGetIntervalSeconds = extractNotifyGetIntervalSeconds(response)

        if (maxSeen >= nextSequenceNumber) {
          nextSequenceNumber = maxSeen + 1
        }

        if (notifications.length > 0) {
          yield* statusRuntime.observeNow("cups-notification").pipe(
            Effect.catch(() => Effect.void),
          )
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
