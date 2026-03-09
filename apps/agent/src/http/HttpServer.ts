import { HttpMiddleware, HttpServer } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"

import { AppConfig } from "../config/AppConfig.js"
import { HttpRoutes } from "./Routes.js"

const ServerLive = Effect.map(AppConfig, (config) =>
  NodeHttpServer.layer(createServer, {
    port: config.bindPort,
    host: config.bindHost,
  }),
).pipe(Layer.unwrapEffect)

export const HttpLive = HttpRoutes.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  Layer.provide(ServerLive),
)
