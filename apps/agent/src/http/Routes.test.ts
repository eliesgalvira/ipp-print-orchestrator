import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
} from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"

import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { HttpRoutes } from "./Routes.js"
import { makeTestLayer } from "../../../../packages/testkit/src/TestLayers.js"

class SubmitJobResponse extends Schema.Class<SubmitJobResponse>("SubmitJobResponse")({
  jobId: Schema.String,
  state: Schema.String,
}) {}

class JobResponse extends Schema.Class<JobResponse>("JobResponse")({
  jobId: Schema.String,
  state: Schema.String,
  fileName: Schema.String,
  mimeType: Schema.String,
  printerName: Schema.String,
  cupsJobId: Schema.optional(Schema.String),
}) {}

class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  ok: Schema.Boolean,
}) {}

class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  appUp: Schema.Boolean,
  cupsReachable: Schema.Boolean,
  printerAttached: Schema.Boolean,
  printerState: Schema.NullOr(Schema.String),
  printerReasons: Schema.Array(Schema.String),
  printerMessage: Schema.NullOr(Schema.String),
  queueDepth: Schema.Number,
  nonterminalJobCount: Schema.Number,
}) {}

const apiLayer = HeartbeatLive.pipe(
  Layer.provideMerge(
    makeTestLayer({
      printer: [{ attached: true, queueAvailable: true }],
      cups: [{ _tag: "Submitted", cupsJobId: "cups-http" }],
    }),
  ),
)

describe("HttpRoutes", () => {
  it.scoped("supports health, status, submit, and get job", () =>
    Effect.gen(function* () {
      yield* HttpRoutes.pipe(HttpServer.serveEffect())

      const health = yield* HttpClient.get("/v1/health").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(HealthResponse)),
      )
      expect(health.ok).toBe(true)

      const submit = yield* HttpClientRequest.post("/v1/jobs").pipe(
        HttpClientRequest.bodyUnsafeJson({
          fileName: "document.pdf",
          mimeType: "application/pdf",
          contentBase64: Buffer.from("hello world").toString("base64"),
        }),
        HttpClient.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SubmitJobResponse)),
      )

      expect(submit.state).toBe("Queued")

      const job = yield* HttpClient.get(`/v1/jobs/${submit.jobId}`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(JobResponse)),
      )
      expect(job.fileName).toBe("document.pdf")
      expect(job.state).toBe("Queued")

      const status = yield* HttpClient.get("/v1/status").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(StatusResponse)),
      )
      expect(status.appUp).toBe(true)
      expect(status.cupsReachable).toBe(true)
      expect(status.printerAttached).toBe(true)
      expect(status.nonterminalJobCount).toBeGreaterThanOrEqual(1)
    }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.provide(apiLayer)))

  it.scoped("returns 400 for unsupported file types", () =>
    Effect.gen(function* () {
      yield* HttpRoutes.pipe(HttpServer.serveEffect())

      const response = yield* HttpClientRequest.post("/v1/jobs").pipe(
        HttpClientRequest.bodyUnsafeJson({
          fileName: "malware.exe",
          mimeType: "application/x-msdownload",
          contentBase64: Buffer.from("oops").toString("base64"),
        }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.provide(apiLayer)))
})
