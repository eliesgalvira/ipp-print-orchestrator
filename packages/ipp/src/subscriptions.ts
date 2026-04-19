import type {
  IppAttributeGroup,
  IppMessage,
  IppRequestMessage,
} from "./model.js"

export type IppSubscriptionResponse = IppMessage & {
  readonly "subscription-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
}

export type IppNotificationsResponse = IppMessage & {
  readonly "event-notification-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
}

const asSingleGroup = (
  value: IppAttributeGroup | readonly IppAttributeGroup[] | undefined,
): IppAttributeGroup | null => {
  if (value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value as IppAttributeGroup
}

const asGroupList = (
  value: IppAttributeGroup | readonly IppAttributeGroup[] | undefined,
): readonly IppAttributeGroup[] => {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value as IppAttributeGroup]
}

const singleRecord = (
  value: IppSubscriptionResponse["subscription-attributes-tag"],
): IppAttributeGroup | null => asSingleGroup(value)

const requestMessage = (
  operationAttributes: IppAttributeGroup,
  subscriptionAttributes?: IppAttributeGroup,
): IppRequestMessage => ({
  "operation-attributes-tag": operationAttributes,
  ...(subscriptionAttributes === undefined
    ? {}
    : { "subscription-attributes-tag": subscriptionAttributes }),
})

export const createPrinterSubscriptionRequest = (
  printerUri: string,
  requestingUserName: string,
  subscriptionAttributes: IppAttributeGroup,
): IppRequestMessage =>
  requestMessage(
    {
      "printer-uri": printerUri,
      "requesting-user-name": requestingUserName,
    },
    subscriptionAttributes,
  )

export const cancelSubscriptionRequest = (
  printerUri: string,
  requestingUserName: string,
  subscriptionId: number,
): IppRequestMessage =>
  requestMessage(
    {
      "printer-uri": printerUri,
      "requesting-user-name": requestingUserName,
    },
    {
      "notify-subscription-id": subscriptionId,
    },
  )

export const getNotificationsRequest = (
  printerUri: string,
  requestingUserName: string,
  subscriptionId: number,
  nextSequenceNumber: number,
): IppRequestMessage =>
  requestMessage({
    "printer-uri": printerUri,
    "requesting-user-name": requestingUserName,
    "notify-subscription-ids": [subscriptionId],
    "notify-sequence-numbers": [nextSequenceNumber],
    "notify-wait": true,
  })

export const extractSubscriptionId = (
  response: IppSubscriptionResponse,
): number => {
  const attrs = singleRecord(response["subscription-attributes-tag"])
  const id = attrs?.["notify-subscription-id"]
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("IPP subscription response missing notify-subscription-id")
  }
  return id
}

export const notificationRecords = (
  response: IppNotificationsResponse,
): readonly IppAttributeGroup[] =>
  asGroupList(response["event-notification-attributes-tag"])

export const maxNotificationSequenceNumber = (
  notifications: readonly IppAttributeGroup[],
): number =>
  notifications.reduce((max, notification) => {
    const value = notification["notify-sequence-number"]
    return typeof value === "number" && Number.isInteger(value) && value > max
      ? value
      : max
  }, 0)

export const notificationIncludesEvent = (
  notifications: readonly IppAttributeGroup[],
  eventNames: ReadonlySet<string>,
): boolean =>
  notifications.some((notification) => {
    const eventName = notification["notify-subscribed-event"]
    return typeof eventName === "string" && eventNames.has(eventName)
  })

export const extractNotifyGetIntervalSeconds = (
  response: IppMessage,
): number | null => {
  const attrs = response["operation-attributes-tag"]
  const operationAttributes = asSingleGroup(attrs)
  if (operationAttributes === null) {
    return null
  }

  const value = operationAttributes["notify-get-interval"]
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}
