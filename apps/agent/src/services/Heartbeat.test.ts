import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { EventSink } from "./EventSink.js"
import { Heartbeat } from "./Heartbeat.js"
import { makeTestLayer } from "../../../../packages/testkit/src/TestLayers.js"
import { HeartbeatLive } from "../live/HeartbeatLive.js"

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
        HeartbeatLive.pipe(
          Layer.provideMerge(
            makeTestLayer({
              printer: [{ attached: true, queueAvailable: true }],
              cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
            }),
          ),
        ),
      ),
    ),
  )
})
