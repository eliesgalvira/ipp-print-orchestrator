import type { Context as OtelContext } from "@opentelemetry/api"
import type { Tracer as EffectTracer } from "effect"

export const effectSpanToOtelContext = (
  _span: EffectTracer.AnySpan | undefined,
): OtelContext | undefined => undefined

export const makeOtelEffectTracer = (_tracerName: string): never => {
  throw new Error("Custom Effect tracer bridge is disabled during the Effect v4 migration")
}
