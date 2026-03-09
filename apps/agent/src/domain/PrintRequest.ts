import { Schema } from "effect"

import { JobId } from "./JobId.js"

export class PrintRequest extends Schema.Class<PrintRequest>("PrintRequest")({
  id: JobId,
  requestId: Schema.String,
  printerName: Schema.String,
  fileName: Schema.String,
  mimeType: Schema.String,
  fileSize: Schema.Number,
  createdAt: Schema.String,
}) {}
