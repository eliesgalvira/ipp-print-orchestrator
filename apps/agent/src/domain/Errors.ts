import { Schema } from "effect"

import { SplOutputGuardRejectionReasons } from "./CupsFilterOutputGuard.js"
import { PdfPreflightRejectionReason } from "./PdfPreflight.js"

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { message: Schema.String },
) {}

export class CupsUnavailable extends Schema.TaggedError<CupsUnavailable>()(
  "CupsUnavailable",
  { message: Schema.String },
) {}

export class CupsCommandFailed extends Schema.TaggedError<CupsCommandFailed>()(
  "CupsCommandFailed",
  { message: Schema.String },
) {}

export class CupsTmpDirFull extends Schema.TaggedError<CupsTmpDirFull>()(
  "CupsTmpDirFull",
  { message: Schema.String },
) {}

export class OutputGuardRejected extends Schema.TaggedError<OutputGuardRejected>()(
  "OutputGuardRejected",
  {
    reason: Schema.Literals([...SplOutputGuardRejectionReasons]),
    message: Schema.String,
    actualBytes: Schema.Number,
    expectedPages: Schema.optional(Schema.Number),
    observedPages: Schema.optional(Schema.Number),
    maxBytes: Schema.optional(Schema.Number),
  },
) {}

export class CupsIppUnavailable extends Schema.TaggedError<CupsIppUnavailable>()(
  "CupsIppUnavailable",
  { message: Schema.String },
) {}

export class CupsIppProtocolError extends Schema.TaggedError<CupsIppProtocolError>()(
  "CupsIppProtocolError",
  { message: Schema.String },
) {}

export class TelemetryUnavailable extends Schema.TaggedError<TelemetryUnavailable>()(
  "TelemetryUnavailable",
  { message: Schema.String },
) {}

export class PdfPreflightRejected extends Schema.TaggedError<PdfPreflightRejected>()(
  "PdfPreflightRejected",
  {
    reason: PdfPreflightRejectionReason,
    message: Schema.String,
    details: Schema.optional(Schema.String),
  },
) {}
