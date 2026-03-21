import { Schema } from "effect"

class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  {
    message: Schema.String,
  },
) {}

class BlobStoreUnavailable extends Schema.TaggedErrorClass<BlobStoreUnavailable>()(
  "BlobStoreUnavailable",
  {
    message: Schema.String,
  },
) {}

class BlobStoreDiskFull extends Schema.TaggedErrorClass<BlobStoreDiskFull>()(
  "BlobStoreDiskFull",
  {
    message: Schema.String,
  },
) {}

class JobRepoUnavailable extends Schema.TaggedErrorClass<JobRepoUnavailable>()(
  "JobRepoUnavailable",
  {
    message: Schema.String,
  },
) {}

class EventSinkUnavailable extends Schema.TaggedErrorClass<EventSinkUnavailable>()(
  "EventSinkUnavailable",
  {
    message: Schema.String,
  },
) {}

class CupsUnavailable extends Schema.TaggedErrorClass<CupsUnavailable>()(
  "CupsUnavailable",
  {
    message: Schema.String,
  },
) {}

class CupsRejectedJob extends Schema.TaggedErrorClass<CupsRejectedJob>()(
  "CupsRejectedJob",
  {
    message: Schema.String,
  },
) {}

class CupsCommandFailed extends Schema.TaggedErrorClass<CupsCommandFailed>()(
  "CupsCommandFailed",
  {
    message: Schema.String,
  },
) {}

class CupsIppUnavailable extends Schema.TaggedErrorClass<CupsIppUnavailable>()(
  "CupsIppUnavailable",
  {
    message: Schema.String,
  },
) {}

class CupsIppProtocolError extends Schema.TaggedErrorClass<CupsIppProtocolError>()(
  "CupsIppProtocolError",
  {
    message: Schema.String,
  },
) {}

class CupsIppJobNotFound extends Schema.TaggedErrorClass<CupsIppJobNotFound>()(
  "CupsIppJobNotFound",
  {
    message: Schema.String,
  },
) {}

class PrinterUsbDetached extends Schema.TaggedErrorClass<PrinterUsbDetached>()(
  "PrinterUsbDetached",
  {
    message: Schema.String,
  },
) {}

class PrinterNotReady extends Schema.TaggedErrorClass<PrinterNotReady>()(
  "PrinterNotReady",
  {
    message: Schema.String,
  },
) {}

class NetworkOffline extends Schema.TaggedErrorClass<NetworkOffline>()(
  "NetworkOffline",
  {
    message: Schema.String,
  },
) {}

class TelemetryUnavailable extends Schema.TaggedErrorClass<TelemetryUnavailable>()(
  "TelemetryUnavailable",
  {
    message: Schema.String,
  },
) {}

class SubmissionUncertainError extends Schema.TaggedErrorClass<SubmissionUncertainError>()(
  "SubmissionUncertain",
  {
    message: Schema.String,
  },
) {}

class StartupRecoveryFailed extends Schema.TaggedErrorClass<StartupRecoveryFailed>()(
  "StartupRecoveryFailed",
  {
    message: Schema.String,
  },
) {}

class UnsupportedFileType extends Schema.TaggedErrorClass<UnsupportedFileType>()(
  "UnsupportedFileType",
  {
    message: Schema.String,
  },
) {}

export {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
  CupsCommandFailed,
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
  CupsRejectedJob,
  CupsUnavailable,
  EventSinkUnavailable,
  JobRepoUnavailable,
  NetworkOffline,
  PrinterNotReady,
  PrinterUsbDetached,
  StartupRecoveryFailed,
  SubmissionUncertainError,
  TelemetryUnavailable,
  UnsupportedFileType,
  ValidationError,
}

export const OperationalError = Schema.Union([
  ValidationError,
  BlobStoreUnavailable,
  BlobStoreDiskFull,
  JobRepoUnavailable,
  EventSinkUnavailable,
  CupsUnavailable,
  CupsRejectedJob,
  CupsCommandFailed,
  CupsIppUnavailable,
  CupsIppProtocolError,
  CupsIppJobNotFound,
  PrinterUsbDetached,
  PrinterNotReady,
  NetworkOffline,
  TelemetryUnavailable,
  SubmissionUncertainError,
  StartupRecoveryFailed,
  UnsupportedFileType,
])

export type OperationalError = typeof OperationalError.Type
