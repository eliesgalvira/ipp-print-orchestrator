import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { parseIppMessage, serializeIppRequest } from "./codec.js"
import {
  type IppClientError,
  IppParseError,
  IppSerializationError,
  IppTransportError,
} from "./errors.js"
import type {
  IppExecuteRequest,
  IppMessage,
  IppPrinterOptions,
} from "./model.js"

export class IppClient extends ServiceMap.Service<
  IppClient,
  {
    readonly execute: (
      request: IppExecuteRequest,
    ) => Effect.Effect<IppMessage, IppClientError>
  }
>()("@ipp/ipp/IppClient") {}

const postIpp = (endpoint: string, body: Buffer): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const url = new URL(endpoint)
    const loadTransport =
      url.protocol === "https:" ? import("node:https") : import("node:http")

    void loadTransport.then((module) => {
      const request = module.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === "" ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/ipp",
            "Content-Length": String(body.length),
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `Received unexpected response status ${response.statusCode ?? "unknown"} from the printer`,
              ),
            )
            return
          }

          const chunks: Buffer[] = []
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk)
          })
          response.on("end", () => {
            resolve(Buffer.concat(chunks))
          })
        },
      )

      request.on("error", reject)
      request.write(body)
      request.end()
    }, reject)
  })

export const requestIpp = (request: IppExecuteRequest) =>
  Effect.try({
    try: () =>
      serializeIppRequest({
        operation: request.operation,
        printerUri: request.printerUri,
        ...(request.message === undefined ? {} : { message: request.message }),
        ...(request.version === undefined ? {} : { version: request.version }),
        ...(request.language === undefined
          ? {}
          : { language: request.language }),
        ...(request.charset === undefined ? {} : { charset: request.charset }),
      }),
    catch: (error) =>
      error instanceof IppSerializationError
        ? error
        : new IppSerializationError({ message: String(error) }),
  }).pipe(
    Effect.flatMap((body) =>
      Effect.tryPromise({
        try: () => postIpp(request.endpoint, body),
        catch: (error) => new IppTransportError({ message: String(error) }),
      }),
    ),
    Effect.flatMap((body) =>
      Effect.try({
        try: () => parseIppMessage(body),
        catch: (error) =>
          error instanceof IppParseError
            ? error
            : new IppParseError({ message: String(error) }),
      }),
    ),
  )

export const execute = (request: IppExecuteRequest) =>
  Effect.gen(function* () {
    const client = yield* IppClient
    return yield* client.execute(request)
  })

export const makePrinter = (options: IppPrinterOptions) => ({
  execute: (operation: string, message: IppExecuteRequest["message"] = null) =>
    execute({
      endpoint: options.endpoint,
      printerUri: options.uri,
      operation,
      message,
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.charset === undefined ? {} : { charset: options.charset }),
    }),
})

export const NodeIppClientLive = Layer.succeed(
  IppClient,
  IppClient.of({
    execute: requestIpp,
  }),
)
