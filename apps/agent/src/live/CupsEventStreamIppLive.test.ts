import { describe, expect, it } from "@effect/vitest"

import {
  extractSubscriptionId,
  extractNotifyGetIntervalSeconds,
  getNotificationsRequestMessage,
  maxNotificationSequenceNumber,
  notificationsIncludeJobEvent,
  notificationRecords,
} from "./CupsEventStreamIppLive.js"

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
        "http://127.0.0.1:631/printers/Test_Printer",
        42,
        9,
      ),
    ).toEqual({
      "operation-attributes-tag": {
        "printer-uri": "http://127.0.0.1:631/printers/Test_Printer",
        "requesting-user-name": "ipp-print-orchestrator",
        "notify-subscription-ids": [42],
        "notify-sequence-numbers": [9],
        "notify-wait": true,
      },
    })
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
})
