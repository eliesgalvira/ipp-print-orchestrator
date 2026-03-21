import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"

import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { EventSink } from "../services/EventSink.js"
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
  printerQueueAvailable: Schema.Boolean,
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
  it.effect("supports health, status, submit, and get job", () =>
    Effect.gen(function* () {
      const httpApp = yield* HttpRouter.toHttpEffect(HttpRoutes)
      yield* HttpServer.serveEffect(httpApp)

      const health = yield* HttpClient.get("/v1/health").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(HealthResponse)),
      )
      expect(health.ok).toBe(true)

      const submit = yield* HttpClientRequest.post("/v1/jobs").pipe(
        HttpClientRequest.bodyJsonUnsafe({
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
      expect(status.printerQueueAvailable).toBe(true)
      expect(status.nonterminalJobCount).toBeGreaterThanOrEqual(1)
    }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.provide(apiLayer)))

  it.effect("returns 400 for unsupported file types", () =>
    Effect.gen(function* () {
      const httpApp = yield* HttpRouter.toHttpEffect(HttpRoutes)
      yield* HttpServer.serveEffect(httpApp)

      const response = yield* HttpClientRequest.post("/v1/jobs").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          fileName: "malware.exe",
          mimeType: "application/x-msdownload",
          contentBase64: Buffer.from("oops").toString("base64"),
        }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.provide(apiLayer)))

  it.effect("emits canonical http request events", () =>
    Effect.gen(function* () {
      const httpApp = yield* HttpRouter.toHttpEffect(HttpRoutes)
      yield* HttpServer.serveEffect(httpApp)

      yield* HttpClient.get("/v1/health")
      const submit = yield* HttpClientRequest.post("/v1/jobs").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          fileName: "document.pdf",
          mimeType: "application/pdf",
          contentBase64: Buffer.from("hello world").toString("base64"),
          requestId: "req-http-events",
        }),
        HttpClient.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SubmitJobResponse)),
      )

      const eventSink = yield* EventSink
      const events = yield* eventSink.all()
      const httpEvents = events.filter((event) => event.eventName === "http.request.completed")

      expect(httpEvents.length).toBeGreaterThanOrEqual(2)
      expect(
        httpEvents.some(
          (event) =>
            event.route === "/v1/health" &&
            event.method === "GET" &&
            event.statusCode === 200,
        ),
      ).toBe(true)
      expect(
        httpEvents.some(
          (event) =>
            event.route === "/v1/jobs" &&
            event.method === "POST" &&
            event.statusCode === 202 &&
            event.requestId === "req-http-events" &&
            event.printId === submit.jobId,
        ),
      ).toBe(true)
    }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.provide(apiLayer)))
})
