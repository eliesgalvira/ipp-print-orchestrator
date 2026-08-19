import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { StatusRuntimeLive } from "../live/StatusRuntimeLive.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat } from "./Heartbeat.js"
import { NetworkProbe } from "./NetworkProbe.js"
import { PrinterProbe } from "./PrinterProbe.js"
import { StatusRuntime } from "./StatusRuntime.js"

const supportLayer = Layer.mergeAll(
  Layer.succeed(
    NetworkProbe,
    NetworkProbe.of({
      status: () => Effect.succeed({ online: true, localIps: ["127.0.0.1"] }),
    }),
  ),
  Layer.succeed(
    PrinterProbe,
    PrinterProbe.of({
      status: () =>
        Effect.succeed({
          attached: true,
          queueAvailable: true,
          cupsReachable: true,
          state: "idle",
          reasons: [],
          message: null,
        }),
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
  it.effect("reports the current CUPS and printer state", () =>
    Effect.gen(function* () {
      const heartbeat = yield* Heartbeat
      const snapshot = yield* heartbeat.beat()

      expect(snapshot.appUp).toBe(true)
      expect(snapshot.hostname.length).toBeGreaterThan(0)
      expect(snapshot.lastSuccessfulHeartbeatAt).not.toBeNull()
      expect(snapshot.cupsReachable).toBe(true)
      expect(snapshot.printerAttached).toBe(true)
      expect(snapshot.printerQueueAvailable).toBe(true)
    }).pipe(Effect.provide(heartbeatLayer)),
  )

  it.effect("keeps attachment when CUPS reports a partial disconnect", () =>
    Effect.gen(function* () {
      const statusRuntime = yield* StatusRuntime

      yield* statusRuntime.recordObservedStatus({
        timestamp: "2026-04-01T10:00:00.000Z",
        hostname: "test-host",
        observationReason: "test-initial",
        cupsReachable: true,
        printerAttached: true,
        printerQueueAvailable: true,
        printerState: "idle",
      })
      yield* statusRuntime.recordObservedStatus({
        timestamp: "2026-04-01T10:01:00.000Z",
        hostname: "test-host",
        observationReason: "cups-stream-disconnect",
        cupsReachable: false,
        printerQueueAvailable: false,
        printerState: null,
        printerReasons: [],
      })

      const current = yield* statusRuntime.current()
      expect(current.printerAttached).toBe(true)
    }).pipe(Effect.provide(statusLayer)),
  )
})
