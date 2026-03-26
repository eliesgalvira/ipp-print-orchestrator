import { Effect, Layer, Ref } from "effect"

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
      const current = yield* statusRuntime.current()
      yield* Effect.annotateCurrentSpan({
        "heartbeat.cups_reachable": current.cupsReachable,
        "heartbeat.hostname": current.hostname,
        "heartbeat.job_count": current.nonterminalJobCount,
        "heartbeat.network_online": current.networkOnline,
        "heartbeat.printer_attached": current.printerAttached,
        "heartbeat.printer_queue_available": current.printerQueueAvailable,
        "heartbeat.printer_state": current.printerState,
        "heartbeat.queue_depth": current.queueDepth,
      })
      const event = new WideEvent({
        eventName: "heartbeat",
        timestamp: current.timestamp,
        appUp: true,
        hostname: current.hostname,
        networkOnline: current.networkOnline,
        localIps: current.localIps,
        cupsReachable: current.cupsReachable,
        printerAttached: current.printerAttached,
        printerQueueAvailable: current.printerQueueAvailable,
        printerState: current.printerState,
        printerReasons: current.printerReasons,
        printerMessage: current.printerMessage,
        queueDepth: current.queueDepth,
        nonterminalJobCount: current.nonterminalJobCount,
        lastSuccessfulHeartbeatAt: current.timestamp,
      })

      yield* wideEventPublisher.emit(event)
      yield* Ref.set(lastSuccessRef, current.timestamp)

      return {
        ...current,
        appUp: true,
        lastSuccessfulHeartbeatAt: current.timestamp,
      } satisfies HeartbeatSnapshot
    })

    const lastSuccess = () => Ref.get(lastSuccessRef)

    return Heartbeat.of({
      beat,
      lastSuccess,
    })
  }),
)
