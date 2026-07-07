import { Effect } from "effect"

import type { Job } from "../domain/Job.js"
import type { TransitionAction } from "../domain/StateMachine.js"
import { transitionJob } from "../domain/StateMachine.js"
import type { WideEvent } from "../domain/WideEvent.js"
import {
  makeJobOutcomeEvent,
  type WideEventPublisher,
} from "../observability/WideEventPublisher.js"
import type { JobRepo } from "./JobRepo.js"

type JobRepoService = typeof JobRepo.Service
type WideEventPublisherService = typeof WideEventPublisher.Service

interface JobJournalDeps {
  readonly jobRepo: JobRepoService
  readonly wideEventPublisher: WideEventPublisherService
}

export const recordInitialJob = (
  params: JobJournalDeps & {
    readonly job: Job
    readonly receivedEvent: WideEvent
  },
) =>
  Effect.gen(function* () {
    yield* params.jobRepo.create(params.job)
    yield* params.jobRepo.appendTransition(params.job.id, params.receivedEvent)
    yield* params.wideEventPublisher.emit(params.receivedEvent)
    return params.job
  })

export const recordTransition = (
  params: JobJournalDeps & {
    readonly job: Job
    readonly event: WideEvent
  },
) =>
  Effect.gen(function* () {
    yield* params.jobRepo.save(params.job)
    yield* params.jobRepo.appendTransition(params.job.id, params.event)
    yield* params.wideEventPublisher.emit(params.event)

    const outcomeEvent = makeJobOutcomeEvent({
      timestamp: params.event.timestamp,
      job: params.job,
      finalState: params.job.state,
      errorTag: params.event.errorTag,
      errorMessage: params.event.errorMessage,
    })

    if (outcomeEvent !== null) {
      yield* params.wideEventPublisher.emit(outcomeEvent)
    }

    return params.job
  })

export const applyJobTransition = (
  params: JobJournalDeps & {
    readonly job: Job
    readonly action: TransitionAction
    readonly occurredAt: string
  },
) => {
  const result = transitionJob(params.job, params.action, params.occurredAt)
  if (result._tag === "InvalidTransition") {
    return Effect.die(new Error(result.reason))
  }

  return recordTransition({
    jobRepo: params.jobRepo,
    wideEventPublisher: params.wideEventPublisher,
    job: result.job,
    event: result.event,
  })
}
