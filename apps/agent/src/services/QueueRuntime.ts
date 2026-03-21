import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import type { JobId } from "../domain/JobId.js"

export class QueueRuntime extends ServiceMap.Service<
  QueueRuntime,
  {
    readonly enqueue: (jobId: JobId) => Effect.Effect<void>
    readonly take: () => Effect.Effect<JobId>
    readonly size: () => Effect.Effect<number>
  }
>()("@ipp/agent/QueueRuntime") {}
