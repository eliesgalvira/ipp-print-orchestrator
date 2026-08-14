import {
  attributeGroups,
  attributeValues,
  type IppAttributeGroup,
  type IppMessage,
} from "@ipp/ipp"

export type IppFailureResponse = IppMessage

export interface IppFailureContext {
  readonly operation?: string
}

const summarizeGroup = (group: IppAttributeGroup): string =>
  group.attributes
    .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .join(", ")

export const ippFailureMessage = (
  response: IppFailureResponse,
  context: IppFailureContext = {},
): string => {
  const statusCode = response.statusCode ?? "unknown"
  const operationGroups = attributeGroups(response, "operation-attributes-tag")
  const statusMessages = operationGroups.flatMap((group) =>
    attributeValues(group, "status-message"),
  )
  const unsupported = attributeGroups(response, "unsupported-attributes-tag")
    .map(summarizeGroup)
    .filter((summary) => summary.length > 0)
  const details = [
    ...statusMessages.flatMap((message) =>
      typeof message === "string" && message.length > 0
        ? [`status-message=${JSON.stringify(message)}`]
        : [],
    ),
    ...(unsupported.length === 0
      ? []
      : [`unsupported-attributes=${unsupported.join("; ")}`]),
  ]
  const prefix =
    context.operation === undefined
      ? "IPP request failed"
      : `IPP ${context.operation} request failed`

  return details.length === 0
    ? `${prefix}: ${statusCode}`
    : `${prefix}: ${statusCode} (${details.join("; ")})`
}
