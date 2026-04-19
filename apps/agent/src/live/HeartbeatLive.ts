import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat, type HeartbeatSnapshot } from "../services/Heartbeat.js"
import { StatusRuntime } from "../services/StatusRuntime.js"

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const statusRuntime = yield* StatusRuntime
    const lastSuccessRef = yield* Ref.make<string | null>(null)

    const beat = Effect.fn("Heartbeat.beat")(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const host = hostname()
      const status = yield* statusRuntime.current()
      yield* Effect.annotateCurrentSpan({
        "heartbeat.hostname": host,
        "heartbeat.cups_reachable": status.cupsReachable,
        "heartbeat.printer_attached": status.printerAttached,
      })
      const event = new WideEvent({
        eventName: "heartbeat",
        timestamp: now,
        appUp: true,
        hostname: host,
        networkOnline: status.networkOnline,
        localIps: [...status.localIps],
        cupsReachable: status.cupsReachable,
        printerAttached: status.printerAttached,
        printerQueueAvailable: status.printerQueueAvailable,
        printerState: status.printerState,
        printerReasons: [...status.printerReasons],
        printerMessage: status.printerMessage,
        queueDepth: status.queueDepth,
        nonterminalJobCount: status.nonterminalJobCount,
        lastSuccessfulHeartbeatAt: now,
      })

      yield* wideEventPublisher.emit(event)
      yield* Ref.set(lastSuccessRef, now)

      return {
        timestamp: now,
        hostname: host,
        appUp: true,
        networkOnline: status.networkOnline,
        localIps: status.localIps,
        cupsReachable: status.cupsReachable,
        printerAttached: status.printerAttached,
        printerQueueAvailable: status.printerQueueAvailable,
        printerState: status.printerState,
        printerReasons: status.printerReasons,
        printerMessage: status.printerMessage,
        queueDepth: status.queueDepth,
        nonterminalJobCount: status.nonterminalJobCount,
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
