import type { Effect, Tracer as EffectTracer } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { readOtelConfig } from "./OtelConfig.js"

type OtelRuntimeModule = typeof import("./OtelRuntime.js")

let otelRuntime: OtelRuntimeModule | null = null

export const startObservability = async (): Promise<void> => {
  if (otelRuntime !== null) {
    await otelRuntime.startObservability()
    return
  }

  const config = readOtelConfig()
  if (!config.enabled) {
    return
  }

  if (config.traces === null && config.logs === null) {
    console.warn(
      "[observability] IPP_ORCH_ENABLE_OTLP=true but no OTLP endpoints were configured; skipping OTLP startup",
    )
    return
  }

  otelRuntime = await import("./OtelRuntime.js")
  await otelRuntime.startObservability(config)
}

export const shutdownObservability = async (): Promise<void> => {
  if (otelRuntime === null) {
    return
  }

  await otelRuntime.shutdownObservability()
  otelRuntime = null
}

export const withObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  otelRuntime === null ? effect : otelRuntime.withObservability(effect)

export const emitWideEventLog = (
  event: WideEvent,
  span: EffectTracer.AnySpan | undefined,
): void => {
  otelRuntime?.emitWideEventLog(event, span)
}
