import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import {
  CupsQueueStatus,
  derivePrinterReadiness,
  UsbDeviceState,
} from "../domain/PrinterReadiness.js"
import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { StatusRuntimeLive } from "../live/StatusRuntimeLive.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat } from "./Heartbeat.js"
import { NetworkProbe } from "./NetworkProbe.js"
import { PrinterReadinessProbe } from "./PrinterReadinessProbe.js"

const readyPrinter = derivePrinterReadiness({
  cupsQueue: CupsQueueStatus.Reachable({
    observation: {
      queueName: "HP135a",
      acceptingJobs: true,
      state: "idle",
      reasons: [],
      message: null,
      available: true,
      physicalPrinterAppearsAttached: true,
    },
  }),
  usbDevice: UsbDeviceState.Attached({ source: "sysfs" }),
})

const supportLayer = Layer.mergeAll(
  Layer.succeed(
    NetworkProbe,
    NetworkProbe.of({
      status: () => Effect.succeed({ online: true, localIps: ["127.0.0.1"] }),
    }),
  ),
  Layer.succeed(
    PrinterReadinessProbe,
    PrinterReadinessProbe.of({
      observe: () => Effect.succeed(readyPrinter),
    }),
  ),
  Layer.succeed(
    WideEventPublisher,
    WideEventPublisher.of({ emit: () => Effect.void }),
  ),
)

const statusLayer = StatusRuntimeLive.pipe(Layer.provide(supportLayer))
const heartbeatLayer = HeartbeatLive.pipe(
  Layer.provide(statusLayer),
  Layer.provide(supportLayer),
)

describe("Heartbeat", () => {
  it.effect("reports the current CUPS queue and printer readiness", () =>
    Effect.gen(function* () {
      const heartbeat = yield* Heartbeat
      const snapshot = yield* heartbeat.beat()

      expect(snapshot.appUp).toBe(true)
      expect(snapshot.hostname.length).toBeGreaterThan(0)
      expect(snapshot.lastSuccessfulHeartbeatAt).not.toBeNull()
      expect(snapshot.printerReadiness).toEqual(readyPrinter)
    }).pipe(Effect.provide(heartbeatLayer)),
  )
})
