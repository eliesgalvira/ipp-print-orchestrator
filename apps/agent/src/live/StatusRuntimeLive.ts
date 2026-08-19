import { hostname } from "node:os"
import { Clock, Effect, Layer, Ref } from "effect"

import { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import {
  type StatusObservationInput,
  StatusRuntime,
  type StatusSnapshot,
} from "../services/StatusRuntime.js"

interface EmittedStatusSnapshot extends StatusSnapshot {
  readonly observationReason: string
}

const mergeObservedSnapshot = (
  previous: EmittedStatusSnapshot,
  input: StatusObservationInput,
): EmittedStatusSnapshot => ({ ...previous, ...input })

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

export const StatusRuntimeLive = Layer.effect(
  StatusRuntime,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const networkProbe = yield* NetworkProbe
    const printerProbe = yield* PrinterProbe
    const lastObservedStatusRef = yield* Ref.make<EmittedStatusSnapshot | null>(
      null,
    )

    const emitStatusChangeEvents = Effect.fn(
      "StatusRuntime.emitStatusChangeEvents",
    )(function* (
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

    const recordObservedStatus = Effect.fn(
      "StatusRuntime.recordObservedStatus",
    )(function* (input: StatusObservationInput) {
      const previousObservedStatus = yield* Ref.get(lastObservedStatusRef)
      if (previousObservedStatus === null) {
        return
      }
      const currentObservedStatus = mergeObservedSnapshot(
        previousObservedStatus,
        input,
      )
      yield* emitStatusChangeEvents(
        previousObservedStatus,
        currentObservedStatus,
      )
    })

    const observeNow = Effect.fn("StatusRuntime.observeNow")(function* (
      reason: string,
    ) {
      yield* Effect.annotateCurrentSpan({
        "status.observation_reason": reason,
      })

      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const network = yield* networkProbe.status()
      const printer = yield* printerProbe.status()
      const host = hostname()
      const currentObservedStatus: EmittedStatusSnapshot = {
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
      }

      const previousObservedStatus = yield* Ref.get(lastObservedStatusRef)
      yield* emitStatusChangeEvents(
        previousObservedStatus,
        currentObservedStatus,
      )

      return currentObservedStatus satisfies StatusSnapshot
    })

    const current = Effect.fn("StatusRuntime.current")(function* () {
      return yield* observeNow("status-current")
    })

    return StatusRuntime.of({
      recordObservedStatus,
      observeNow,
      current,
    })
  }),
)
