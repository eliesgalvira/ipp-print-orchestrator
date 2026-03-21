import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { JobRepoUnavailable } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import type { JobId } from "../domain/JobId.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class JobRepo extends ServiceMap.Service<
  JobRepo,
  {
    readonly create: (job: Job) => Effect.Effect<void, JobRepoUnavailable>
    readonly get: (jobId: JobId) => Effect.Effect<Job, JobRepoUnavailable>
    readonly getOption: (
      jobId: JobId,
    ) => Effect.Effect<Job | null, JobRepoUnavailable>
    readonly save: (job: Job) => Effect.Effect<void, JobRepoUnavailable>
    readonly appendTransition: (
      jobId: JobId,
      event: WideEvent,
    ) => Effect.Effect<void, JobRepoUnavailable>
    readonly getTransitions: (
      jobId: JobId,
    ) => Effect.Effect<readonly WideEvent[], JobRepoUnavailable>
    readonly listNonTerminal: () => Effect.Effect<readonly Job[], JobRepoUnavailable>
  }
>()("@ipp/agent/JobRepo") {}
