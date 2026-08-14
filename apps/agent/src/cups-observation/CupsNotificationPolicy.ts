import {
  type IppAttributeGroup,
  maxNotificationSequenceNumber,
  notificationIncludesEvent,
} from "@ipp/ipp"

const printerNotificationEvents = new Set([
  "printer-modified",
  "printer-state-changed",
])

export interface CupsNotificationDecision {
  readonly nextSequenceNumber: number
  readonly observePrinterStatus: boolean
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
  }
}
