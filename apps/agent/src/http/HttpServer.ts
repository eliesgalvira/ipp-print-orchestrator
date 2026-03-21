import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, ServiceMap } from "effect"
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"
import { createServer } from "node:http"

import { AppConfig } from "../config/AppConfig.js"
import { HttpRoutes } from "./Routes.js"

const ServerLive = Layer.effect(
  HttpServer.HttpServer,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const layer = NodeHttpServer.layer(createServer, {
      port: config.bindPort,
      host: config.bindHost,
    })
    const services = yield* Layer.build(layer)
    return ServiceMap.get(services, HttpServer.HttpServer)
  }),
)

export const HttpLive = Layer.effectDiscard(
  HttpRouter.toHttpEffect(HttpRoutes).pipe(
    Effect.flatMap((httpApp) => HttpServer.serveEffect(httpApp, HttpMiddleware.logger)),
    Effect.provide(ServerLive),
  ),
)
