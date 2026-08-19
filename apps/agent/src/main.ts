import { NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect, Layer, Stream } from "effect"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import { AppConfig } from "./config/AppConfig.js"
import { isPhysicalUsbDeviceUri } from "./domain/PrinterDeviceUri.js"
import { udevProductMatchesUsbIdentity } from "./domain/UsbDeviceIdentity.js"
import { HttpServerLive, runHttpServer } from "./http/HttpServer.js"
import { MainLayer } from "./live/MainLayer.js"
import { startObservability, withObservability } from "./observability/index.js"
import { CupsEventStream } from "./services/CupsEventStream.js"
import { Heartbeat } from "./services/Heartbeat.js"
import { PrinterDeviceSource } from "./services/PrinterDeviceSource.js"
import { StatusRuntime } from "./services/StatusRuntime.js"
import { loadAppEnv } from "./util/loadAppEnv.js"

await loadAppEnv()
await startObservability()

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* AppConfig
    const cupsEventStream = yield* CupsEventStream
    const heartbeat = yield* Heartbeat
    const printerDeviceSource = yield* PrinterDeviceSource
    const statusRuntime = yield* StatusRuntime
    const childProcessSpawner = yield* ChildProcessSpawner

    const observeStatus = (reason: string) => statusRuntime.observeNow(reason)

    const usbHotplugObservationLoop = Effect.gen(function* () {
      const deviceUri = yield* printerDeviceSource
        .installedDeviceUri()
        .pipe(Effect.catch(() => Effect.succeed(null)))

      if (deviceUri === null || !isPhysicalUsbDeviceUri(deviceUri)) {
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
          Stream.filter((line) =>
            udevProductMatchesUsbIdentity(line, config.usbDeviceIdentity),
          ),
          Stream.runForEach(() => observeStatus("udev-usb-event")),
          Effect.catch((error) =>
            Console.error(`usb hotplug monitor failed: ${String(error)}`),
          ),
        )
    })

    const heartbeatLoop = Effect.forever(
      heartbeat.beat().pipe(Effect.delay(config.heartbeatIntervalMs)),
    )

    yield* observeStatus("cold-start")

    return yield* Effect.all(
      [
        runHttpServer.pipe(
          Effect.tapCause((cause) =>
            Console.error(`http server failed: ${Cause.pretty(cause)}`),
          ),
        ),
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
