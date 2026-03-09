import { Schema } from "effect"

class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  {
    message: Schema.String,
  },
) {}

class BlobStoreUnavailable extends Schema.TaggedError<BlobStoreUnavailable>()(
  "BlobStoreUnavailable",
  {
    message: Schema.String,
  },
) {}

class BlobStoreDiskFull extends Schema.TaggedError<BlobStoreDiskFull>()(
  "BlobStoreDiskFull",
  {
    message: Schema.String,
  },
) {}

class JobRepoUnavailable extends Schema.TaggedError<JobRepoUnavailable>()(
  "JobRepoUnavailable",
  {
    message: Schema.String,
  },
) {}

class CupsUnavailable extends Schema.TaggedError<CupsUnavailable>()(
  "CupsUnavailable",
  {
    message: Schema.String,
  },
) {}

class CupsRejectedJob extends Schema.TaggedError<CupsRejectedJob>()(
  "CupsRejectedJob",
  {
    message: Schema.String,
  },
) {}

class CupsCommandFailed extends Schema.TaggedError<CupsCommandFailed>()(
  "CupsCommandFailed",
  {
    message: Schema.String,
  },
) {}

class PrinterUsbDetached extends Schema.TaggedError<PrinterUsbDetached>()(
  "PrinterUsbDetached",
  {
    message: Schema.String,
  },
) {}

class PrinterNotReady extends Schema.TaggedError<PrinterNotReady>()(
  "PrinterNotReady",
  {
    message: Schema.String,
  },
) {}

class NetworkOffline extends Schema.TaggedError<NetworkOffline>()(
  "NetworkOffline",
  {
    message: Schema.String,
  },
) {}

class TelemetryUnavailable extends Schema.TaggedError<TelemetryUnavailable>()(
  "TelemetryUnavailable",
  {
    message: Schema.String,
  },
) {}

class SubmissionUncertainError extends Schema.TaggedError<SubmissionUncertainError>()(
  "SubmissionUncertain",
  {
    message: Schema.String,
  },
) {}

class StartupRecoveryFailed extends Schema.TaggedError<StartupRecoveryFailed>()(
  "StartupRecoveryFailed",
  {
    message: Schema.String,
  },
) {}

class UnsupportedFileType extends Schema.TaggedError<UnsupportedFileType>()(
  "UnsupportedFileType",
  {
    message: Schema.String,
  },
) {}

export {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
  CupsCommandFailed,
  CupsRejectedJob,
  CupsUnavailable,
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

export const OperationalError = Schema.Union(
  ValidationError,
  BlobStoreUnavailable,
  BlobStoreDiskFull,
  JobRepoUnavailable,
  CupsUnavailable,
  CupsRejectedJob,
  CupsCommandFailed,
  PrinterUsbDetached,
  PrinterNotReady,
  NetworkOffline,
  TelemetryUnavailable,
  SubmissionUncertainError,
  StartupRecoveryFailed,
  UnsupportedFileType,
)

export type OperationalError = typeof OperationalError.Type
