import { describe, expect, it } from "@effect/vitest"

import {
  decideCupsNotification,
  notificationsIncludeJobEvent,
  notificationsIncludePrinterEvent,
} from "./CupsNotificationPolicy.js"

describe("CUPS notification policy", () => {
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

  it("detects printer notifications that should trigger status observation", () => {
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

  it("advances sequence numbers and reports required side effects", () => {
    expect(
      decideCupsNotification({
        nextSequenceNumber: 9,
        notifications: [
          {
            "notify-sequence-number": 10,
            "notify-subscribed-event": "job-progress",
          },
          {
            "notify-sequence-number": 12,
            "notify-subscribed-event": "printer-state-changed",
          },
        ],
      }),
    ).toEqual({
      nextSequenceNumber: 13,
      observePrinterStatus: true,
      repairCupsTrackedJobs: true,
    })
  })
})
