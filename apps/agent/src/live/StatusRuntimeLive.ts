import { hostname } from "node:os"
import { Clock, Effect, Layer, Ref } from "effect"

import {
  CupsQueueStatus,
  derivePrinterReadiness,
  type PrinterReadiness,
  printerReadinessStatus,
} from "../domain/PrinterReadiness.js"
import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterReadinessProbe } from "../services/PrinterReadinessProbe.js"
import {
  type CupsUnavailableObservation,
  StatusRuntime,
  type StatusSnapshot,
} from "../services/StatusRuntime.js"

interface ObservedStatusSnapshot extends StatusSnapshot {
  readonly observationReason: string
}

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const samePrinterReadiness = (
  left: PrinterReadiness,
  right: PrinterReadiness,
): boolean => {
  const leftStatus = printerReadinessStatus(left)
  const rightStatus = printerReadinessStatus(right)

  return (
    leftStatus.printerReady === rightStatus.printerReady &&
    leftStatus.cupsReachable === rightStatus.cupsReachable &&
    leftStatus.cupsQueueAvailable === rightStatus.cupsQueueAvailable &&
    leftStatus.cupsQueueState === rightStatus.cupsQueueState &&
    leftStatus.cupsQueueMessage === rightStatus.cupsQueueMessage &&
    sameStringArray(
      leftStatus.cupsQueueReasons,
      rightStatus.cupsQueueReasons,
    ) &&
    leftStatus.usbDeviceState === rightStatus.usbDeviceState &&
    leftStatus.usbDeviceStateSource === rightStatus.usbDeviceStateSource
  )
}

const previousReadinessEventFields = (readiness: PrinterReadiness) => {
  const status = printerReadinessStatus(readiness)

  return {
    previousPrinterReady: status.printerReady,
    previousCupsReachable: status.cupsReachable,
    previousCupsQueueAvailable: status.cupsQueueAvailable,
    previousCupsQueueState: status.cupsQueueState,
    previousCupsQueueReasons: [...status.cupsQueueReasons],
    previousCupsQueueMessage: status.cupsQueueMessage,
    previousUsbDeviceState: status.usbDeviceState,
    previousUsbDeviceStateSource: status.usbDeviceStateSource,
  }
}

export const StatusRuntimeLive = Layer.effect(
  StatusRuntime,
  Effect.gen(function* () {
    const wideEventPublisher = yield* WideEventPublisher
    const networkProbe = yield* NetworkProbe
    const printerReadinessProbe = yield* PrinterReadinessProbe
    const lastObservedStatusRef =
      yield* Ref.make<ObservedStatusSnapshot | null>(null)

    const emitStatusChangeEvents = Effect.fn(
      "StatusRuntime.emitStatusChangeEvents",
    )(function* (
      previous: ObservedStatusSnapshot | null,
      current: ObservedStatusSnapshot,
    ) {
      if (previous === null) {
        yield* Ref.set(lastObservedStatusRef, current)
        return
      }

      const events: WideEvent[] = []

      if (previous.networkOnline !== current.networkOnline) {
        events.push({
          eventName: "network.status.changed",
          timestamp: current.timestamp,
          hostname: current.hostname,
          observationReason: current.observationReason,
          networkOnline: current.networkOnline,
          previousNetworkOnline: previous.networkOnline,
          localIps: [...current.localIps],
        } satisfies WideEvent)
      }

      const previousReadiness = printerReadinessStatus(
        previous.printerReadiness,
      )
      const currentReadiness = printerReadinessStatus(current.printerReadiness)

      if (previousReadiness.cupsReachable !== currentReadiness.cupsReachable) {
        events.push({
          eventName: "cups.status.changed",
          timestamp: current.timestamp,
          hostname: current.hostname,
          observationReason: current.observationReason,
          previousCupsReachable: previousReadiness.cupsReachable,
          ...printerReadinessStatus(current.printerReadiness),
        } satisfies WideEvent)
      }

      if (
        !samePrinterReadiness(
          previous.printerReadiness,
          current.printerReadiness,
        )
      ) {
        events.push({
          eventName: "printer.status.changed",
          timestamp: current.timestamp,
          hostname: current.hostname,
          observationReason: current.observationReason,
          ...printerReadinessStatus(current.printerReadiness),
          ...previousReadinessEventFields(previous.printerReadiness),
        } satisfies WideEvent)
      }

      yield* Effect.forEach(events, (event) => wideEventPublisher.emit(event), {
        discard: true,
      })
      yield* Ref.set(lastObservedStatusRef, current)
    })

    const recordCupsUnavailable = Effect.fn(
      "StatusRuntime.recordCupsUnavailable",
    )(function* (input: CupsUnavailableObservation) {
      const previousObservedStatus = yield* Ref.get(lastObservedStatusRef)
      if (previousObservedStatus === null) {
        return
      }

      const now = new Date(yield* Clock.currentTimeMillis).toISOString()
      const currentObservedStatus: ObservedStatusSnapshot = {
        ...previousObservedStatus,
        timestamp: now,
        hostname: hostname(),
        observationReason: input.observationReason,
        printerReadiness: derivePrinterReadiness({
          cupsQueue: CupsQueueStatus.Unreachable({ message: input.message }),
          usbDevice: previousObservedStatus.printerReadiness.usbDevice,
        }),
      }
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
      const printerReadiness = yield* printerReadinessProbe.observe()
      const host = hostname()
      const currentObservedStatus: ObservedStatusSnapshot = {
        timestamp: now,
        hostname: host,
        observationReason: reason,
        networkOnline: network.online,
        localIps: network.localIps,
        printerReadiness,
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
      recordCupsUnavailable,
      observeNow,
      current,
    })
  }),
)
