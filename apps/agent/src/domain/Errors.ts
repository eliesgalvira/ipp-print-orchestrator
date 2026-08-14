import { Schema } from "effect"

import { SplOutputGuardRejectionReasons } from "./CupsFilterOutputGuard.js"
import { PdfPreflightRejectionReason } from "./PdfPreflight.js"

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  { message: Schema.String },
) {}

export class CupsUnavailable extends Schema.TaggedErrorClass<CupsUnavailable>()(
  "CupsUnavailable",
  { message: Schema.String },
) {}

export class CupsCommandFailed extends Schema.TaggedErrorClass<CupsCommandFailed>()(
  "CupsCommandFailed",
  { message: Schema.String },
) {}

export class CupsTmpDirFull extends Schema.TaggedErrorClass<CupsTmpDirFull>()(
  "CupsTmpDirFull",
  { message: Schema.String },
) {}

export class OutputGuardRejected extends Schema.TaggedErrorClass<OutputGuardRejected>()(
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

export class CupsIppUnavailable extends Schema.TaggedErrorClass<CupsIppUnavailable>()(
  "CupsIppUnavailable",
  { message: Schema.String },
) {}

export class CupsIppProtocolError extends Schema.TaggedErrorClass<CupsIppProtocolError>()(
  "CupsIppProtocolError",
  { message: Schema.String },
) {}

export class TelemetryUnavailable extends Schema.TaggedErrorClass<TelemetryUnavailable>()(
  "TelemetryUnavailable",
  { message: Schema.String },
) {}

export class PdfPreflightRejected extends Schema.TaggedErrorClass<PdfPreflightRejected>()(
  "PdfPreflightRejected",
  {
    reason: PdfPreflightRejectionReason,
    message: Schema.String,
    details: Schema.optional(Schema.String),
  },
) {}
