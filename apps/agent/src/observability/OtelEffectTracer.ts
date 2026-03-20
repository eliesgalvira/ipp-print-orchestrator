import { context as otelContext, SpanStatusCode, trace, TraceFlags } from "@opentelemetry/api"
import type {
  AttributeValue,
  Attributes,
  Context as OtelContext,
  Link,
  Span as OtelSpan,
  SpanContext,
} from "@opentelemetry/api"
import { Exit, Option, Tracer as EffectTracer } from "effect"
import type { Context as EffectContext } from "effect"

const OTEL_EFFECT_SPAN = Symbol.for("@ipp/agent/OtelEffectSpan")

type EffectSpanLike = EffectTracer.AnySpan & {
  readonly [OTEL_EFFECT_SPAN]?: true
  readonly otelSpan?: OtelSpan
}

const kindMap = {
  client: 2,
  consumer: 4,
  internal: 0,
  producer: 3,
  server: 1,
} as const

const toTimeInput = (nanoseconds: bigint): number =>
  Number(nanoseconds / 1_000_000n)

const toTraceFlags = (sampled: boolean): number =>
  sampled ? TraceFlags.SAMPLED : TraceFlags.NONE

const normalizeAttributeValue = (value: unknown): AttributeValue | undefined => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return [...value]
    }

    if (value.every((item) => typeof item === "number")) {
      return [...value]
    }

    if (value.every((item) => typeof item === "boolean")) {
      return [...value]
    }

    return JSON.stringify(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value === null || value === undefined) {
    return undefined
  }

  return JSON.stringify(value)
}

const normalizeAttributes = (
  attributes: Record<string, unknown> | undefined,
): Attributes =>
  Object.fromEntries(
    Object.entries(attributes ?? {}).flatMap(([key, value]) => {
      const normalized = normalizeAttributeValue(value)
      return normalized === undefined ? [] : [[key, normalized] as const]
    }),
  )

const toSpanContext = (span: EffectTracer.AnySpan): SpanContext => ({
  traceId: span.traceId,
  spanId: span.spanId,
  traceFlags: toTraceFlags(span.sampled),
  isRemote: span._tag === "ExternalSpan",
})

const toOtelContext = (
  parent: Option.Option<EffectTracer.AnySpan>,
): OtelContext => {
  if (parent._tag === "None") {
    return otelContext.active()
  }

  const span = parent.value as EffectSpanLike
  if (span._tag === "Span" && span[OTEL_EFFECT_SPAN] === true && span.otelSpan) {
    return trace.setSpan(otelContext.active(), span.otelSpan)
  }

  return trace.setSpanContext(otelContext.active(), toSpanContext(parent.value))
}

const toLinks = (
  links: ReadonlyArray<EffectTracer.SpanLink>,
): Link[] =>
  links.map((link) => ({
    context: toSpanContext(link.span),
    attributes: normalizeAttributes(link.attributes),
  }))

class OtelEffectSpan implements EffectTracer.Span {
  readonly _tag = "Span"
  readonly [OTEL_EFFECT_SPAN] = true as const
  readonly spanId: string
  readonly traceId: string
  readonly sampled: boolean
  readonly attributes = new Map<string, unknown>()
  readonly links: Array<EffectTracer.SpanLink>

  status: EffectTracer.SpanStatus

  constructor(
    readonly name: string,
    readonly parent: Option.Option<EffectTracer.AnySpan>,
    readonly context: EffectContext.Context<never>,
    links: ReadonlyArray<EffectTracer.SpanLink>,
    readonly startTime: bigint,
    readonly kind: EffectTracer.SpanKind,
    readonly otelSpan: OtelSpan,
  ) {
    const spanContext = otelSpan.spanContext()
    this.spanId = spanContext.spanId
    this.traceId = spanContext.traceId
    this.sampled = (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED
    this.links = [...links]
    this.status = {
      _tag: "Started",
      startTime,
    }
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (Exit.isFailure(exit)) {
      this.otelSpan.setStatus({ code: SpanStatusCode.ERROR })
    }

    this.otelSpan.end(toTimeInput(endTime))
    this.status = {
      _tag: "Ended",
      startTime: this.startTime,
      endTime,
      exit,
    }
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value)
    const normalized = normalizeAttributeValue(value)
    if (normalized !== undefined) {
      this.otelSpan.setAttribute(key, normalized)
    }
  }

  event(
    name: string,
    startTime: bigint,
    attributes?: Record<string, unknown>,
  ): void {
    this.otelSpan.addEvent(name, normalizeAttributes(attributes), toTimeInput(startTime))
  }

  addLinks(links: ReadonlyArray<EffectTracer.SpanLink>): void {
    this.links.push(...links)
    this.otelSpan.addLinks(toLinks(links))
  }
}

export const makeOtelEffectTracer = (
  tracerName: string,
): EffectTracer.Tracer => {
  const otelTracer = trace.getTracer(tracerName)

  return EffectTracer.make({
    span: (name, parent, context, links, startTime, kind, options) => {
      const otelSpan = otelTracer.startSpan(
        name,
        {
          kind: kindMap[kind],
          attributes: normalizeAttributes(options?.attributes),
          links: toLinks(links),
          startTime: toTimeInput(startTime),
        },
        toOtelContext(parent),
      )

      return new OtelEffectSpan(
        name,
        parent,
        context,
        links,
        startTime,
        kind,
        otelSpan,
      )
    },
    context: (f) => f(),
  })
}

export const effectSpanToOtelContext = (
  span: EffectTracer.AnySpan | undefined,
): OtelContext | undefined => {
  if (span === undefined) {
    return undefined
  }

  if (span._tag === "Span") {
    const effectSpan = span as EffectSpanLike
    if (effectSpan[OTEL_EFFECT_SPAN] === true && effectSpan.otelSpan) {
      return trace.setSpan(otelContext.active(), effectSpan.otelSpan)
    }
  }

  return trace.setSpanContext(otelContext.active(), toSpanContext(span))
}
