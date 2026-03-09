import { Effect, Layer, Queue } from "effect"

import type { JobId } from "../domain/JobId.js"
import { QueueRuntime } from "../services/QueueRuntime.js"

export const QueueRuntimeLive = Layer.effect(
  QueueRuntime,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<JobId>()

    return QueueRuntime.of({
      enqueue: (jobId) => Queue.offer(queue, jobId).pipe(Effect.asVoid),
      take: () => Queue.take(queue),
      size: () => Queue.size(queue),
    })
  }),
)
