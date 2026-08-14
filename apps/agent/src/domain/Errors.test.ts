import { describe, expect, it } from "@effect/vitest"

import {
  CupsCommandFailed,
  CupsTmpDirFull,
  CupsUnavailable,
  OutputGuardRejected,
  TelemetryUnavailable,
  ValidationError,
} from "./Errors.js"

describe("Errors", () => {
  it("exposes the operational error tags that still cross module boundaries", () => {
    expect(new ValidationError({ message: "bad request" })._tag).toBe(
      "ValidationError",
    )
    expect(new CupsUnavailable({ message: "cups down" })._tag).toBe(
      "CupsUnavailable",
    )
    expect(new CupsCommandFailed({ message: "lp failed" })._tag).toBe(
      "CupsCommandFailed",
    )
    expect(new CupsTmpDirFull({ message: "no tmp space" })._tag).toBe(
      "CupsTmpDirFull",
    )
    expect(
      new OutputGuardRejected({
        reason: "oversized-output",
        message: "too large",
        actualBytes: 42,
      })._tag,
    ).toBe("OutputGuardRejected")
    expect(new TelemetryUnavailable({ message: "otel down" })._tag).toBe(
      "TelemetryUnavailable",
    )
  })
})
