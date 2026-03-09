import { Effect, Layer, Ref } from "effect"

import { terminalJobStates } from "../../../apps/agent/src/domain/JobState.js"
import { JobRepoUnavailable } from "../../../apps/agent/src/domain/Errors.js"
import type { Job } from "../../../apps/agent/src/domain/Job.js"
import type { JobId } from "../../../apps/agent/src/domain/JobId.js"
import type { WideEvent } from "../../../apps/agent/src/domain/WideEvent.js"
import { JobRepo } from "../../../apps/agent/src/services/JobRepo.js"

export const layer = Layer.effect(
  JobRepo,
  Effect.gen(function* () {
    const jobsRef = yield* Ref.make(new Map<string, Job>())
    const transitionsRef = yield* Ref.make(new Map<string, readonly WideEvent[]>())

    const create = (job: Job) =>
      Ref.update(jobsRef, (jobs) => {
        jobs.set(String(job.id), job)
        return jobs
      }).pipe(Effect.asVoid)

    const get = (jobId: JobId) =>
      Ref.get(jobsRef).pipe(
        Effect.flatMap((jobs) => {
          const job = jobs.get(String(jobId))
          return job === undefined
            ? Effect.fail(
                JobRepoUnavailable.make({
                  message: `missing job ${String(jobId)}`,
                }),
              )
            : Effect.succeed(job)
        }),
      )

    const save = (job: Job) =>
      Ref.update(jobsRef, (jobs) => {
        jobs.set(String(job.id), job)
        return jobs
      }).pipe(Effect.asVoid)

    const appendTransition = (jobId: JobId, event: WideEvent) =>
      Ref.update(transitionsRef, (transitions) => {
        const current = transitions.get(String(jobId)) ?? []
        transitions.set(String(jobId), [...current, event])
        return transitions
      }).pipe(Effect.asVoid)

    const getTransitions = (jobId: JobId) =>
      Ref.get(transitionsRef).pipe(
        Effect.map((transitions) => transitions.get(String(jobId)) ?? []),
      )

    const listNonTerminal = () =>
      Ref.get(jobsRef).pipe(
        Effect.map((jobs) =>
          [...jobs.values()].filter((job) => !terminalJobStates.has(job.state)),
        ),
      )

    return JobRepo.of({
      create,
      get,
      save,
      appendTransition,
      getTransitions,
      listNonTerminal,
    })
  }),
)
