import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { EventSink } from "./EventSink.js"
import { Heartbeat } from "./Heartbeat.js"
import { StatusRuntime } from "./StatusRuntime.js"
import { makeTestLayer } from "../../../../packages/testkit/src/TestLayers.js"
import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { StatusRuntimeLive } from "../live/StatusRuntimeLive.js"

const statusTestLayer = StatusRuntimeLive.pipe(
  Layer.provideMerge(
    makeTestLayer({
      printer: [{ attached: true, queueAvailable: true }],
      cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
    }),
  ),
)

const heartbeatTestLayer = Layer.merge(
  statusTestLayer,
  HeartbeatLive.pipe(Layer.provide(statusTestLayer)),
)

describe("Heartbeat", () => {
  it.effect("builds a snapshot and emits a heartbeat event", () =>
    Effect.gen(function* () {
      const heartbeat = yield* Heartbeat
      const eventSink = yield* EventSink

      const snapshot = yield* heartbeat.beat()
      expect(snapshot.appUp).toBe(true)
      expect(snapshot.hostname.length).toBeGreaterThan(0)
      expect(snapshot.lastSuccessfulHeartbeatAt).not.toBeNull()

      const events = yield* eventSink.all()
      const heartbeatEvent = events.find((event) => event.eventName === "heartbeat")
      expect(heartbeatEvent).toBeDefined()
      expect(heartbeatEvent?.appUp).toBe(true)
      expect(heartbeatEvent?.hostname).toBe(snapshot.hostname)
      expect(heartbeatEvent?.printerAttached).toBeUndefined()
    }).pipe(
      Effect.provide(
        heartbeatTestLayer,
      ),
    ),
  )

  it.effect("emits canonical status change events when partial observed status flips", () =>
    Effect.gen(function* () {
      const statusRuntime = yield* StatusRuntime
      const eventSink = yield* EventSink

      yield* statusRuntime.recordObservedStatus({
        timestamp: "2026-04-01T10:00:00.000Z",
        hostname: "test-host",
        observationReason: "test-initial",
        networkOnline: true,
        localIps: ["127.0.0.1"],
        cupsReachable: true,
        printerAttached: true,
        printerQueueAvailable: true,
        printerState: "idle",
        printerReasons: [],
        printerMessage: null,
      })

      yield* statusRuntime.recordObservedStatus({
        timestamp: "2026-04-01T10:01:00.000Z",
        hostname: "test-host",
        observationReason: "test-transition",
        networkOnline: false,
        localIps: [],
        cupsReachable: false,
        printerAttached: false,
        printerQueueAvailable: false,
        printerState: "stopped",
        printerReasons: ["offline"],
        printerMessage: "Printer unreachable",
      })

      const events = yield* eventSink.all()

      expect(
        events.some(
          (event) =>
            event.eventName === "network.status.changed" &&
            event.observationReason === "test-transition" &&
            event.previousNetworkOnline === true &&
            event.networkOnline === false,
        ),
      ).toBe(true)
      expect(
        events.some(
          (event) =>
            event.eventName === "cups.status.changed" &&
            event.observationReason === "test-transition" &&
            event.previousCupsReachable === true &&
            event.cupsReachable === false,
        ),
      ).toBe(true)
      expect(
        events.some(
          (event) =>
            event.eventName === "printer.status.changed" &&
            event.observationReason === "test-transition" &&
            event.previousPrinterAttached === true &&
            event.printerAttached === false &&
            event.previousPrinterState === "idle" &&
            event.printerState === "stopped",
        ),
      ).toBe(true)
    }).pipe(
      Effect.provide(
        StatusRuntimeLive.pipe(
          Layer.provideMerge(
            makeTestLayer({
              printer: [{ attached: true, queueAvailable: true, state: "idle" }],
              cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
            }),
          ),
        ),
      ),
    ),
  )
})
