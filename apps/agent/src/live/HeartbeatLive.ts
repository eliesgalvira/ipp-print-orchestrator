import { hostname } from "node:os"
import { Clock, Effect, Layer, Ref } from "effect"

import { printerReadinessStatus } from "../domain/PrinterReadiness.js"
import type { WideEvent } from "../domain/WideEvent.js"
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
      const readiness = printerReadinessStatus(status.printerReadiness)
      yield* Effect.annotateCurrentSpan({
        "heartbeat.hostname": host,
        "heartbeat.cups_reachable": readiness.cupsReachable,
        "heartbeat.cups_queue_available": readiness.cupsQueueAvailable,
        "heartbeat.printer_ready": readiness.printerReady,
        "heartbeat.usb_device_state": readiness.usbDeviceState,
      })
      const event = {
        eventName: "heartbeat",
        timestamp: now,
        appUp: true,
        hostname: host,
        networkOnline: status.networkOnline,
        localIps: [...status.localIps],
        ...readiness,
        lastSuccessfulHeartbeatAt: now,
      } satisfies WideEvent

      yield* wideEventPublisher.emit(event)
      yield* Ref.set(lastSuccessRef, now)

      return {
        timestamp: now,
        hostname: host,
        appUp: true,
        networkOnline: status.networkOnline,
        localIps: status.localIps,
        printerReadiness: status.printerReadiness,
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
