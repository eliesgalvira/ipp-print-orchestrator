import { Schema } from "effect"

export const JobState = Schema.Literals([
  "Received",
  "Stored",
  "Queued",
  "Submitting",
  "Submitted",
  "Printing",
  "Completed",
  "WaitingForPrinter",
  "WaitingForCups",
  "RetryScheduled",
  "SubmissionUncertain",
  "FailedTerminal",
  "Cancelled",
])

export type JobState = typeof JobState.Type

export const terminalJobStates = new Set<JobState>([
  "Completed",
  "FailedTerminal",
  "Cancelled",
])
