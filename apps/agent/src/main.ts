import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect, Layer, Stream } from "effect"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import { AppConfig } from "./config/AppConfig.js"
import { runHttpServer } from "./http/HttpServer.js"
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

loadAppEnv()
await startObservability()

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* AppConfig
    const queueRuntime = yield* QueueRuntime
    const orchestrator = yield* Orchestrator
    const reconciler = yield* Reconciler
    const cupsEventStream = yield* CupsEventStream
    const heartbeat = yield* Heartbeat
    const statusRuntime = yield* StatusRuntime
    const cupsClient = yield* CupsClient
    const childProcessSpawner = yield* ChildProcessSpawner

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

    yield* observeStatus("cold-start")
    yield* reconciler
      .recoverStartup()
      .pipe(
        Effect.catch((error) =>
          Console.error(`startup recovery failed: ${error.message}`),
        ),
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

const runtimeLayer = MainLayer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

program.pipe(
  withObservability,
  Effect.provide(runtimeLayer),
  NodeRuntime.runMain,
)
