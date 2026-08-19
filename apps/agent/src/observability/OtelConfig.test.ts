import { describe, expect, it } from "@effect/vitest"
import { Redacted } from "effect"

import { readOtelConfig } from "./OtelConfig.js"

const SECRET = "xaat-super-secret-token"

const env = {
  IPP_ORCH_ENABLE_OTLP: "true",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://example.invalid/v1/traces",
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://example.invalid/v1/logs",
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: `authorization=Bearer ${SECRET},x-axiom-dataset=traces`,
  OTEL_EXPORTER_OTLP_LOGS_HEADERS: `authorization=Bearer ${SECRET},x-axiom-dataset=logs`,
} satisfies NodeJS.ProcessEnv

describe("readOtelConfig", () => {
  it("never exposes header secrets through stringification", () => {
    const config = readOtelConfig(env)

    expect(JSON.stringify(config)).not.toContain(SECRET)
    expect(String(config.traces?.headers.authorization)).not.toContain(SECRET)
    expect(`${config.logs?.headers.authorization}`).toBe("<redacted>")
  })

  it("exposes header secrets only through explicit Redacted.value", () => {
    const config = readOtelConfig(env)

    expect(
      Object.values(config.traces?.headers ?? {}).map(Redacted.value),
    ).toContain(`Bearer ${SECRET}`)
    expect(
      Object.entries(config.logs?.headers ?? {}).map(([key, value]) => [
        key,
        Redacted.value(value),
      ]),
    ).toContainEqual(["x-axiom-dataset", "logs"])
  })

  it("keeps signals null when endpoints are absent", () => {
    const config = readOtelConfig({ IPP_ORCH_ENABLE_OTLP: "true" })

    expect(config.traces).toBeNull()
    expect(config.logs).toBeNull()
  })
})
