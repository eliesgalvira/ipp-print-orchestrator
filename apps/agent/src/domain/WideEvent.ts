import { Schema } from "effect"

import { JobId } from "./JobId.js"
import { JobState } from "./JobState.js"

export const WideEventName = Schema.Literal(
  "print.request.received",
  "print.job.stored",
  "print.job.queued",
  "print.job.submission.attempt",
  "print.job.submitted",
  "print.job.state.changed",
  "print.job.completed",
  "print.job.failed",
  "heartbeat",
  "startup.reconciliation.started",
  "startup.reconciliation.completed",
)

export type WideEventName = typeof WideEventName.Type

export class WideEvent extends Schema.Class<WideEvent>("WideEvent")({
  timestamp: Schema.String,
  eventName: WideEventName,
  requestId: Schema.String,
  printId: JobId,
  printerName: Schema.String,
  fileName: Schema.String,
  mimeType: Schema.String,
  fileSize: Schema.Number,
  retryCount: Schema.Number,
  currentState: JobState,
  previousState: Schema.optional(JobState),
  cupsJobId: Schema.optional(Schema.String),
  errorTag: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
}) {}
