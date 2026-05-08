import { NodeHttpServer } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServer from "effect/unstable/http/HttpServer"

import { AppConfig } from "../config/AppConfig.js"
import { HttpRoutes } from "./Routes.js"

const createServer = process.getBuiltinModule("node:http").createServer

export const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return NodeHttpServer.layer(createServer, {
      port: config.bindPort,
      host: config.bindHost,
    })
  }),
)

export const HttpLive = Layer.effectDiscard(
  HttpRouter.toHttpEffect(HttpRoutes).pipe(
    Effect.flatMap((httpApp) =>
      HttpServer.serveEffect(httpApp, HttpMiddleware.logger).pipe(
        Effect.andThen(Effect.never),
      ),
    ),
  ),
).pipe(Layer.provide(HttpServerLive))

export const runHttpServer = HttpRouter.toHttpEffect(HttpRoutes).pipe(
  Effect.flatMap((httpApp) =>
    HttpServer.addressFormattedWith((address) =>
      Console.log(`http server listening on ${address}`),
    ).pipe(
      Effect.andThen(
        HttpServer.serveEffect(httpApp, HttpMiddleware.logger).pipe(
          Effect.andThen(Effect.never),
        ),
      ),
    ),
  ),
)
