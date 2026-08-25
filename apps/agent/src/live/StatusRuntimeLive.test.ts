import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import {
  CupsQueueStatus,
  derivePrinterReadiness,
  UsbDeviceState,
} from "../domain/PrinterReadiness.js"
import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterReadinessProbe } from "../services/PrinterReadinessProbe.js"
import { StatusRuntime } from "../services/StatusRuntime.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"

const readyPrinter = derivePrinterReadiness({
  cupsQueue: CupsQueueStatus.Reachable({
    observation: {
      queueName: "HP135a",
      acceptingJobs: true,
      state: "idle",
      reasons: [],
      message: null,
      available: true,
      physicalPrinterAppearsAttached: true,
    },
  }),
  usbDevice: UsbDeviceState.Attached({ source: "sysfs" }),
})

const testLayer = (emitted: WideEvent[]) =>
  StatusRuntimeLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          NetworkProbe,
          NetworkProbe.of({
            status: () => Effect.succeed({ online: true, localIps: [] }),
          }),
        ),
        Layer.succeed(
          PrinterReadinessProbe,
          PrinterReadinessProbe.of({
            observe: () => Effect.succeed(readyPrinter),
          }),
        ),
        Layer.succeed(
          WideEventPublisher,
          WideEventPublisher.of({
            emit: (event) => Effect.sync(() => void emitted.push(event)),
          }),
        ),
      ),
    ),
  )

describe("StatusRuntimeLive", () => {
  it.effect(
    "ignores a CUPS failure before the first complete observation",
    () => {
      const emitted: WideEvent[] = []

      return Effect.gen(function* () {
        const runtime = yield* StatusRuntime

        yield* runtime.recordCupsUnavailable({
          observationReason: "cups-stream-disconnect",
          message: "CUPS unavailable",
        })

        expect(emitted).toEqual([])
      }).pipe(Effect.provide(testLayer(emitted)))
    },
  )

  it.effect(
    "records CUPS unavailability without losing the USB device observation",
    () => {
      const emitted: WideEvent[] = []

      return Effect.gen(function* () {
        const runtime = yield* StatusRuntime

        yield* runtime.observeNow("test-initial")
        yield* runtime.recordCupsUnavailable({
          observationReason: "cups-stream-disconnect",
          message: "CUPS unavailable",
        })

        expect(emitted).toHaveLength(2)
        expect(emitted[0]).toMatchObject({
          eventName: "cups.status.changed",
          cupsReachable: false,
          printerReady: false,
          cupsQueueAvailable: false,
          usbDeviceState: "attached",
          usbDeviceStateSource: "sysfs",
        })
        expect(emitted[1]).toMatchObject({
          eventName: "printer.status.changed",
          printerReady: false,
          previousPrinterReady: true,
          usbDeviceState: "attached",
          previousUsbDeviceState: "attached",
        })
      }).pipe(Effect.provide(testLayer(emitted)))
    },
  )
})
