import { Clock, Effect, Layer, Option, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { randomUUID } from "node:crypto"

import { JobId } from "../domain/JobId.js"
import {
  makeHttpRequestCompletedEvent,
  WideEventPublisher,
} from "../observability/WideEventPublisher.js"
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

interface HttpEventContext {
  requestId?: string
  printId?: JobId
  errorTag?: string
  errorMessage?: string
}

const instrumentRoute = <E, R>(
  route: string,
  method: "GET" | "POST",
  handler: (
    context: HttpEventContext,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const request = yield* HttpServerRequest.HttpServerRequest
    const startedAtMs = yield* Clock.currentTimeMillis
    const context: HttpEventContext = {}

    const response = yield* handler(context)

    const finishedAtMs = yield* Clock.currentTimeMillis
    const clientAddress = Option.getOrUndefined(request.remoteAddress)
    const userAgent = Option.getOrUndefined(Headers.get(request.headers, "user-agent"))

    yield* wideEventPublisher.emit(
      makeHttpRequestCompletedEvent({
        timestamp: new Date(finishedAtMs).toISOString(),
        route,
        method,
        statusCode: response.status,
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        clientAddress,
        userAgent,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
        ...(context.printId === undefined ? {} : { printId: context.printId }),
        ...(context.errorTag === undefined ? {} : { errorTag: context.errorTag }),
        ...(context.errorMessage === undefined
          ? {}
          : { errorMessage: context.errorMessage }),
      }),
    ).pipe(Effect.catch(() => Effect.void))

    return response
  })

export const HttpRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/v1/health",
    instrumentRoute("/v1/health", "GET", () =>
      HttpServerResponse.json({ ok: true }).pipe(
        Effect.catch((error) =>
          serviceUnavailable(String(error)),
        ),
      )),
  ),
  HttpRouter.add(
    "GET",
    "/v1/status",
    instrumentRoute("/v1/status", "GET", () =>
      Effect.gen(function* () {
        const heartbeat = yield* Heartbeat
        const snapshot = yield* heartbeat.snapshot()
        return yield* HttpServerResponse.json({
          appUp: snapshot.appUp,
          cupsReachable: snapshot.cupsReachable,
          printerAttached: snapshot.printerAttached,
          printerQueueAvailable: snapshot.printerQueueAvailable,
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
        Effect.catch((error) => serviceUnavailable(String(error))),
      ),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/v1/jobs",
    instrumentRoute("/v1/jobs", "POST", (context) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator
        const body = yield* HttpServerRequest.schemaBodyJson(SubmitJobBody)
        const requestId = body.requestId ?? randomUUID()
        context.requestId = requestId
        const bytes = Uint8Array.from(Buffer.from(body.contentBase64, "base64"))
        const job = yield* orchestrator.submit({
          id: JobId.makeUnsafe(randomUUID()),
          requestId,
          fileName: body.fileName,
          mimeType: body.mimeType,
          bytes,
        })

        context.printId = job.id

        return yield* HttpServerResponse.json(
          {
            jobId: String(job.id),
            state: job.state,
          },
          { status: 202 },
        )
      }).pipe(
        Effect.catchTag("UnsupportedFileType", (error) => {
          context.errorTag = error._tag
          context.errorMessage = error.message
          return badRequest(error.message)
        }),
        Effect.catch((error) => {
          context.errorTag = "HttpRouteFailure"
          context.errorMessage = String(error)
          return serviceUnavailable(String(error))
        }),
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/v1/jobs/:id",
    instrumentRoute("/v1/jobs/:id", "GET", (context) =>
      Effect.gen(function* () {
        const jobRepo = yield* JobRepo
        const { id } = yield* HttpRouter.schemaPathParams(JobPathParams)
        context.printId = id
        const job = yield* jobRepo.getOption(id)

        if (job === null) {
          context.errorTag = "JobNotFound"
          context.errorMessage = `job ${String(id)} not found`
          return yield* notFound(`job ${String(id)} not found`)
        }

        context.requestId = job.requestId

        return yield* HttpServerResponse.json({
          jobId: String(job.id),
          state: job.state,
          fileName: job.fileName,
          mimeType: job.mimeType,
          printerName: job.printerName,
          cupsJobId: job.cupsJobId,
        })
      }).pipe(
        Effect.catch((error) => {
          context.errorTag = "HttpRouteFailure"
          context.errorMessage = String(error)
          return serviceUnavailable(String(error))
        }),
      ),
    ),
  ),
)
