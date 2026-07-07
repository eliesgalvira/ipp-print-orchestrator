import {
  type IppAttributeGroup,
  maxNotificationSequenceNumber,
  notificationIncludesEvent,
} from "@ipp/ipp"

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

export interface CupsNotificationDecision {
  readonly nextSequenceNumber: number
  readonly observePrinterStatus: boolean
  readonly repairCupsTrackedJobs: boolean
}

export const notificationsIncludeJobEvent = (
  notifications: readonly IppAttributeGroup[],
): boolean => notificationIncludesEvent(notifications, jobNotificationEvents)

export const notificationsIncludePrinterEvent = (
  notifications: readonly IppAttributeGroup[],
): boolean =>
  notificationIncludesEvent(notifications, printerNotificationEvents)

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
    observePrinterStatus: notificationsIncludePrinterEvent(
      params.notifications,
    ),
    repairCupsTrackedJobs: notificationsIncludeJobEvent(params.notifications),
  }
}
