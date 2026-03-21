import { Clock, Effect, Layer, Queue } from "effect"

import type { JobId } from "../domain/JobId.js"
import { makeQueueEvent, WideEventPublisher } from "../observability/WideEventPublisher.js"
import { QueueRuntime } from "../services/QueueRuntime.js"

export const QueueRuntimeLive = Layer.effect(
  QueueRuntime,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<JobId>()
    const wideEventPublisher = yield* WideEventPublisher

    const enqueue = Effect.fn("QueueRuntime.enqueue")(function* (jobId: JobId) {
      yield* Queue.offer(queue, jobId).pipe(Effect.asVoid)
      const queueDepth = yield* Queue.size(queue)
      const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString()
      yield* wideEventPublisher.emit(
        makeQueueEvent({
          timestamp,
          eventName: "queue.job.enqueued",
          printId: jobId,
          queueDepth,
        }),
      ).pipe(Effect.catchAll(() => Effect.void))
    })

    const take = Effect.fn("QueueRuntime.take")(function* () {
      const jobId = yield* Queue.take(queue)
      const queueDepth = yield* Queue.size(queue)
      const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString()
      yield* wideEventPublisher.emit(
        makeQueueEvent({
          timestamp,
          eventName: "queue.job.dequeued",
          printId: jobId,
          queueDepth,
        }),
      ).pipe(Effect.catchAll(() => Effect.void))
      return jobId
    })

    const size = Effect.fn("QueueRuntime.size")(function* () {
      return yield* Queue.size(queue)
    })

    return QueueRuntime.of({
      enqueue,
      take,
      size,
    })
  }),
)
