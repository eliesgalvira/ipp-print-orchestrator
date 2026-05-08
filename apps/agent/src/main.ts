import { NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect, Layer, Stream } from "effect"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import { AppConfig } from "./config/AppConfig.js"
import { HttpServerLive, runHttpServer } from "./http/HttpServer.js"
import { MainLayer } from "./live/MainLayer.js"
import { startObservability, withObservability } from "./observability/index.js"
import { CupsClient } from "./services/CupsClient.js"
import { CupsEventStream } from "./services/CupsEventStream.js"
import { Heartbeat } from "./services/Heartbeat.js"
import { Orchestrator } from "./services/Orchestrator.js"
import { QueueRuntime } from "./services/QueueRuntime.js"
import { Reconciler } from "./services/Reconciler.js"
import { StatusRuntime } from "./services/StatusRuntime.js"
import { loadAppEnv } from "./util/loadAppEnv.js"

const processStartupStartedAt = Date.now()
const logProcessStartup = (
  message: string,
  startedAt = processStartupStartedAt,
) => {
  console.log(`[startup] ${message} (${Date.now() - startedAt}ms)`)
}

await loadAppEnv()
logProcessStartup("app environment loaded")

const observabilityStartedAt = Date.now()
await startObservability()
logProcessStartup("observability bootstrap complete", observabilityStartedAt)

const program = Effect.scoped(
  Effect.gen(function* () {
    const effectStartupStartedAt = Date.now()
    yield* Console.log("[startup] acquiring runtime services")
    const config = yield* AppConfig
    yield* Console.log(
      `[startup] AppConfig ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const queueRuntime = yield* QueueRuntime
    yield* Console.log(
      `[startup] QueueRuntime ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const orchestrator = yield* Orchestrator
    yield* Console.log(
      `[startup] Orchestrator ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const reconciler = yield* Reconciler
    yield* Console.log(
      `[startup] Reconciler ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const cupsEventStream = yield* CupsEventStream
    yield* Console.log(
      `[startup] CupsEventStream ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const heartbeat = yield* Heartbeat
    yield* Console.log(
      `[startup] Heartbeat ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const statusRuntime = yield* StatusRuntime
    yield* Console.log(
      `[startup] StatusRuntime ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const cupsClient = yield* CupsClient
    yield* Console.log(
      `[startup] CupsClient ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )
    const childProcessSpawner = yield* ChildProcessSpawner
    yield* Console.log(
      `[startup] ChildProcessSpawner ready (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )

    const observeStatus = (reason: string) =>
      statusRuntime
        .observeNow(reason)
        .pipe(
          Effect.catch((error) =>
            Console.error(
              `status observation failed: ${error._tag}: ${error.message}`,
            ),
          ),
        )

    const workerLoop = Effect.forever(
      Effect.gen(function* () {
        const jobId = yield* queueRuntime.take()
        yield* orchestrator.processJob(jobId).pipe(
          Effect.tapError((error) =>
            Console.error(
              `job ${String(jobId)} failed: ${error._tag}: ${error.message}`,
            ),
          ),
          Effect.catch(() => Effect.void),
        )
      }),
    )

    const usbHotplugObservationLoop = Effect.gen(function* () {
      const deviceUri = yield* cupsClient
        .getPrinterDeviceUri()
        .pipe(Effect.catch(() => Effect.succeed(null)))

      if (deviceUri === null || !deviceUri.startsWith("usb://")) {
        return yield* Effect.never
      }

      yield* childProcessSpawner
        .streamLines(
          ChildProcess.make("udevadm", [
            "monitor",
            "--udev",
            "--subsystem-match=usb",
            "--property",
          ]),
          { includeStderr: true },
        )
        .pipe(
          Stream.filter((line) => line.startsWith("UDEV")),
          Stream.runForEach(() => observeStatus("udev-usb-event")),
          Effect.catch((error) =>
            Console.error(`usb hotplug monitor failed: ${String(error)}`),
          ),
        )
    })

    const heartbeatLoop = Effect.forever(
      Effect.gen(function* () {
        yield* heartbeat
          .beat()
          .pipe(
            Effect.catch((error) =>
              Console.error(
                `heartbeat failed: ${error._tag}: ${error.message}`,
              ),
            ),
          )
        yield* Effect.sleep(config.heartbeatIntervalMs)
      }),
    )

    const coldStartObservationStartedAt = Date.now()
    yield* Console.log("[startup] cold-start status observation start")
    yield* observeStatus("cold-start")
    yield* Console.log(
      `[startup] cold-start status observation done (${Date.now() - coldStartObservationStartedAt}ms)`,
    )

    const startupRecoveryStartedAt = Date.now()
    yield* Console.log("[startup] startup recovery start")
    yield* reconciler
      .recoverStartup()
      .pipe(
        Effect.catch((error) =>
          Console.error(`startup recovery failed: ${error.message}`),
        ),
      )
    yield* Console.log(
      `[startup] startup recovery done (${Date.now() - startupRecoveryStartedAt}ms)`,
    )

    yield* Console.log(
      `[startup] starting http server and background loops (${Date.now() - effectStartupStartedAt}ms since Effect start)`,
    )

    return yield* Effect.all(
      [
        runHttpServer.pipe(
          Effect.tapCause((cause) =>
            Console.error(
              `http server failed to start: ${Cause.pretty(cause)}`,
            ),
          ),
        ),
        workerLoop,
        usbHotplugObservationLoop,
        cupsEventStream.run(),
        heartbeatLoop,
      ],
      { concurrency: "unbounded" },
    )
  }),
)

const runtimeLayer = Layer.merge(
  MainLayer,
  HttpServerLive.pipe(Layer.provide(AppConfig.layer)),
)

// @effect-diagnostics-next-line effect/strictEffectProvide:off
const main = program.pipe(withObservability, Effect.provide(runtimeLayer))

NodeRuntime.runMain(main)
