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
  requestId: Schema.optional(Schema.String),
  printId: Schema.optional(JobId),
  printerName: Schema.optional(Schema.String),
  fileName: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  fileSize: Schema.optional(Schema.Number),
  retryCount: Schema.optional(Schema.Number),
  currentState: Schema.optional(JobState),
  previousState: Schema.optional(JobState),
  cupsJobId: Schema.optional(Schema.String),
  errorTag: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  appUp: Schema.optional(Schema.Boolean),
  hostname: Schema.optional(Schema.String),
  networkOnline: Schema.optional(Schema.Boolean),
  localIps: Schema.optional(Schema.Array(Schema.String)),
  cupsReachable: Schema.optional(Schema.Boolean),
  printerAttached: Schema.optional(Schema.Boolean),
  queueDepth: Schema.optional(Schema.Number),
  nonterminalJobCount: Schema.optional(Schema.Number),
  lastSuccessfulHeartbeatAt: Schema.optional(Schema.NullOr(Schema.String)),
}) {}
