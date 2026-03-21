import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat, type HeartbeatSnapshot } from "../services/Heartbeat.js"
import { JobRepo } from "../services/JobRepo.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { QueueRuntime } from "../services/QueueRuntime.js"

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const networkProbe = yield* NetworkProbe
    const printerProbe = yield* PrinterProbe
    const queueRuntime = yield* QueueRuntime
    const jobRepo = yield* JobRepo
    const lastSuccessRef = yield* Ref.make<string | null>(null)

    const snapshot = Effect.fn("Heartbeat.snapshot")(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const network = yield* networkProbe.status()
      const printer = yield* printerProbe.status()
      const queueDepth = yield* queueRuntime.size()
      const nonterminalJobs = yield* jobRepo.listNonTerminal()
      const lastSuccessfulHeartbeatAt = yield* Ref.get(lastSuccessRef)

      return {
        appUp: true,
        timestamp: now,
        hostname: hostname(),
        networkOnline: network.online,
        localIps: network.localIps,
        cupsReachable: printer.cupsReachable,
        printerAttached: printer.attached,
        printerQueueAvailable: printer.queueAvailable,
        printerState: printer.state,
        printerReasons: printer.reasons,
        printerMessage: printer.message,
        queueDepth,
        nonterminalJobCount: nonterminalJobs.length,
        lastSuccessfulHeartbeatAt,
      } satisfies HeartbeatSnapshot
    })

    const beat = Effect.fn("Heartbeat.beat")(function* () {
      const current = yield* snapshot()
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
      const event = WideEvent.make({
        eventName: "heartbeat",
        timestamp: current.timestamp,
        appUp: current.appUp,
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
        lastSuccessfulHeartbeatAt: current.timestamp,
      } satisfies HeartbeatSnapshot
    })

    const lastSuccess = () => Ref.get(lastSuccessRef)

    return Heartbeat.of({
      snapshot,
      beat,
      lastSuccess,
    })
  }),
)
