import { Context, Effect } from "effect"

import type { JobId } from "../domain/JobId.js"

export class QueueRuntime extends Context.Tag("@ipp/agent/QueueRuntime")<
  QueueRuntime,
  {
    readonly enqueue: (jobId: JobId) => Effect.Effect<void>
    readonly take: () => Effect.Effect<JobId>
    readonly size: () => Effect.Effect<number>
  }
>() {}
