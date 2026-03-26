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
      expect(snapshot.cupsReachable).toBe(true)
      expect(snapshot.printerAttached).toBe(true)

      const events = yield* eventSink.all()
      expect(events.some((event) => event.eventName === "heartbeat")).toBe(true)
    }).pipe(
      Effect.provide(
        heartbeatTestLayer,
      ),
    ),
  )

  it.effect("emits canonical status change events when observed status flips", () =>
    Effect.gen(function* () {
      const statusRuntime = yield* StatusRuntime
      const eventSink = yield* EventSink

      yield* statusRuntime.observeNow("test-initial")
      yield* statusRuntime.observeNow("test-transition")

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
              printer: [
                { attached: true, queueAvailable: true, state: "idle" },
                {
                  attached: false,
                  queueAvailable: false,
                  cupsReachable: false,
                  state: "stopped",
                  reasons: ["offline"],
                  message: "Printer unreachable",
                },
              ],
              cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
              network: [
                { online: true, localIps: ["127.0.0.1"] },
                { online: false, localIps: [] },
              ],
            }),
          ),
        ),
      ),
    ),
  )
})
