export interface IppFailureResponse {
  readonly statusCode?: string
  readonly "operation-attributes-tag"?: Record<string, unknown>
  readonly "unsupported-attributes-tag"?:
    | Record<string, unknown>
    | readonly Record<string, unknown>[]
}

export interface IppFailureContext {
  readonly operation?: string
}

const summarizeRecord = (value: Record<string, unknown>): string =>
  Object.entries(value)
    .map(([key, item]) => `${key}=${JSON.stringify(item)}`)
    .join(", ")

const summarizeUnsupportedAttributes = (
  value: IppFailureResponse["unsupported-attributes-tag"],
): string | null => {
  if (value === undefined) {
    return null
  }

  const records = Array.isArray(value) ? value : [value]
  const summary = records.map(summarizeRecord).filter((item) => item.length > 0)
  return summary.length === 0 ? null : summary.join("; ")
}

export const ippFailureMessage = (
  response: IppFailureResponse,
  context: IppFailureContext = {},
): string => {
  const statusCode = response.statusCode ?? "unknown"
  const statusMessage = response["operation-attributes-tag"]?.["status-message"]
  const unsupportedAttributes = summarizeUnsupportedAttributes(
    response["unsupported-attributes-tag"],
  )
  const details = [
    typeof statusMessage === "string" && statusMessage.length > 0
      ? `status-message=${JSON.stringify(statusMessage)}`
      : null,
    unsupportedAttributes === null
      ? null
      : `unsupported-attributes=${unsupportedAttributes}`,
  ].flatMap((item) => (item === null ? [] : [item]))
  const prefix =
    context.operation === undefined
      ? "IPP request failed"
      : `IPP ${context.operation} request failed`

  return details.length === 0
    ? `${prefix}: ${statusCode}`
    : `${prefix}: ${statusCode} (${details.join("; ")})`
}
