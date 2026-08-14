import type {
  IppAttributeGroup,
  IppAttributeMap,
  IppMessage,
  IppRequestMessage,
} from "./model.js"
import { attributeGroups, attributeValues } from "./model.js"

export type IppSubscriptionResponse = IppMessage
export type IppNotificationsResponse = IppMessage

const requestMessage = (
  operationAttributes: IppAttributeMap,
  subscriptionAttributes?: IppAttributeMap,
): IppRequestMessage => ({
  "operation-attributes-tag": operationAttributes,
  ...(subscriptionAttributes === undefined
    ? {}
    : { "subscription-attributes-tag": subscriptionAttributes }),
})

export const createPrinterSubscriptionRequest = (
  printerUri: string,
  requestingUserName: string,
  subscriptionAttributes: IppAttributeMap,
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
): number | null => {
  const groups = attributeGroups(response, "subscription-attributes-tag")
  const ids = groups.flatMap((group) =>
    attributeValues(group, "notify-subscription-id"),
  )
  const id = ids[0]
  return ids.length === 1 &&
    typeof id === "number" &&
    Number.isInteger(id) &&
    id > 0
    ? id
    : null
}

export const notificationRecords = (
  response: IppNotificationsResponse,
): readonly IppAttributeGroup[] =>
  attributeGroups(response, "event-notification-attributes-tag")

export const maxNotificationSequenceNumber = (
  notifications: readonly IppAttributeGroup[],
): number =>
  notifications.reduce((max, notification) => {
    const sequenceNumbers = attributeValues(
      notification,
      "notify-sequence-number",
    )
    return sequenceNumbers.reduce<number>(
      (currentMax, value) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value > currentMax
          ? value
          : currentMax,
      max,
    )
  }, 0)

export const notificationIncludesEvent = (
  notifications: readonly IppAttributeGroup[],
  eventNames: ReadonlySet<string>,
): boolean =>
  notifications.some((notification) => {
    const eventNamesInGroup = attributeValues(
      notification,
      "notify-subscribed-event",
    )
    return eventNamesInGroup.some(
      (eventName) => typeof eventName === "string" && eventNames.has(eventName),
    )
  })

export const extractNotifyGetIntervalSeconds = (
  response: IppMessage,
): number | null => {
  const values = attributeGroups(response, "operation-attributes-tag").flatMap(
    (group) => attributeValues(group, "notify-get-interval"),
  )
  const value = values[0]
  return values.length === 1 &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null
}
