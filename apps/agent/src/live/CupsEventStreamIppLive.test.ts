import { createRequire } from "node:module"

import { describe, expect, it } from "@effect/vitest"

import {
  extractNotifyGetIntervalSeconds,
  extractSubscriptionId,
  getNotificationsRequestMessage,
  maxNotificationSequenceNumber,
  notificationRecords,
  notificationsIncludeJobEvent,
  notificationsIncludePrinterEvent,
  serializeIppRequest,
} from "./CupsEventStreamIppLive.js"

const require = createRequire(import.meta.url)
const ipp = require("ipp") as {
  readonly parse: (buffer: Buffer) => Record<string, unknown>
}

describe("CupsEventStreamIppLive", () => {
  it("extracts subscription ids from IPP subscription responses", () => {
    expect(
      extractSubscriptionId({
        "subscription-attributes-tag": {
          "notify-subscription-id": 42,
        },
      }),
    ).toBe(42)
  })

  it("normalizes notification records from singular and repeated responses", () => {
    expect(
      notificationRecords({
        "event-notification-attributes-tag": {
          "notify-sequence-number": 3,
          "notify-subscribed-event": "printer-state-changed",
        },
      }),
    ).toHaveLength(1)

    expect(
      notificationRecords({
        "event-notification-attributes-tag": [
          { "notify-sequence-number": 4 },
          { "notify-sequence-number": 5 },
        ],
      }),
    ).toHaveLength(2)
  })

  it("tracks the highest seen notification sequence number", () => {
    expect(
      maxNotificationSequenceNumber([
        { "notify-sequence-number": 2 },
        { "notify-sequence-number": 7 },
        { "notify-sequence-number": 4 },
      ]),
    ).toBe(7)
  })

  it("extracts notify-get-interval when the printer asks the client to retry later", () => {
    expect(
      extractNotifyGetIntervalSeconds({
        "operation-attributes-tag": {
          "notify-get-interval": 12,
        },
      }),
    ).toBe(12)

    expect(
      extractNotifyGetIntervalSeconds({
        "operation-attributes-tag": {},
      }),
    ).toBeNull()
  })

  it("builds Get-Notifications requests in event wait mode", () => {
    expect(
      getNotificationsRequestMessage(
        "ipp://localhost:631/printers/Test_Printer",
        42,
        9,
      ),
    ).toEqual({
      "operation-attributes-tag": {
        "printer-uri": "ipp://localhost:631/printers/Test_Printer",
        "requesting-user-name": "ipp-print-orchestrator",
        "notify-subscription-ids": [42],
        "notify-sequence-numbers": [9],
        "notify-wait": true,
      },
    })
  })

  it("preserves subscription attributes when the request is serialized", () => {
    const operationAttributes = {
      "attributes-charset": "utf-8",
      "attributes-natural-language": "en",
      "printer-uri": "ipp://localhost:631/printers/Test_Printer",
      "requesting-user-name": "ipp-print-orchestrator",
    }
    const subscriptionAttributes = {
      "notify-pull-method": "ippget",
      "notify-events": [
        "printer-state-changed",
        "printer-modified",
      ],
      "notify-lease-duration": 0,
    }

    const bytes = serializeIppRequest(
      "Create-Printer-Subscriptions",
      "ipp://localhost:631/printers/Test_Printer",
      {
        "operation-attributes-tag": {
          "requesting-user-name": "ipp-print-orchestrator",
        },
        "subscription-attributes-tag": subscriptionAttributes,
      },
    )

    const parsed = ipp.parse(bytes)
    expect(parsed.version).toBe("2.0")
    expect(parsed.operation).toBe("Create-Printer-Subscriptions")
    expect(parsed["operation-attributes-tag"]).toEqual(operationAttributes)
    expect(parsed["subscription-attributes-tag"]).toEqual(subscriptionAttributes)
  })

  it("detects job notifications that should trigger targeted repair", () => {
    expect(
      notificationsIncludeJobEvent([
        { "notify-subscribed-event": "printer-state-changed" },
        { "notify-subscribed-event": "job-completed" },
      ]),
    ).toBe(true)

    expect(
      notificationsIncludeJobEvent([
        { "notify-subscribed-event": "printer-state-changed" },
      ]),
    ).toBe(false)
  })

  it("detects printer notifications that should trigger full status observation", () => {
    expect(
      notificationsIncludePrinterEvent([
        { "notify-subscribed-event": "job-progress" },
        { "notify-subscribed-event": "printer-state-changed" },
      ]),
    ).toBe(true)

    expect(
      notificationsIncludePrinterEvent([
        { "notify-subscribed-event": "job-progress" },
        { "notify-subscribed-event": "job-completed" },
      ]),
    ).toBe(false)
  })
})
