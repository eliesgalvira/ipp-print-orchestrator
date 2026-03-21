import { describe, expect, it } from "@effect/vitest"

import {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
  CupsCommandFailed,
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
} from "./Errors.js"

describe("Errors", () => {
  it("exposes stable typed error tags", () => {
    expect(new ValidationError({ message: "bad request" })._tag).toBe(
      "ValidationError",
    )
    expect(new BlobStoreUnavailable({ message: "io" })._tag).toBe(
      "BlobStoreUnavailable",
    )
    expect(new BlobStoreDiskFull({ message: "disk full" })._tag).toBe(
      "BlobStoreDiskFull",
    )
    expect(new JobRepoUnavailable({ message: "repo down" })._tag).toBe(
      "JobRepoUnavailable",
    )
    expect(new EventSinkUnavailable({ message: "outbox down" })._tag).toBe(
      "EventSinkUnavailable",
    )
    expect(new CupsUnavailable({ message: "cups down" })._tag).toBe(
      "CupsUnavailable",
    )
    expect(new CupsRejectedJob({ message: "rejected" })._tag).toBe(
      "CupsRejectedJob",
    )
    expect(new CupsCommandFailed({ message: "lp failed" })._tag).toBe(
      "CupsCommandFailed",
    )
    expect(new PrinterUsbDetached({ message: "usb missing" })._tag).toBe(
      "PrinterUsbDetached",
    )
    expect(new PrinterNotReady({ message: "warming up" })._tag).toBe(
      "PrinterNotReady",
    )
    expect(new NetworkOffline({ message: "offline" })._tag).toBe(
      "NetworkOffline",
    )
    expect(new TelemetryUnavailable({ message: "otel down" })._tag).toBe(
      "TelemetryUnavailable",
    )
    expect(
      new SubmissionUncertainError({ message: "submission unclear" })._tag,
    ).toBe("SubmissionUncertain")
    expect(
      new StartupRecoveryFailed({ message: "reconcile failed" })._tag,
    ).toBe("StartupRecoveryFailed")
    expect(new UnsupportedFileType({ message: "exe" })._tag).toBe(
      "UnsupportedFileType",
    )
  })
})
