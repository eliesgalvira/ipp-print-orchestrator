import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  context as otelContextApi,
  trace as otelTraceApi,
  type Context as OtelContext,
  type Link as OtelLink,
  type Span as OtelSpan,
  type SpanContext as OtelSpanContext,
  type Tracer as OtelTracer,
} from "@opentelemetry/api"
import { Cause, Exit, Option, ServiceMap, Tracer as EffectTracer, type Fiber } from "effect"

class OtelEffectSpan implements EffectTracer.Span {
  readonly _tag = "Span"
  readonly attributes = new Map<string, unknown>()
  readonly otelContext: OtelContext
  readonly otelSpan: OtelSpan
  status: EffectTracer.SpanStatus

  constructor(
    readonly name: string,
    readonly parent: Option.Option<EffectTracer.AnySpan>,
    readonly annotations: ServiceMap.ServiceMap<never>,
    readonly links: Array<EffectTracer.SpanLink>,
    readonly sampled: boolean,
    readonly kind: EffectTracer.SpanKind,
    readonly spanId: string,
    readonly traceId: string,
    readonly startTime: bigint,
    otelSpan: OtelSpan,
    otelContext: OtelContext,
  ) {
    this.otelSpan = otelSpan
    this.otelContext = otelContext
    this.status = {
      _tag: "Started",
      startTime,
    }
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") {
      return
    }

    if (Exit.isFailure(exit)) {
      this.otelSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: Cause.pretty(exit.cause),
      })
      this.otelSpan.recordException(new Error(Cause.pretty(exit.cause)))
    } else {
      this.otelSpan.setStatus({ code: SpanStatusCode.OK })
    }

    this.otelSpan.end(nanosToMillis(endTime))
    this.status = {
      _tag: "Ended",
      startTime: this.startTime,
      endTime,
      exit,
    }
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value)
    this.otelSpan.setAttribute(key, toOtelAttributeValue(value))
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    this.otelSpan.addEvent(name, mapAttributes(attributes), nanosToMillis(startTime))
  }

  addLinks(links: ReadonlyArray<EffectTracer.SpanLink>): void {
    this.links.push(...links)
  }
}

const nanosToMillis = (value: bigint): number => Number(value / 1_000_000n)

const toOtelAttributeValue = (
  value: unknown,
): string | number | boolean | string[] | number[] | boolean[] => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
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
  }

  return String(value)
}

const mapAttributes = (
  attributes: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean | string[] | number[] | boolean[]> | undefined => {
  if (attributes === undefined) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      toOtelAttributeValue(value),
    ]),
  )
}

const toOtelSpanKind = (kind: EffectTracer.SpanKind): SpanKind => {
  switch (kind) {
    case "client":
      return SpanKind.CLIENT
    case "server":
      return SpanKind.SERVER
    case "producer":
      return SpanKind.PRODUCER
    case "consumer":
      return SpanKind.CONSUMER
    default:
      return SpanKind.INTERNAL
  }
}

const toSpanContext = (
  span: EffectTracer.AnySpan,
): OtelSpanContext => ({
  spanId: span.spanId,
  traceId: span.traceId,
  traceFlags: span.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
  isRemote: span._tag === "ExternalSpan",
})

const otelContextForSpan = (span: EffectTracer.AnySpan): OtelContext => {
  if (span._tag === "Span" && span instanceof OtelEffectSpan) {
    return span.otelContext
  }

  return otelTraceApi.setSpanContext(ROOT_CONTEXT, toSpanContext(span))
}

const toOtelLinks = (links: ReadonlyArray<EffectTracer.SpanLink>): OtelLink[] =>
  links.map((link) => ({
    context: toSpanContext(link.span),
    attributes: mapAttributes(link.attributes) ?? {},
  }))

export const effectSpanToOtelContext = (
  span: EffectTracer.AnySpan | undefined,
): OtelContext | undefined =>
  span === undefined ? undefined : otelContextForSpan(span)

export const makeOtelEffectTracer = (
  tracerName: string,
): EffectTracer.Tracer =>
  EffectTracer.make({
    span(options) {
      const parentContext = Option.match(options.parent, {
        onNone: () => ROOT_CONTEXT,
        onSome: otelContextForSpan,
      })
      const otelTracer: OtelTracer = otelTraceApi.getTracer(tracerName)
      const otelSpan = otelTracer.startSpan(
        options.name,
        {
          kind: toOtelSpanKind(options.kind),
          root: options.root,
          links: toOtelLinks(options.links),
          startTime: nanosToMillis(options.startTime),
        },
        parentContext,
      )
      const spanContext = otelSpan.spanContext()
      const contextWithSpan = otelTraceApi.setSpan(parentContext, otelSpan)

      return new OtelEffectSpan(
        options.name,
        options.parent,
        options.annotations,
        options.links,
        options.sampled,
        options.kind,
        spanContext.spanId,
        spanContext.traceId,
        options.startTime,
        otelSpan,
        contextWithSpan,
      )
    },
    context: <X>(
      primitive: EffectTracer.EffectPrimitive<X>,
      fiber: Fiber.Fiber<any, any>,
    ) =>
      otelContextApi.with(
        effectSpanToOtelContext(fiber.currentSpan) ?? ROOT_CONTEXT,
        () => primitive["~effect/Effect/evaluate"](fiber),
      ),
  })
