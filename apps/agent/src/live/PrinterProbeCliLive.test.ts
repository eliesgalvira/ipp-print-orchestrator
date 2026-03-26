import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbeCliLive } from "./PrinterProbeCliLive.js"

const cupsObserverLayer = (attached = true) =>
  Layer.succeed(
    CupsObserver,
    CupsObserver.of({
      observePrinter: () =>
        Effect.succeed({
          printerName: "test-printer",
          acceptingJobs: true,
          state: "idle",
          reasons: [],
          message: null,
          attached,
          queueAvailable: true,
        }),
      observeJob: () => Effect.succeed(null),
    }),
  )

const cupsClientLayer = (options: {
  readonly deviceUri: string
  readonly availableDevices: readonly string[]
}) =>
  Layer.succeed(
    CupsClient,
    CupsClient.of({
      submitFile: () => Effect.die("unused"),
      getJobStatus: () => Effect.die("unused"),
      listRecentJobs: () => Effect.die("unused"),
      getPrinterSummary: () => Effect.die("unused"),
      getPrinterDeviceUri: () => Effect.succeed(options.deviceUri),
      listAvailableDevices: () => Effect.succeed(options.availableDevices),
    }),
  )

describe("PrinterProbeCliLive", () => {
  it.effect("marks USB printers detached when the configured device URI is missing", () =>
    Effect.gen(function* () {
      const printerProbe = yield* PrinterProbe
      const status = yield* printerProbe.status()

      expect(status.attached).toBe(false)
      expect(status.queueAvailable).toBe(false)
      expect(status.cupsReachable).toBe(true)
    }).pipe(
      Effect.provide(
        PrinterProbeCliLive.pipe(
          Layer.provide(cupsObserverLayer()),
          Layer.provide(
            cupsClientLayer({
              deviceUri:
                "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
              availableDevices: [],
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("keeps network printers attached without the USB presence check", () =>
    Effect.gen(function* () {
      const printerProbe = yield* PrinterProbe
      const status = yield* printerProbe.status()

      expect(status.attached).toBe(true)
      expect(status.queueAvailable).toBe(true)
    }).pipe(
      Effect.provide(
        PrinterProbeCliLive.pipe(
          Layer.provide(cupsObserverLayer()),
          Layer.provide(
            cupsClientLayer({
              deviceUri: "ipp://printer.local/ipp/print",
              availableDevices: [],
            }),
          ),
        ),
      ),
    ),
  )
})
