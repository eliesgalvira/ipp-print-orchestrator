import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Heartbeat, type HeartbeatSnapshot } from "../services/Heartbeat.js"
import { JobRepo } from "../services/JobRepo.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { QueueRuntime } from "../services/QueueRuntime.js"

interface ObservedStatusSnapshot {
  readonly timestamp: string
  readonly hostname: string
  readonly networkOnline: boolean
  readonly localIps: readonly string[]
  readonly cupsReachable: boolean
  readonly printerAttached: boolean
  readonly printerQueueAvailable: boolean
  readonly printerState: string | null
  readonly printerReasons: readonly string[]
  readonly printerMessage: string | null
}

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

export const HeartbeatLive = Layer.effect(
  Heartbeat,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const networkProbe = yield* NetworkProbe
    const printerProbe = yield* PrinterProbe
    const queueRuntime = yield* QueueRuntime
    const jobRepo = yield* JobRepo
    const lastSuccessRef = yield* Ref.make<string | null>(null)
    const lastObservedStatusRef = yield* Ref.make<ObservedStatusSnapshot | null>(null)

    const emitStatusChangeEvents = Effect.fn("Heartbeat.emitStatusChangeEvents")(function* (
      previous: ObservedStatusSnapshot | null,
      current: ObservedStatusSnapshot,
    ) {
      if (previous === null) {
        yield* Ref.set(lastObservedStatusRef, current)
        return
      }

      const events: WideEvent[] = []

      if (previous.networkOnline !== current.networkOnline) {
        events.push(
          new WideEvent({
            eventName: "network.status.changed",
            timestamp: current.timestamp,
            hostname: current.hostname,
            networkOnline: current.networkOnline,
            previousNetworkOnline: previous.networkOnline,
            localIps: [...current.localIps],
          }),
        )
      }

      if (previous.cupsReachable !== current.cupsReachable) {
        events.push(
          new WideEvent({
            eventName: "cups.status.changed",
            timestamp: current.timestamp,
            hostname: current.hostname,
            cupsReachable: current.cupsReachable,
            previousCupsReachable: previous.cupsReachable,
            printerAttached: current.printerAttached,
            printerQueueAvailable: current.printerQueueAvailable,
            printerState: current.printerState,
            printerReasons: [...current.printerReasons],
            printerMessage: current.printerMessage,
          }),
        )
      }

      if (
        previous.printerAttached !== current.printerAttached ||
        previous.printerQueueAvailable !== current.printerQueueAvailable ||
        previous.printerState !== current.printerState ||
        previous.printerMessage !== current.printerMessage ||
        !sameStringArray(previous.printerReasons, current.printerReasons)
      ) {
        events.push(
          new WideEvent({
            eventName: "printer.status.changed",
            timestamp: current.timestamp,
            hostname: current.hostname,
            cupsReachable: current.cupsReachable,
            printerAttached: current.printerAttached,
            previousPrinterAttached: previous.printerAttached,
            printerQueueAvailable: current.printerQueueAvailable,
            previousPrinterQueueAvailable: previous.printerQueueAvailable,
            printerState: current.printerState,
            previousPrinterState: previous.printerState,
            printerReasons: [...current.printerReasons],
            previousPrinterReasons: [...previous.printerReasons],
            printerMessage: current.printerMessage,
            previousPrinterMessage: previous.printerMessage,
          }),
        )
      }

      yield* Effect.forEach(events, (event) => wideEventPublisher.emit(event), {
        discard: true,
      })
      yield* Ref.set(lastObservedStatusRef, current)
    })

    const snapshot = Effect.fn("Heartbeat.snapshot")(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const network = yield* networkProbe.status()
      const printer = yield* printerProbe.status()
      const queueDepth = yield* queueRuntime.size()
      const nonterminalJobs = yield* jobRepo.listNonTerminal()
      const lastSuccessfulHeartbeatAt = yield* Ref.get(lastSuccessRef)
      const currentObservedStatus: ObservedStatusSnapshot = {
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
      }
      const previousObservedStatus = yield* Ref.get(lastObservedStatusRef)

      yield* emitStatusChangeEvents(previousObservedStatus, currentObservedStatus)

      return {
        appUp: true,
        timestamp: now,
        hostname: currentObservedStatus.hostname,
        networkOnline: currentObservedStatus.networkOnline,
        localIps: currentObservedStatus.localIps,
        cupsReachable: currentObservedStatus.cupsReachable,
        printerAttached: currentObservedStatus.printerAttached,
        printerQueueAvailable: currentObservedStatus.printerQueueAvailable,
        printerState: currentObservedStatus.printerState,
        printerReasons: currentObservedStatus.printerReasons,
        printerMessage: currentObservedStatus.printerMessage,
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
      const event = new WideEvent({
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
