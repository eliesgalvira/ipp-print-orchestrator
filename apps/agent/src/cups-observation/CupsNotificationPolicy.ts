import {
  type IppAttributeGroup,
  maxNotificationSequenceNumber,
  notificationIncludesEvent,
} from "@ipp/ipp"

const printerNotificationEvents = new Set([
  "printer-modified",
  "printer-state-changed",
])

const jobNotificationEvents = new Set([
  "job-created",
  "job-progress",
  "job-state-changed",
  "job-stopped",
  "job-completed",
])

export interface CupsNotificationDecision {
  readonly nextSequenceNumber: number
  readonly observePrinterStatus: boolean
  readonly observeRetainedJobs: boolean
}

export const decideCupsNotification = (params: {
  readonly notifications: readonly IppAttributeGroup[]
  readonly nextSequenceNumber: number
}): CupsNotificationDecision => {
  const maxSeen = maxNotificationSequenceNumber(params.notifications)

  return {
    nextSequenceNumber:
      maxSeen >= params.nextSequenceNumber
        ? maxSeen + 1
        : params.nextSequenceNumber,
    observePrinterStatus: notificationIncludesEvent(
      params.notifications,
      printerNotificationEvents,
    ),
    observeRetainedJobs: notificationIncludesEvent(
      params.notifications,
      jobNotificationEvents,
    ),
  }
}
