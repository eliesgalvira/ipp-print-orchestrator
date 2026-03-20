import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { CupsClient } from "../services/CupsClient.js"
import { EventSink } from "../services/EventSink.js"
import { Heartbeat, type HeartbeatSnapshot } from "../services/Heartbeat.js"
import { JobRepo } from "../services/JobRepo.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Telemetry } from "../services/Telemetry.js"

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const eventSink = yield* EventSink
    const telemetry = yield* Telemetry
    const networkProbe = yield* NetworkProbe
    const printerProbe = yield* PrinterProbe
    const queueRuntime = yield* QueueRuntime
    const jobRepo = yield* JobRepo
    const cupsClient = yield* CupsClient
    const lastSuccessRef = yield* Ref.make<string | null>(null)

    const snapshot = Effect.fn("Heartbeat.snapshot")(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const network = yield* networkProbe.status()
      const printer = yield* printerProbe.status()
      const queueDepth = yield* queueRuntime.size()
      const nonterminalJobs = yield* jobRepo.listNonTerminal()
      const cupsReachable = yield* cupsClient.getPrinterSummary().pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      )
      const lastSuccessfulHeartbeatAt = yield* Ref.get(lastSuccessRef)

      return {
        appUp: true,
        timestamp: now,
        hostname: hostname(),
        networkOnline: network.online,
        localIps: network.localIps,
        cupsReachable,
        printerAttached: printer.attached,
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
        queueDepth: current.queueDepth,
        nonterminalJobCount: current.nonterminalJobCount,
        lastSuccessfulHeartbeatAt: current.timestamp,
      })

      yield* eventSink.append(event)
      yield* telemetry.emit(event).pipe(Effect.catchAll(() => Effect.void))
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
