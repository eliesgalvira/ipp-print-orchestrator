import { createRequire } from "node:module"
import { hostname } from "node:os"
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

const require = createRequire(import.meta.url)

const http = require("node:http") as typeof import("node:http")
const https = require("node:https") as typeof import("node:https")
const { Buffer } = require("node:buffer") as typeof import("node:buffer")
const ipp = require("ipp") as {
  readonly parse: (buffer: Buffer) => Record<string, unknown>
  readonly operations: Record<string, number | undefined>
  readonly versions: Record<string, number | undefined>
  readonly tags: Record<string, number | undefined> & {
    readonly lookup: readonly string[]
  }
  readonly attributes: Record<string, Record<string, IppAttributeSyntax> | undefined>
}

interface IppAttributeSyntax {
  readonly type: string
  readonly tag?: number
  readonly members?: Record<string, IppAttributeSyntax>
}

interface IppResponse extends IppFailureResponse {
  readonly "subscription-attributes-tag"?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
  readonly "event-notification-attributes-tag"?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
}

const printerUriForName = (printerName: string): string =>
  `ipp://localhost:631/printers/${encodeURIComponent(printerName)}`

const printerHttpUrlForName = (printerName: string): string =>
  `http://localhost:631/printers/${encodeURIComponent(printerName)}`

const requestMessage = (
  attributes: Record<string, unknown>,
  subscriptionAttributes?: Record<string, unknown>,
): Record<string, unknown> => ({
  "operation-attributes-tag": attributes,
  ...(subscriptionAttributes === undefined
    ? {}
    : { "subscription-attributes-tag": subscriptionAttributes }),
})

const specialOperationAttributesOrder = new Map([
  ["attributes-charset", 1],
  ["attributes-natural-language", 2],
  ["printer-uri", 3],
  ["job-id", 4],
  ["job-uri", 5],
])

const specialOperationAttributes = (
  keys: readonly string[],
): readonly string[] =>
  [...keys].sort(
    (left, right) =>
      (specialOperationAttributesOrder.get(left) ?? 10) -
      (specialOperationAttributesOrder.get(right) ?? 10),
  )

const requireNumber = (value: number | undefined, name: string): number => {
  if (typeof value !== "number") {
    throw new Error(`IPP table missing numeric value for ${name}`)
  }
  return value
}

const requireGroupAttributes = (
  groupName: string,
): Record<string, IppAttributeSyntax> => {
  const value = ipp.attributes[groupName]
  if (value === undefined) {
    throw new Error(`IPP attribute table missing group ${groupName}`)
  }
  return value
}

const requireOperationCode = (operation: string): number =>
  requireNumber(ipp.operations[operation], `operation ${operation}`)

const requireVersionCode = (version: string): number =>
  requireNumber(ipp.versions[version], `version ${version}`)

const requireTag = (name: string): number =>
  requireNumber(ipp.tags[name], `tag ${name}`)

const operationAttributes = {
  ...requireGroupAttributes("Operation"),
  "notify-subscription-ids": {
    type: "integer",
    tag: requireTag("integer"),
  },
  "notify-sequence-numbers": {
    type: "integer",
    tag: requireTag("integer"),
  },
  "notify-wait": {
    type: "boolean",
    tag: requireTag("boolean"),
  },
} satisfies Record<string, IppAttributeSyntax>

const subscriptionAttributes = {
  ...requireGroupAttributes("Subscription Template"),
  ...requireGroupAttributes("Subscription Description"),
} satisfies Record<string, IppAttributeSyntax>

const groupDefinitions = [
  {
    tagName: "operation-attributes-tag",
    groupNames: [operationAttributes] as const,
  },
  {
    tagName: "job-attributes-tag",
    groupNames: [
      requireGroupAttributes("Job Template"),
      requireGroupAttributes("Job Description"),
    ] as const,
  },
  {
    tagName: "printer-attributes-tag",
    groupNames: [requireGroupAttributes("Printer Description")] as const,
  },
  {
    tagName: "document-attributes-tag",
    groupNames: [requireGroupAttributes("Document Description")] as const,
  },
  {
    tagName: "subscription-attributes-tag",
    groupNames: [subscriptionAttributes] as const,
  },
] as const

class BufferWriter {
  private readonly chunks: Buffer[] = []

  writeUInt8(value: number): void {
    const chunk = Buffer.allocUnsafe(1)
    chunk.writeUInt8(value)
    this.chunks.push(chunk)
  }

  writeUInt16BE(value: number): void {
    const chunk = Buffer.allocUnsafe(2)
    chunk.writeUInt16BE(value)
    this.chunks.push(chunk)
  }

  writeUInt32BE(value: number): void {
    const chunk = Buffer.allocUnsafe(4)
    chunk.writeUInt32BE(value)
    this.chunks.push(chunk)
  }

  writeString(value: string, encoding: BufferEncoding = "utf8"): void {
    const chunk = Buffer.from(value, encoding)
    this.writeUInt16BE(chunk.length)
    this.chunks.push(chunk)
  }

  writeRaw(buffer: Buffer): void {
    this.chunks.push(buffer)
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

const resolveAttributeSyntax = (
  groups: readonly Record<string, IppAttributeSyntax>[],
  name: string,
): IppAttributeSyntax => {
  for (const group of groups) {
    const syntax = group[name]
    if (syntax !== undefined) {
      return syntax
    }
  }

  throw new Error(`Unknown IPP attribute: ${name}`)
}

const resolveValueTag = (
  syntax: IppAttributeSyntax,
  value: unknown,
): number => {
  if (syntax.tag !== undefined) {
    return syntax.tag
  }

  switch (syntax.type) {
    case "name":
      return typeof value === "string" && value.includes("\u001e")
        ? requireTag("nameWithLanguage")
        : requireTag("nameWithoutLanguage")
    case "text":
      return typeof value === "string" && value.includes("\u001e")
        ? requireTag("textWithLanguage")
        : requireTag("textWithoutLanguage")
    default:
      return requireTag(syntax.type)
  }
}

const writeValue = (
  writer: BufferWriter,
  syntax: IppAttributeSyntax,
  value: unknown,
): void => {
  const tag = resolveValueTag(syntax, value)
  switch (tag) {
    case requireTag("integer"): {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`Expected integer value for ${syntax.type}`)
      }
      writer.writeUInt16BE(4)
      writer.writeUInt32BE(value)
      return
    }

    case requireTag("boolean"): {
      if (typeof value !== "boolean") {
        throw new Error(`Expected boolean value for ${syntax.type}`)
      }
      writer.writeUInt16BE(1)
      writer.writeUInt8(value ? 1 : 0)
      return
    }

    case requireTag("keyword"):
    case requireTag("uri"):
    case requireTag("uriScheme"):
    case requireTag("charset"):
    case requireTag("naturalLanguage"):
    case requireTag("mimeMediaType"): {
      if (typeof value !== "string") {
        throw new Error(`Expected string value for ${syntax.type}`)
      }
      writer.writeString(value, "ascii")
      return
    }

    case requireTag("nameWithoutLanguage"):
    case requireTag("textWithoutLanguage"):
    case requireTag("octetString"):
    case requireTag("memberAttrName"): {
      if (typeof value !== "string") {
        throw new Error(`Expected string value for ${syntax.type}`)
      }
      writer.writeString(value)
      return
    }

    case requireTag("nameWithLanguage"):
    case requireTag("textWithLanguage"): {
      if (typeof value !== "string") {
        throw new Error(`Expected string value for ${syntax.type}`)
      }

      const separator = value.indexOf("\u001e")
      if (separator < 0) {
        throw new Error(
          `Expected language-qualified string value for ${syntax.type}`,
        )
      }

      const language = value.slice(0, separator)
      const text = value.slice(separator + 1)

      writer.writeUInt16BE(Buffer.byteLength(language, "utf8"))
      writer.writeRaw(Buffer.from(language, "utf8"))
      writer.writeUInt16BE(Buffer.byteLength(text, "utf8"))
      writer.writeRaw(Buffer.from(text, "utf8"))
      return
    }

    default:
      throw new Error(`Unsupported IPP tag ${tag} for ${syntax.type}`)
  }
}

const writeAttribute = (
  writer: BufferWriter,
  groups: readonly Record<string, IppAttributeSyntax>[],
  name: string,
  rawValue: unknown,
): void => {
  const syntax = resolveAttributeSyntax(groups, name)
  const values = Array.isArray(rawValue) ? rawValue : [rawValue]

  values.forEach((value, index) => {
    writer.writeUInt8(resolveValueTag(syntax, value))
    if (index === 0) {
      writer.writeString(name)
    } else {
      writer.writeUInt16BE(0)
    }
    writeValue(writer, syntax, value)
  })
}

export const serializeIppRequest = (
  operation: string,
  printerIppUri: string,
  message: Record<string, unknown> | null,
): Buffer => {
  const writer = new BufferWriter()
  const version = "2.0"
  const requestId = Math.floor(Math.random() * 100_000_000)
  const operationAttributesTag = {
    "attributes-charset": "utf-8",
    "attributes-natural-language": "en",
    "printer-uri": printerIppUri,
    ...((message?.["operation-attributes-tag"] as Record<string, unknown> | undefined) ??
      {}),
  }

  const fullMessage: Record<string, unknown> = {
    ...(message ?? {}),
    version,
    operation,
    id: requestId,
    "operation-attributes-tag": operationAttributesTag,
  }

  writer.writeUInt16BE(requireVersionCode(version))
  writer.writeUInt16BE(requireOperationCode(operation))
  writer.writeUInt32BE(requestId)

  for (const group of groupDefinitions) {
    const attrs = fullMessage[group.tagName] as Record<string, unknown> | undefined
    if (attrs === undefined) {
      continue
    }

    const keys =
      group.tagName === "operation-attributes-tag"
        ? specialOperationAttributes(Object.keys(attrs))
        : Object.keys(attrs)

    writer.writeUInt8(requireTag(group.tagName))
    for (const key of keys) {
      writeAttribute(writer, group.groupNames, key, attrs[key])
    }
  }

  writer.writeUInt8(0x03)
  return writer.finish()
}

const postIpp = (
  printerHttpUrl: string,
  body: Buffer,
): Promise<IppResponse> =>
  new Promise<IppResponse>((resolve, reject) => {
    const url = new URL(printerHttpUrl)
    const transport = url.protocol === "https:" ? https : http
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === "" ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/ipp",
          "Content-Length": String(body.length),
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Received unexpected response status ${response.statusCode ?? "unknown"} from the printer`,
            ),
          )
          return
        }

        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on("end", () => {
          try {
            resolve(ipp.parse(Buffer.concat(chunks)) as IppResponse)
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on("error", reject)
    request.write(body)
    request.end()
  })

const executeIpp = (
  printerHttpUrl: string,
  printerIppUri: string,
  operation: string,
  message: Record<string, unknown> | null,
): Effect.Effect<IppResponse, CupsIppUnavailable> =>
  Effect.tryPromise({
    try: () =>
      postIpp(
        printerHttpUrl,
        serializeIppRequest(operation, printerIppUri, message),
      ),
    catch: (error) =>
      new CupsIppUnavailable({
        message: String(error),
      }),
  })

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
  notifications: readonly Record<string, unknown>[],
): boolean =>
  notifications.some((notification) => {
    const eventName = notification["notify-subscribed-event"]
    return typeof eventName === "string" && jobNotificationEvents.has(eventName)
  })

export const notificationsIncludePrinterEvent = (
  notifications: readonly Record<string, unknown>[],
): boolean =>
  notifications.some((notification) => {
    const eventName = notification["notify-subscribed-event"]
    return (
      typeof eventName === "string" && printerNotificationEvents.has(eventName)
    )
  })

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
    const appConfig = yield* AppConfig
    const reconciler = yield* Reconciler
    const statusRuntime = yield* StatusRuntime
    const printerUri = printerUriForName(appConfig.printerName)
    const printerHttpUrl = printerHttpUrlForName(appConfig.printerName)

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
        printerHttpUrl,
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
        Effect.flatMap((response) =>
          ensureSuccessfulResponse("Create-Printer-Subscriptions", response),
        ),
        Effect.map((response) => extractSubscriptionId(response)),
      )

    const cancelSubscription = (subscriptionId: number) =>
      executeIpp(
        printerHttpUrl,
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
        printerHttpUrl,
        printerUri,
        "Get-Notifications",
        getNotificationsRequestMessage(
          printerUri,
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
