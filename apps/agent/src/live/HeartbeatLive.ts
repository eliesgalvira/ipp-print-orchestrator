import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat, type HeartbeatSnapshot } from "../services/Heartbeat.js"

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const lastSuccessRef = yield* Ref.make<string | null>(null)

    const beat = Effect.fn("Heartbeat.beat")(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const host = hostname()
      yield* Effect.annotateCurrentSpan({
        "heartbeat.hostname": host,
      })
      const event = new WideEvent({
        eventName: "heartbeat",
        timestamp: now,
        appUp: true,
        hostname: host,
        lastSuccessfulHeartbeatAt: now,
      })

      yield* wideEventPublisher.emit(event)
      yield* Ref.set(lastSuccessRef, now)

      return {
        timestamp: now,
        hostname: host,
        appUp: true,
        lastSuccessfulHeartbeatAt: now,
      } satisfies HeartbeatSnapshot
    })

    const lastSuccess = () => Ref.get(lastSuccessRef)

    return Heartbeat.of({
      beat,
      lastSuccess,
    })
  }),
)
