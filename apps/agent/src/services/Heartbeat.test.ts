import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestLayer } from "../../../../packages/testkit/src/TestLayers.js"
import { HeartbeatLive } from "../live/HeartbeatLive.js"
import { StatusRuntimeLive } from "../live/StatusRuntimeLive.js"
import { EventSink } from "./EventSink.js"
import { Heartbeat } from "./Heartbeat.js"
import { StatusRuntime } from "./StatusRuntime.js"

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
      expect(snapshot.cupsReachable).toBe(true)
      expect(snapshot.printerAttached).toBe(true)
      expect(snapshot.printerQueueAvailable).toBe(true)
      expect(snapshot.queueDepth).toBe(0)
      expect(snapshot.nonterminalJobCount).toBe(0)

      const events = yield* eventSink.all()
      const heartbeatEvent = events.find(
        (event) => event.eventName === "heartbeat",
      )
      expect(heartbeatEvent).toBeDefined()
      expect(heartbeatEvent?.appUp).toBe(true)
      expect(heartbeatEvent?.hostname).toBe(snapshot.hostname)
      expect(heartbeatEvent?.cupsReachable).toBe(true)
      expect(heartbeatEvent?.printerAttached).toBe(true)
      expect(heartbeatEvent?.printerQueueAvailable).toBe(true)
      expect(heartbeatEvent?.printerState).toBe("idle")
      expect(heartbeatEvent?.printerReasons).toEqual([])
      expect(heartbeatEvent?.queueDepth).toBe(0)
      expect(heartbeatEvent?.nonterminalJobCount).toBe(0)
    }).pipe(Effect.provide(heartbeatTestLayer)),
  )

  it.effect(
    "emits canonical status change events when partial observed status flips",
    () =>
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
                printer: [
                  { attached: true, queueAvailable: true, state: "idle" },
                ],
                cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
              }),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "emits printer attach and reattach changes from observed probe status",
    () =>
      Effect.gen(function* () {
        const statusRuntime = yield* StatusRuntime
        const eventSink = yield* EventSink

        yield* statusRuntime.observeNow("cold-start")
        yield* statusRuntime.observeNow("udev-usb-event")
        yield* statusRuntime.observeNow("udev-usb-event")

        const printerEvents = (yield* eventSink.all()).filter(
          (event) => event.eventName === "printer.status.changed",
        )

        expect(
          printerEvents.some(
            (event) =>
              event.observationReason === "udev-usb-event" &&
              event.previousPrinterAttached === true &&
              event.printerAttached === false,
          ),
        ).toBe(true)
        expect(
          printerEvents.some(
            (event) =>
              event.observationReason === "udev-usb-event" &&
              event.previousPrinterAttached === false &&
              event.printerAttached === true,
          ),
        ).toBe(true)
      }).pipe(
        Effect.provide(
          StatusRuntimeLive.pipe(
            Layer.provideMerge(
              makeTestLayer({
                printer: [
                  { attached: true, queueAvailable: true, state: "idle" },
                  { attached: false, queueAvailable: false, state: "idle" },
                  { attached: true, queueAvailable: true, state: "idle" },
                ],
                cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
              }),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "does not infer physical detach from partial CUPS disconnect observations",
    () =>
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
          observationReason: "cups-stream-disconnect",
          cupsReachable: false,
          printerQueueAvailable: false,
          printerState: null,
          printerReasons: ["CupsIppProtocolError"],
          printerMessage: "IPP request failed: client-error-bad-request",
        })

        const printerEvents = (yield* eventSink.all()).filter(
          (event) => event.eventName === "printer.status.changed",
        )

        expect(
          printerEvents.some(
            (event) =>
              event.observationReason === "cups-stream-disconnect" &&
              event.previousPrinterAttached === true &&
              event.printerAttached === false,
          ),
        ).toBe(false)
        expect(
          printerEvents.some(
            (event) =>
              event.observationReason === "cups-stream-disconnect" &&
              event.previousPrinterAttached === true &&
              event.printerAttached === true &&
              event.printerQueueAvailable === false,
          ),
        ).toBe(true)
      }).pipe(
        Effect.provide(
          StatusRuntimeLive.pipe(
            Layer.provideMerge(
              makeTestLayer({
                printer: [
                  { attached: true, queueAvailable: true, state: "idle" },
                ],
                cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
              }),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "refreshes current status instead of returning stale cached observations",
    () =>
      Effect.gen(function* () {
        const statusRuntime = yield* StatusRuntime

        yield* statusRuntime.recordObservedStatus({
          timestamp: "2026-04-01T10:00:00.000Z",
          hostname: "test-host",
          observationReason: "cups-stream-disconnect",
          cupsReachable: false,
          printerAttached: true,
          printerQueueAvailable: false,
          printerState: null,
          printerReasons: ["CupsIppProtocolError"],
          printerMessage: "IPP request failed: client-error-bad-request",
        })

        const current = yield* statusRuntime.current()

        expect(current.cupsReachable).toBe(true)
        expect(current.printerAttached).toBe(true)
        expect(current.printerQueueAvailable).toBe(true)
        expect(current.printerState).toBe("idle")
        expect(current.printerReasons).toEqual([])
        expect(current.printerMessage).toBeNull()
      }).pipe(
        Effect.provide(
          StatusRuntimeLive.pipe(
            Layer.provideMerge(
              makeTestLayer({
                printer: [
                  { attached: true, queueAvailable: true, state: "idle" },
                ],
                cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
              }),
            ),
          ),
        ),
      ),
  )
})
