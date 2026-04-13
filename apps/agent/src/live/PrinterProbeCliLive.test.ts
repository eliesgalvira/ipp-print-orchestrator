import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import {
  parseUsbDeviceUri,
  PrinterProbeCliLive,
  usbDeviceUriMatchesSysfsDevice,
} from "./PrinterProbeCliLive.js"

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

const cupsClientLayer = (deviceUri: string) =>
  Layer.succeed(
    CupsClient,
    CupsClient.of({
      submitFile: () => Effect.die("unused"),
      getJobStatus: () => Effect.die("unused"),
      listRecentJobs: () => Effect.die("unused"),
      getPrinterSummary: () => Effect.die("unused"),
      getPrinterDeviceUri: () => Effect.succeed(deviceUri),
      listAvailableDevices: () => Effect.die("lpinfo should be unused"),
    }),
  )

const appConfigLayer = (usbSysfsRoot: string) =>
  Layer.succeed(AppConfig, {
    dataDir: "./data-test",
    printerName: "test-printer",
    bindHost: "127.0.0.1",
    bindPort: 4310,
    usbSysfsRoot,
    statusObservationIntervalMs: 2_000,
    heartbeatIntervalMs: 60_000,
    reconcileIntervalMs: 1_000,
    logPretty: false,
    enableOtlp: false,
  })

const withUsbSysfsRoot = <A, E, R>(
  build: (usbSysfsRoot: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "ipp-usb-sysfs-"))),
    build,
    (usbSysfsRoot) =>
      Effect.sync(() => {
        rmSync(usbSysfsRoot, { recursive: true, force: true })
      }),
  )

const writeUsbDevice = (
  usbSysfsRoot: string,
  name: string,
  values: {
    readonly manufacturer?: string
    readonly product?: string
    readonly serial?: string
  },
) => {
  const deviceRoot = join(usbSysfsRoot, name)
  mkdirSync(deviceRoot, { recursive: true })

  if (values.manufacturer !== undefined) {
    writeFileSync(join(deviceRoot, "manufacturer"), `${values.manufacturer}\n`)
  }

  if (values.product !== undefined) {
    writeFileSync(join(deviceRoot, "product"), `${values.product}\n`)
  }

  if (values.serial !== undefined) {
    writeFileSync(join(deviceRoot, "serial"), `${values.serial}\n`)
  }
}

describe("PrinterProbeCliLive", () => {
  it("parses USB device URIs and matches sysfs devices by serial", () => {
    const parsed = parseUsbDeviceUri(
      "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
    )

    expect(parsed).not.toBeNull()
    expect(parsed?.serial).toBe("abc123")
    expect(
      parsed !== null &&
        usbDeviceUriMatchesSysfsDevice(parsed, {
          serial: "abc123",
          matchTokens: ["hp", "laser", "mfp"],
        }),
    ).toBe(true)
  })

  it("matches serial-less USB device URIs by manufacturer and product tokens", () => {
    const parsed = parseUsbDeviceUri("usb://HP/Laser%20MFP%20131%20133%20135-138")

    expect(parsed).not.toBeNull()
    expect(
      parsed !== null &&
        usbDeviceUriMatchesSysfsDevice(parsed, {
          serial: null,
          matchTokens: ["hp", "laser", "mfp", "131", "133", "135", "138"],
        }),
    ).toBe(true)
  })

  it.effect("marks USB printers detached when the configured device is missing from sysfs", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        const printerProbe = yield* PrinterProbe
        const status = yield* printerProbe.status("cold-start")

        expect(status.attached).toBe(false)
        expect(status.queueAvailable).toBe(false)
        expect(status.cupsReachable).toBe(true)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(cupsObserverLayer()),
            Layer.provide(
              cupsClientLayer(
                "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
              ),
            ),
          ),
        ),
      ),
    ))

  it.effect("keeps network printers attached without the USB presence check", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        const printerProbe = yield* PrinterProbe
        const status = yield* printerProbe.status()

        expect(status.attached).toBe(true)
        expect(status.queueAvailable).toBe(true)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(cupsObserverLayer()),
            Layer.provide(cupsClientLayer("ipp://printer.local/ipp/print")),
          ),
        ),
      ),
    ))

  it.effect("reuses cached sysfs attachment outside explicit udev refreshes", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        writeUsbDevice(usbSysfsRoot, "1-1", {
          manufacturer: "HP",
          product: "Laser MFP 131 133 135-138",
          serial: "ABC123",
        })

        const printerProbe = yield* PrinterProbe
        const initial = yield* printerProbe.status("cold-start")
        rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
        const cached = yield* printerProbe.status("cups-notification")

        expect(initial.attached).toBe(true)
        expect(cached.attached).toBe(true)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(cupsObserverLayer()),
            Layer.provide(
              cupsClientLayer(
                "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
              ),
            ),
          ),
        ),
      ),
    ))

  it.effect("refreshes USB attachment from sysfs on udev-triggered observations", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        writeUsbDevice(usbSysfsRoot, "1-1", {
          manufacturer: "HP",
          product: "Laser MFP 131 133 135-138",
          serial: "ABC123",
        })

        const printerProbe = yield* PrinterProbe
        const initial = yield* printerProbe.status("cold-start")
        rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
        const refreshed = yield* printerProbe.status("udev-usb-event")

        expect(initial.attached).toBe(true)
        expect(refreshed.attached).toBe(false)
        expect(refreshed.queueAvailable).toBe(false)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(cupsObserverLayer()),
            Layer.provide(
              cupsClientLayer(
                "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
              ),
            ),
          ),
        ),
      ),
    ))
})
