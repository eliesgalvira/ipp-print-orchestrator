import { logs as otelLogsApi, SeverityNumber } from "@opentelemetry/api-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { NodeSDK, tracing } from "@opentelemetry/sdk-node"
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { Effect, Layer } from "effect"
import type { Tracer as EffectTracer } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { effectSpanToOtelContext, makeOtelEffectTracer } from "./OtelEffectTracer.js"
import { readOtelConfig } from "./OtelConfig.js"

let sdk: NodeSDK | null = null
let tracerLayer: Layer.Layer<never> | null = null
let shutdownRegistered = false

const severityForEvent = (event: WideEvent): SeverityNumber => {
  switch (event.eventName) {
    case "print.job.failed":
      return SeverityNumber.ERROR
    default:
      return SeverityNumber.INFO
  }
}

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

    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      attributes[key] = [...value]
    }
  }

  return attributes
}

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

export const startObservability = async (): Promise<void> => {
  if (sdk !== null || tracerLayer !== null) {
    return
  }

  const config = readOtelConfig()
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
              headers: config.traces.headers,
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
              headers: config.logs.headers,
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
  tracerLayer =
    spanProcessors.length > 0
      ? Layer.setTracer(makeOtelEffectTracer(config.serviceName))
      : null
  registerShutdownHooks()
}

export const shutdownObservability = async (): Promise<void> => {
  if (sdk === null) {
    return
  }

  const current = sdk
  sdk = null
  tracerLayer = null
  await current.shutdown()
}

export const withObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  tracerLayer === null ? effect : effect.pipe(Effect.provide(tracerLayer))

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
