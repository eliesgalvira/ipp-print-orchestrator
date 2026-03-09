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
      const event = WideEvent.make({
        timestamp: current.timestamp,
        eventName: "heartbeat",
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
