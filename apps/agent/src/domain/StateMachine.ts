import { Match } from "effect"

import { Job } from "./Job.js"
import type { JobId } from "./JobId.js"
import type { JobState } from "./JobState.js"
import { terminalJobStates } from "./JobState.js"
import { WideEvent } from "./WideEvent.js"

export type TransitionAction =
  | { readonly _tag: "Stored" }
  | { readonly _tag: "Queued" }
  | { readonly _tag: "SubmissionAttemptStarted" }
  | { readonly _tag: "Submitted"; readonly cupsJobId: string }
  | { readonly _tag: "Printing" }
  | { readonly _tag: "Completed" }
  | { readonly _tag: "PrinterUnavailable"; readonly reason: string }
  | { readonly _tag: "CupsUnavailable"; readonly reason: string }
  | { readonly _tag: "RetryScheduled"; readonly reason: string }
  | { readonly _tag: "SubmissionUncertain"; readonly reason: string }
  | { readonly _tag: "FailedTerminal"; readonly reason: string }
  | { readonly _tag: "Cancelled" }

type TransitionActionTag = TransitionAction["_tag"]

export interface CreateJobInput {
  readonly id: JobId
  readonly requestId: string
  readonly printerName: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly createdAt: string
}

export interface TransitionApplied {
  readonly _tag: "TransitionApplied"
  readonly job: Job
  readonly event: WideEvent
}

export interface InvalidTransition {
  readonly _tag: "InvalidTransition"
  readonly currentState: JobState
  readonly attempted: TransitionActionTag
  readonly reason: string
}

export type TransitionResult = TransitionApplied | InvalidTransition

const allowedTransitions: Record<JobState, readonly TransitionActionTag[]> = {
  Received: ["Stored", "Cancelled", "FailedTerminal"],
  Stored: ["Queued", "Cancelled", "FailedTerminal"],
  Queued: [
    "SubmissionAttemptStarted",
    "PrinterUnavailable",
    "CupsUnavailable",
    "RetryScheduled",
    "Cancelled",
    "FailedTerminal",
  ],
  Submitting: [
    "Submitted",
    "PrinterUnavailable",
    "CupsUnavailable",
    "RetryScheduled",
    "SubmissionUncertain",
    "Cancelled",
    "FailedTerminal",
  ],
  Submitted: [
    "Printing",
    "Completed",
    "SubmissionUncertain",
    "Cancelled",
    "FailedTerminal",
  ],
  Printing: ["Completed", "SubmissionUncertain", "Cancelled", "FailedTerminal"],
  Completed: [],
  WaitingForPrinter: [
    "RetryScheduled",
    "SubmissionAttemptStarted",
    "Cancelled",
    "FailedTerminal",
  ],
  WaitingForCups: [
    "RetryScheduled",
    "SubmissionAttemptStarted",
    "Cancelled",
    "FailedTerminal",
  ],
  RetryScheduled: [
    "Queued",
    "SubmissionAttemptStarted",
    "PrinterUnavailable",
    "CupsUnavailable",
    "Cancelled",
    "FailedTerminal",
  ],
  SubmissionUncertain: [
    "Submitted",
    "Printing",
    "Completed",
    "Cancelled",
    "FailedTerminal",
  ],
  FailedTerminal: [],
  Cancelled: [],
}

const nextStateForAction = Match.typeTags<TransitionAction, JobState>()({
  Stored: () => "Stored",
  Queued: () => "Queued",
  SubmissionAttemptStarted: () => "Submitting",
  Submitted: () => "Submitted",
  Printing: () => "Printing",
  Completed: () => "Completed",
  PrinterUnavailable: () => "WaitingForPrinter",
  CupsUnavailable: () => "WaitingForCups",
  RetryScheduled: () => "RetryScheduled",
  SubmissionUncertain: () => "SubmissionUncertain",
  FailedTerminal: () => "FailedTerminal",
  Cancelled: () => "Cancelled",
})

const eventNameForAction = Match.typeTags<
  TransitionAction,
  WideEvent["eventName"]
>()({
  Stored: () => "print.job.stored",
  Queued: () => "print.job.queued",
  SubmissionAttemptStarted: () => "print.job.submission.attempt",
  Submitted: () => "print.job.submitted",
  Printing: () => "print.job.state.changed",
  Completed: () => "print.job.completed",
  PrinterUnavailable: () => "print.job.state.changed",
  CupsUnavailable: () => "print.job.state.changed",
  RetryScheduled: () => "print.job.state.changed",
  SubmissionUncertain: () => "print.job.state.changed",
  FailedTerminal: () => "print.job.failed",
  Cancelled: () => "print.job.state.changed",
})

const errorDetailsForAction = Match.typeTags<
  TransitionAction,
  { readonly errorTag?: string; readonly errorMessage?: string }
>()({
  Stored: () => ({}),
  Queued: () => ({}),
  SubmissionAttemptStarted: () => ({}),
  Submitted: () => ({}),
  Printing: () => ({}),
  Completed: () => ({}),
  PrinterUnavailable: (action) => ({
    errorTag: "PrinterNotReady",
    errorMessage: action.reason,
  }),
  CupsUnavailable: (action) => ({
    errorTag: "CupsUnavailable",
    errorMessage: action.reason,
  }),
  RetryScheduled: (action) => ({
    errorTag: "RetryScheduled",
    errorMessage: action.reason,
  }),
  SubmissionUncertain: (action) => ({
    errorTag: "SubmissionUncertain",
    errorMessage: action.reason,
  }),
  FailedTerminal: (action) => ({
    errorTag: "FailedTerminal",
    errorMessage: action.reason,
  }),
  Cancelled: () => ({}),
})

const elapsedMs = (from: string, to: string): number | undefined => {
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return undefined
  }
  return Math.max(0, toMs - fromMs)
}

export const createJob = (input: CreateJobInput): Job =>
  new Job({
    ...input,
    state: "Received",
    retryCount: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })

export const transitionJob = (
  job: Job,
  action: TransitionAction,
  occurredAt: string,
): TransitionResult => {
  if (terminalJobStates.has(job.state)) {
    return {
      _tag: "InvalidTransition",
      currentState: job.state,
      attempted: action._tag,
      reason: `State ${job.state} is terminal`,
    }
  }

  const allowed = allowedTransitions[job.state]
  if (!allowed.includes(action._tag)) {
    return {
      _tag: "InvalidTransition",
      currentState: job.state,
      attempted: action._tag,
      reason: `Cannot apply ${action._tag} from ${job.state}`,
    }
  }

  const nextState = nextStateForAction(action)
  const nextRetryCount =
    action._tag === "RetryScheduled" ? job.retryCount + 1 : job.retryCount
  const nextCupsJobId =
    action._tag === "Submitted" ? action.cupsJobId : job.cupsJobId
  const errorDetails = errorDetailsForAction(action)
  const attemptNumber = nextRetryCount + 1
  const jobDurationMs = elapsedMs(job.createdAt, occurredAt)
  const timeToSubmitMs =
    action._tag === "Submitted"
      ? elapsedMs(job.createdAt, occurredAt)
      : undefined
  const timeToTerminalMs = terminalJobStates.has(nextState)
    ? elapsedMs(job.createdAt, occurredAt)
    : undefined

  const nextJob = new Job({
    ...job,
    state: nextState,
    retryCount: nextRetryCount,
    updatedAt: occurredAt,
    ...(nextCupsJobId === undefined ? {} : { cupsJobId: nextCupsJobId }),
  })

  const event = new WideEvent({
    timestamp: occurredAt,
    eventName: eventNameForAction(action),
    requestId: job.requestId,
    printId: job.id,
    printerName: job.printerName,
    fileName: job.fileName,
    mimeType: job.mimeType,
    fileSize: job.fileSize,
    retryCount: nextRetryCount,
    attemptNumber,
    currentState: nextState,
    previousState: job.state,
    ...(nextCupsJobId === undefined ? {} : { cupsJobId: nextCupsJobId }),
    ...(jobDurationMs === undefined ? {} : { jobDurationMs }),
    ...(timeToSubmitMs === undefined ? {} : { timeToSubmitMs }),
    ...(timeToTerminalMs === undefined ? {} : { timeToTerminalMs }),
    ...(errorDetails.errorTag === undefined
      ? {}
      : { errorTag: errorDetails.errorTag }),
    ...(errorDetails.errorMessage === undefined
      ? {}
      : { errorMessage: errorDetails.errorMessage }),
  })

  return {
    _tag: "TransitionApplied",
    job: nextJob,
    event,
  }
}
