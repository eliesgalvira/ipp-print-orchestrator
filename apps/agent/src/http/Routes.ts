import { Clock, Effect, Layer, Option } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"

import { printerReadinessStatus } from "../domain/PrinterReadiness.js"
import {
  makeHttpRequestCompletedEvent,
  WideEventPublisher,
} from "../observability/WideEventPublisher.js"
import { Heartbeat } from "../services/Heartbeat.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

const serviceUnavailable = (message: string) =>
  HttpServerResponse.json({ error: message }, { status: 503 })

const instrumentRoute = <E, R>(
  route: string,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const request = yield* HttpServerRequest.HttpServerRequest
    const startedAtMs = yield* Clock.currentTimeMillis
    const response = yield* handler
    const span = yield* Effect.currentParentSpan
    const tracedResponse = HttpServerResponse.setHeader(
      response,
      "x-ipp-orch-trace-id",
      span.traceId,
    )
    const finishedAtMs = yield* Clock.currentTimeMillis

    yield* wideEventPublisher.emit(
      makeHttpRequestCompletedEvent({
        timestamp: new Date(finishedAtMs).toISOString(),
        route,
        method: "GET",
        statusCode: tracedResponse.status,
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        clientAddress: Option.getOrUndefined(request.remoteAddress),
        userAgent: Option.getOrUndefined(
          Headers.get(request.headers, "user-agent"),
        ),
      }),
    )

    return tracedResponse
  }).pipe(
    Effect.withSpan(`HTTP GET ${route}`, {
      kind: "server",
      attributes: {
        "http.request.method": "GET",
        "http.route": route,
      },
    }),
  )

export const HttpRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/v1/health",
    instrumentRoute(
      "/v1/health",
      HttpServerResponse.json({ ok: true }).pipe(
        Effect.catch((error) => serviceUnavailable(String(error))),
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/v1/status",
    instrumentRoute(
      "/v1/status",
      Effect.gen(function* () {
        const statusRuntime = yield* StatusRuntime
        const heartbeat = yield* Heartbeat
        const snapshot = yield* statusRuntime.current()
        const lastSuccessfulHeartbeatAt = yield* heartbeat.lastSuccess()
        const readiness = printerReadinessStatus(snapshot.printerReadiness)
        return yield* HttpServerResponse.json({
          appUp: true,
          ...readiness,
          lastSuccessfulHeartbeatAt,
          networkOnline: snapshot.networkOnline,
          localIps: snapshot.localIps,
          hostname: snapshot.hostname,
        })
      }).pipe(Effect.catch((error) => serviceUnavailable(String(error)))),
    ),
  ),
)
