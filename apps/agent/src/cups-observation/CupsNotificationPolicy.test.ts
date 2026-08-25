import { describe, expect, it } from "@effect/vitest"

import { decideCupsNotification } from "./CupsNotificationPolicy.js"

describe("CUPS notification policy", () => {
  it("advances sequence numbers and observes printer changes", () => {
    expect(
      decideCupsNotification({
        nextSequenceNumber: 9,
        notifications: [
          {
            tag: "event-notification-attributes-tag",
            attributes: [
              { name: "notify-sequence-number", value: 10 },
              { name: "notify-subscribed-event", value: "job-progress" },
            ],
          },
          {
            tag: "event-notification-attributes-tag",
            attributes: [
              { name: "notify-sequence-number", value: 12 },
              {
                name: "notify-subscribed-event",
                value: "printer-state-changed",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      nextSequenceNumber: 13,
      observePrinterStatus: true,
      observeRetainedJobs: true,
    })
  })
})
