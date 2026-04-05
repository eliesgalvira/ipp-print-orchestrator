import { describe, expect, it } from "@effect/vitest"

import {
  extractSubscriptionId,
  maxNotificationSequenceNumber,
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
})
