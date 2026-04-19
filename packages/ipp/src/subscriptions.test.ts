import { describe, expect, it } from "@effect/vitest"

import {
  cancelSubscriptionRequest,
  createPrinterSubscriptionRequest,
  extractNotifyGetIntervalSeconds,
  extractSubscriptionId,
  getNotificationsRequest,
  maxNotificationSequenceNumber,
  notificationIncludesEvent,
  notificationRecords,
} from "./subscriptions.js"

describe("IPP subscriptions helpers", () => {
  it("builds create-printer-subscriptions requests", () => {
    expect(
      createPrinterSubscriptionRequest(
        "ipp://localhost:631/printers/Test_Printer",
        "ipp-print-orchestrator",
        {
          "notify-pull-method": "ippget",
          "notify-events": ["printer-state-changed"],
          "notify-lease-duration": 0,
        },
      ),
    ).toEqual({
      "operation-attributes-tag": {
        "printer-uri": "ipp://localhost:631/printers/Test_Printer",
        "requesting-user-name": "ipp-print-orchestrator",
      },
      "subscription-attributes-tag": {
        "notify-pull-method": "ippget",
        "notify-events": ["printer-state-changed"],
        "notify-lease-duration": 0,
      },
    })
  })

  it("builds cancel-subscription and get-notifications requests", () => {
    expect(
      cancelSubscriptionRequest(
        "ipp://localhost:631/printers/Test_Printer",
        "ipp-print-orchestrator",
        42,
      ),
    ).toEqual({
      "operation-attributes-tag": {
        "printer-uri": "ipp://localhost:631/printers/Test_Printer",
        "requesting-user-name": "ipp-print-orchestrator",
      },
      "subscription-attributes-tag": {
        "notify-subscription-id": 42,
      },
    })

    expect(
      getNotificationsRequest(
        "ipp://localhost:631/printers/Test_Printer",
        "ipp-print-orchestrator",
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

  it("normalizes subscription responses and notifications", () => {
    expect(
      extractSubscriptionId({
        "subscription-attributes-tag": {
          "notify-subscription-id": 42,
        },
      }),
    ).toBe(42)

    const notifications = notificationRecords({
      "event-notification-attributes-tag": [
        {
          "notify-sequence-number": 2,
          "notify-subscribed-event": "job-progress",
        },
        {
          "notify-sequence-number": 7,
          "notify-subscribed-event": "printer-state-changed",
        },
      ],
    })

    expect(maxNotificationSequenceNumber(notifications)).toBe(7)
    expect(
      notificationIncludesEvent(
        notifications,
        new Set(["printer-state-changed", "printer-modified"]),
      ),
    ).toBe(true)
  })

  it("extracts notify-get-interval when present", () => {
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
})
