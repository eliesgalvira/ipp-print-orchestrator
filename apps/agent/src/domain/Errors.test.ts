import { describe, expect, it } from "@effect/vitest"

import {
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
} from "./Errors.js"

describe("Errors", () => {
  it("exposes stable typed error tags", () => {
    expect(ValidationError.make({ message: "bad request" })._tag).toBe(
      "ValidationError",
    )
    expect(BlobStoreUnavailable.make({ message: "io" })._tag).toBe(
      "BlobStoreUnavailable",
    )
    expect(BlobStoreDiskFull.make({ message: "disk full" })._tag).toBe(
      "BlobStoreDiskFull",
    )
    expect(JobRepoUnavailable.make({ message: "repo down" })._tag).toBe(
      "JobRepoUnavailable",
    )
    expect(CupsUnavailable.make({ message: "cups down" })._tag).toBe(
      "CupsUnavailable",
    )
    expect(CupsRejectedJob.make({ message: "rejected" })._tag).toBe(
      "CupsRejectedJob",
    )
    expect(CupsCommandFailed.make({ message: "lp failed" })._tag).toBe(
      "CupsCommandFailed",
    )
    expect(PrinterUsbDetached.make({ message: "usb missing" })._tag).toBe(
      "PrinterUsbDetached",
    )
    expect(PrinterNotReady.make({ message: "warming up" })._tag).toBe(
      "PrinterNotReady",
    )
    expect(NetworkOffline.make({ message: "offline" })._tag).toBe(
      "NetworkOffline",
    )
    expect(TelemetryUnavailable.make({ message: "otel down" })._tag).toBe(
      "TelemetryUnavailable",
    )
    expect(
      SubmissionUncertainError.make({ message: "submission unclear" })._tag,
    ).toBe("SubmissionUncertain")
    expect(
      StartupRecoveryFailed.make({ message: "reconcile failed" })._tag,
    ).toBe("StartupRecoveryFailed")
    expect(UnsupportedFileType.make({ message: "exe" })._tag).toBe(
      "UnsupportedFileType",
    )
  })
})
