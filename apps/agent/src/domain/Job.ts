import { Schema } from "effect"

import { JobId } from "./JobId.js"
import { JobState } from "./JobState.js"

export class Job extends Schema.Class<Job>("Job")({
  id: JobId,
  requestId: Schema.String,
  printerName: Schema.String,
  fileName: Schema.String,
  mimeType: Schema.String,
  fileSize: Schema.Number,
  state: JobState,
  retryCount: Schema.Number,
  cupsJobId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}
