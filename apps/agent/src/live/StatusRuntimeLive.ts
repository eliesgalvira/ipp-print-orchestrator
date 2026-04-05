import { Clock, Effect, Layer, Ref } from "effect"
import { hostname } from "node:os"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { JobRepo } from "../services/JobRepo.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import {
  StatusRuntime,
  type StatusObservationInput,
  type StatusSnapshot,
} from "../services/StatusRuntime.js"

interface EmittedStatusSnapshot extends StatusSnapshot {
  readonly observationReason: string
}

const emptyObservedSnapshot = (
  input: StatusObservationInput,
): EmittedStatusSnapshot => ({
  timestamp: input.timestamp,
  hostname: input.hostname,
  observationReason: input.observationReason,
  networkOnline: input.networkOnline ?? false,
  localIps: input.localIps ?? [],
  cupsReachable: input.cupsReachable ?? false,
  printerAttached: input.printerAttached ?? false,
  printerQueueAvailable: input.printerQueueAvailable ?? false,
  printerState: input.printerState ?? null,
  printerReasons: input.printerReasons ?? [],
  printerMessage: input.printerMessage ?? null,
  queueDepth: 0,
  nonterminalJobCount: 0,
})

const mergeObservedSnapshot = (
  previous: EmittedStatusSnapshot | null,
  input: StatusObservationInput,
): EmittedStatusSnapshot => {
  if (previous === null) {
    return emptyObservedSnapshot(input)
  }

  return {
    ...previous,
    timestamp: input.timestamp,
    hostname: input.hostname,
    observationReason: input.observationReason,
    ...(input.networkOnline === undefined ? {} : { networkOnline: input.networkOnline }),
    ...(input.localIps === undefined ? {} : { localIps: [...input.localIps] }),
    ...(input.cupsReachable === undefined ? {} : { cupsReachable: input.cupsReachable }),
    ...(input.printerAttached === undefined
      ? {}
      : { printerAttached: input.printerAttached }),
    ...(input.printerQueueAvailable === undefined
      ? {}
      : { printerQueueAvailable: input.printerQueueAvailable }),
    ...(input.printerState === undefined ? {} : { printerState: input.printerState }),
    ...(input.printerReasons === undefined
      ? {}
      : { printerReasons: [...input.printerReasons] }),
    ...(input.printerMessage === undefined
      ? {}
      : { printerMessage: input.printerMessage }),
  }
}

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

export const StatusRuntimeLive = Layer.effect(
  StatusRuntime,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const networkProbe = yield* NetworkProbe
    const printerProbe = yield* PrinterProbe
    const queueRuntime = yield* QueueRuntime
    const jobRepo = yield* JobRepo
    const lastObservedStatusRef = yield* Ref.make<EmittedStatusSnapshot | null>(null)

    const enrichWithCurrentCounts = Effect.fn("StatusRuntime.enrichWithCurrentCounts")(function* (
      observed: EmittedStatusSnapshot,
    ) {
      const queueDepth = yield* queueRuntime.size()
      const nonterminalJobs = yield* jobRepo.listNonTerminal()

      return {
        timestamp: observed.timestamp,
        hostname: observed.hostname,
        networkOnline: observed.networkOnline,
        localIps: observed.localIps,
        cupsReachable: observed.cupsReachable,
        printerAttached: observed.printerAttached,
        printerQueueAvailable: observed.printerQueueAvailable,
        printerState: observed.printerState,
        printerReasons: observed.printerReasons,
        printerMessage: observed.printerMessage,
        queueDepth,
        nonterminalJobCount: nonterminalJobs.length,
      } satisfies StatusSnapshot
    })

    const emitStatusChangeEvents = Effect.fn("StatusRuntime.emitStatusChangeEvents")(function* (
      previous: EmittedStatusSnapshot | null,
      current: EmittedStatusSnapshot,
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
            observationReason: current.observationReason,
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
            observationReason: current.observationReason,
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
            observationReason: current.observationReason,
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

    const recordObservedStatus = Effect.fn("StatusRuntime.recordObservedStatus")(function* (
      input: StatusObservationInput,
    ) {
      const previousObservedStatus = yield* Ref.get(lastObservedStatusRef)
      const currentObservedStatus = mergeObservedSnapshot(previousObservedStatus, input)
      yield* emitStatusChangeEvents(previousObservedStatus, currentObservedStatus)
    })

    const observeNow = Effect.fn("StatusRuntime.observeNow")(function* (reason: string) {
      yield* Effect.annotateCurrentSpan({
        "status.observation_reason": reason,
      })

      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const network = yield* networkProbe.status()
      const printer = yield* printerProbe.status(reason)
      const host = hostname()

      yield* recordObservedStatus({
        timestamp: now,
        hostname: host,
        observationReason: reason,
        networkOnline: network.online,
        localIps: network.localIps,
        cupsReachable: printer.cupsReachable,
        printerAttached: printer.attached,
        printerQueueAvailable: printer.queueAvailable,
        printerState: printer.state,
        printerReasons: printer.reasons,
        printerMessage: printer.message,
      })

      const currentObservedStatus = yield* Ref.get(lastObservedStatusRef)
      if (currentObservedStatus === null) {
        return yield* Effect.die("StatusRuntime.observeNow did not persist status")
      }

      return yield* enrichWithCurrentCounts(currentObservedStatus)
    })

    const current = Effect.fn("StatusRuntime.current")(function* () {
      const cached = yield* Ref.get(lastObservedStatusRef)
      if (cached !== null) {
        return yield* enrichWithCurrentCounts(cached)
      }

      return yield* observeNow("cold-start")
    })

    return StatusRuntime.of({
      recordObservedStatus,
      observeNow,
      current,
    })
  }),
)
