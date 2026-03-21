import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { EventSinkUnavailable, TelemetryUnavailable } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import type { JobId } from "../domain/JobId.js"
import { terminalJobStates, type JobState } from "../domain/JobState.js"
import { WideEvent } from "../domain/WideEvent.js"

export class WideEventPublisher extends ServiceMap.Service<
  WideEventPublisher,
  {
  readonly emit: (
    event: WideEvent,
  ) => Effect.Effect<void, EventSinkUnavailable | TelemetryUnavailable>
  }
>()("@ipp/agent/observability/WideEventPublisher") {}

const elapsedMs = (from: string, to: string): number | undefined => {
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return undefined
  }
  return Math.max(0, toMs - fromMs)
}

export interface QueueEventInput {
  readonly timestamp: string
  readonly eventName: "queue.job.enqueued" | "queue.job.dequeued"
  readonly printId: JobId
  readonly queueDepth: number
}

export const makeQueueEvent = (input: QueueEventInput): WideEvent =>
  new WideEvent({
    timestamp: input.timestamp,
    eventName: input.eventName,
    printId: input.printId,
    queueDepth: input.queueDepth,
  })

export interface HttpRequestCompletedEventInput {
  readonly timestamp: string
  readonly route: string
  readonly method: string
  readonly statusCode: number
  readonly durationMs: number
  readonly clientAddress?: string | undefined
  readonly userAgent?: string | undefined
  readonly requestId?: string | undefined
  readonly printId?: JobId | undefined
  readonly errorTag?: string | undefined
  readonly errorMessage?: string | undefined
}

export const makeHttpRequestCompletedEvent = (
  input: HttpRequestCompletedEventInput,
): WideEvent =>
  new WideEvent({
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
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.printId === undefined ? {} : { printId: input.printId }),
    ...(input.errorTag === undefined ? {} : { errorTag: input.errorTag }),
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
  })

export interface JobOutcomeEventInput {
  readonly timestamp: string
  readonly job: Job
  readonly finalState: JobState
  readonly errorTag?: string | undefined
  readonly errorMessage?: string | undefined
}

export const makeJobOutcomeEvent = (
  input: JobOutcomeEventInput,
): WideEvent | null => {
  if (!terminalJobStates.has(input.finalState)) {
    return null
  }

  return new WideEvent({
    timestamp: input.timestamp,
    eventName: "print.job.outcome",
    requestId: input.job.requestId,
    printId: input.job.id,
    printerName: input.job.printerName,
    fileName: input.job.fileName,
    mimeType: input.job.mimeType,
    fileSize: input.job.fileSize,
    retryCount: input.job.retryCount,
    currentState: input.finalState,
    finalState: input.finalState,
    cupsJobId: input.job.cupsJobId,
    attemptNumber: input.job.retryCount + 1,
    acceptedAt: input.job.createdAt,
    terminalAt: input.timestamp,
    ...(elapsedMs(input.job.createdAt, input.timestamp) === undefined
      ? {}
      : { timeToTerminalMs: elapsedMs(input.job.createdAt, input.timestamp) }),
    ...(input.errorTag === undefined ? {} : { errorTag: input.errorTag }),
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
  })
}
