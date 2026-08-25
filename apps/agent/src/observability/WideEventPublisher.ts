import { Context, type Effect } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"

export class WideEventPublisher extends Context.Service<
  WideEventPublisher,
  {
    readonly emit: (event: WideEvent) => Effect.Effect<void>
  }
>()("@ipp/agent/observability/WideEventPublisher") {}

export interface HttpRequestCompletedEventInput {
  readonly timestamp: string
  readonly route: string
  readonly method: string
  readonly statusCode: number
  readonly durationMs: number
  readonly clientAddress?: string | undefined
  readonly userAgent?: string | undefined
  readonly errorTag?: string | undefined
  readonly errorMessage?: string | undefined
}

export const makeHttpRequestCompletedEvent = (
  input: HttpRequestCompletedEventInput,
): WideEvent => ({
  timestamp: input.timestamp,
  eventName: "http.request.completed",
  route: input.route,
  method: input.method,
  statusCode: input.statusCode,
  durationMs: input.durationMs,
  ...(input.clientAddress === undefined
    ? {}
    : { clientAddress: input.clientAddress }),
  ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
  ...(input.errorTag === undefined ? {} : { errorTag: input.errorTag }),
  ...(input.errorMessage === undefined
    ? {}
    : { errorMessage: input.errorMessage }),
})
