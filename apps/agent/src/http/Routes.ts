import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect, Schema } from "effect"
import { randomUUID } from "node:crypto"

import { JobId } from "../domain/JobId.js"
import { Heartbeat } from "../services/Heartbeat.js"
import { JobRepo } from "../services/JobRepo.js"
import { Orchestrator } from "../services/Orchestrator.js"

const SubmitJobBody = Schema.Struct({
  fileName: Schema.String,
  mimeType: Schema.String,
  contentBase64: Schema.String,
  requestId: Schema.optional(Schema.String),
})

const JobPathParams = Schema.Struct({
  id: JobId,
})

const badRequest = (message: string) =>
  HttpServerResponse.json({ error: message }, { status: 400 })

const notFound = (message: string) =>
  HttpServerResponse.json({ error: message }, { status: 404 })

const serviceUnavailable = (message: string) =>
  HttpServerResponse.json({ error: message }, { status: 503 })

export const HttpRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/v1/health", HttpServerResponse.json({ ok: true })),
  HttpRouter.get(
    "/v1/status",
    Effect.gen(function* () {
      const heartbeat = yield* Heartbeat
      const snapshot = yield* heartbeat.snapshot()
      return yield* HttpServerResponse.json({
        appUp: snapshot.appUp,
        cupsReachable: snapshot.cupsReachable,
        printerAttached: snapshot.printerAttached,
        printerState: snapshot.printerState,
        printerReasons: snapshot.printerReasons,
        printerMessage: snapshot.printerMessage,
        queueDepth: snapshot.queueDepth,
        nonterminalJobCount: snapshot.nonterminalJobCount,
        lastSuccessfulHeartbeatAt: snapshot.lastSuccessfulHeartbeatAt,
        networkOnline: snapshot.networkOnline,
        localIps: snapshot.localIps,
        hostname: snapshot.hostname,
      })
    }).pipe(
      Effect.catchAll((error) => serviceUnavailable(String(error))),
    ),
  ),
  HttpRouter.post(
    "/v1/jobs",
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const body = yield* HttpServerRequest.schemaBodyJson(SubmitJobBody)
      const bytes = Uint8Array.from(Buffer.from(body.contentBase64, "base64"))
      const job = yield* orchestrator.submit({
        id: JobId.make(randomUUID()),
        requestId: body.requestId ?? randomUUID(),
        fileName: body.fileName,
        mimeType: body.mimeType,
        bytes,
      })

      return yield* HttpServerResponse.json(
        {
          jobId: String(job.id),
          state: job.state,
        },
        { status: 202 },
      )
    }).pipe(
      Effect.catchTag("UnsupportedFileType", (error) => badRequest(error.message)),
      Effect.catchAll((error) => serviceUnavailable(String(error))),
    ),
  ),
  HttpRouter.get(
    "/v1/jobs/:id",
    Effect.gen(function* () {
      const jobRepo = yield* JobRepo
      const { id } = yield* HttpRouter.schemaPathParams(JobPathParams)
      const job = yield* jobRepo.getOption(id)

      if (job === null) {
        return yield* notFound(`job ${String(id)} not found`)
      }

      return yield* HttpServerResponse.json({
        jobId: String(job.id),
        state: job.state,
        fileName: job.fileName,
        mimeType: job.mimeType,
        printerName: job.printerName,
        cupsJobId: job.cupsJobId,
      })
    }).pipe(
      Effect.catchAll((error) => serviceUnavailable(String(error))),
    ),
  ),
)
