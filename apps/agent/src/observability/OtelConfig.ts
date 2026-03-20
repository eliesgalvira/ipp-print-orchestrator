const DEFAULT_SERVICE_NAME = "ipp-print-orchestrator"

export interface OtelSignalConfig {
  readonly endpoint: string
  readonly headers: Record<string, string>
}

export interface OtelConfig {
  readonly enabled: boolean
  readonly serviceName: string
  readonly traces: OtelSignalConfig | null
  readonly logs: OtelSignalConfig | null
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

const deriveSignalEndpoint = (
  sharedEndpoint: string | undefined,
  signal: "traces" | "logs",
): string | null => {
  if (sharedEndpoint === undefined || sharedEndpoint.trim() === "") {
    return null
  }

  const normalized = trimTrailingSlash(sharedEndpoint.trim())
  if (normalized.endsWith("/v1")) {
    return `${normalized}/${signal}`
  }

  return `${normalized}/v1/${signal}`
}

const parseHeaders = (value: string | undefined): Record<string, string> => {
  if (value === undefined || value.trim() === "") {
    return {}
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const separatorIndex = entry.indexOf("=")
        if (separatorIndex <= 0) {
          return []
        }

        const key = entry.slice(0, separatorIndex).trim()
        const headerValue = entry.slice(separatorIndex + 1).trim()
        if (key.length === 0 || headerValue.length === 0) {
          return []
        }

        return [[key, headerValue] as const]
      }),
  )
}

const parseResourceAttributes = (
  value: string | undefined,
): Record<string, string> => {
  if (value === undefined || value.trim() === "") {
    return {}
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const separatorIndex = entry.indexOf("=")
        if (separatorIndex <= 0) {
          return []
        }

        const key = entry.slice(0, separatorIndex).trim()
        const attributeValue = entry.slice(separatorIndex + 1).trim()
        if (key.length === 0 || attributeValue.length === 0) {
          return []
        }

        return [[key, attributeValue] as const]
      }),
  )
}

const resolveSignal = (
  specificEndpoint: string | undefined,
  sharedEndpoint: string | undefined,
  specificHeaders: string | undefined,
  sharedHeaders: string | undefined,
  signal: "traces" | "logs",
): OtelSignalConfig | null => {
  const endpoint =
    specificEndpoint?.trim() && specificEndpoint.trim().length > 0
      ? specificEndpoint.trim()
      : deriveSignalEndpoint(sharedEndpoint, signal)

  if (endpoint === null) {
    return null
  }

  return {
    endpoint,
    headers: {
      ...parseHeaders(sharedHeaders),
      ...parseHeaders(specificHeaders),
    },
  }
}

export const readOtelConfig = (
  env: NodeJS.ProcessEnv = process.env,
): OtelConfig => {
  const resourceAttributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES)
  const serviceName =
    resourceAttributes["service.name"] ?? DEFAULT_SERVICE_NAME

  return {
    enabled: env.IPP_ORCH_ENABLE_OTLP === "true",
    serviceName,
    traces: resolveSignal(
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      env.OTEL_EXPORTER_OTLP_ENDPOINT,
      env.OTEL_EXPORTER_OTLP_TRACES_HEADERS,
      env.OTEL_EXPORTER_OTLP_HEADERS,
      "traces",
    ),
    logs: resolveSignal(
      env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
      env.OTEL_EXPORTER_OTLP_ENDPOINT,
      env.OTEL_EXPORTER_OTLP_LOGS_HEADERS,
      env.OTEL_EXPORTER_OTLP_HEADERS,
      "logs",
    ),
  }
}
