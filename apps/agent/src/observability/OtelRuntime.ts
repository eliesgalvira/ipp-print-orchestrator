import { logs as otelLogsApi, SeverityNumber } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { NodeSDK, tracing } from "@opentelemetry/sdk-node"
import type { Tracer as EffectTracer } from "effect"
import { Effect, Redacted } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { type OtelConfig, readOtelConfig } from "./OtelConfig.js"
import {
  effectSpanToOtelContext,
  makeOtelEffectTracer,
} from "./OtelEffectTracer.js"

let sdk: NodeSDK | null = null
let effectTracer: EffectTracer.Tracer | null = null
let shutdownRegistered = false

const severityForEvent = (_event: WideEvent): SeverityNumber =>
  SeverityNumber.INFO

const logAttributesForEvent = (
  event: WideEvent,
): Record<string, string | number | boolean | string[]> => {
  const attributes: Record<string, string | number | boolean | string[]> = {}

  for (const [key, value] of Object.entries(event)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attributes[key] = value
      continue
    }

    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      attributes[key] = [...value]
    }
  }

  return attributes
}

const exposeHeaders = (
  headers: Record<string, Redacted.Redacted<string>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Redacted.value(value)]),
  )

const registerShutdownHooks = () => {
  if (shutdownRegistered) {
    return
  }

  shutdownRegistered = true
  const shutdown = () => {
    void shutdownObservability()
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  process.once("beforeExit", shutdown)
}

export const startObservability = async (
  config: OtelConfig = readOtelConfig(),
): Promise<void> => {
  if (sdk !== null) {
    return
  }

  if (!config.enabled) {
    return
  }

  const spanProcessors =
    config.traces === null
      ? []
      : [
          new tracing.BatchSpanProcessor(
            new OTLPTraceExporter({
              url: config.traces.endpoint,
              headers: exposeHeaders(config.traces.headers),
            }),
          ),
        ]

  const logRecordProcessors =
    config.logs === null
      ? []
      : [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              url: config.logs.endpoint,
              headers: exposeHeaders(config.logs.headers),
            }),
          ),
        ]

  if (spanProcessors.length === 0 && logRecordProcessors.length === 0) {
    console.warn(
      "[observability] IPP_ORCH_ENABLE_OTLP=true but no OTLP endpoints were configured; skipping OTLP startup",
    )
    return
  }

  sdk = new NodeSDK({
    serviceName: config.serviceName,
    spanProcessors,
    logRecordProcessors,
  })
  sdk.start()
  effectTracer =
    config.traces === null ? null : makeOtelEffectTracer(config.serviceName)
  registerShutdownHooks()
}

export const shutdownObservability = async (): Promise<void> => {
  if (sdk === null) {
    return
  }

  const current = sdk
  sdk = null
  effectTracer = null
  await current.shutdown()
}

export const withObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effectTracer === null ? effect : Effect.withTracer(effect, effectTracer)

export const emitWideEventLog = (
  event: WideEvent,
  span: EffectTracer.AnySpan | undefined,
): void => {
  if (sdk === null) {
    return
  }

  const logger = otelLogsApi.getLogger("ipp-print-orchestrator")
  const context = effectSpanToOtelContext(span)
  const record = {
    eventName: event.eventName,
    severityNumber: severityForEvent(event),
    severityText:
      severityForEvent(event) === SeverityNumber.ERROR ? "ERROR" : "INFO",
    body: event.eventName,
    attributes: logAttributesForEvent(event),
    timestamp: new Date(event.timestamp),
  }

  logger.emit(
    context === undefined
      ? record
      : {
          ...record,
          context,
        },
  )
}
