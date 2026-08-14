import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { parsePhysicalUsbDeviceUri } from "../domain/PrinterDeviceUri.js"
import { PrinterDeviceSource } from "../services/PrinterDeviceSource.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import {
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
    }),
  )

const printerDeviceSourceLayer = (deviceUri: string) =>
  Layer.succeed(
    PrinterDeviceSource,
    PrinterDeviceSource.of({
      installedDeviceUri: () => Effect.succeed(deviceUri),
    }),
  )

const appConfigLayer = (usbSysfsRoot: string) =>
  Layer.succeed(AppConfig, {
    printerName: "test-printer",
    bindHost: "127.0.0.1",
    bindPort: 4310,
    usbSysfsRoot,
    heartbeatIntervalMs: 60_000,
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
    readonly authorized?: boolean
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

  if (values.authorized !== undefined) {
    writeFileSync(
      join(deviceRoot, "authorized"),
      values.authorized ? "1\n" : "0\n",
    )
  }
}

describe("PrinterProbeCliLive", () => {
  it("parses USB device URIs and matches sysfs devices by serial", () => {
    const parsed = parsePhysicalUsbDeviceUri(
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
    const parsed = parsePhysicalUsbDeviceUri(
      "usb://HP/Laser%20MFP%20131%20133%20135-138",
    )

    expect(parsed).not.toBeNull()
    expect(
      parsed !== null &&
        usbDeviceUriMatchesSysfsDevice(parsed, {
          serial: null,
          matchTokens: ["hp", "laser", "mfp", "131", "133", "135", "138"],
        }),
    ).toBe(true)
  })

  it.effect(
    "marks USB printers detached when the configured device is missing from sysfs",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          const printerProbe = yield* PrinterProbe
          const status = yield* printerProbe.status("cold-start")

          expect(status.attached).toBe(false)
          expect(status.queueAvailable).toBe(false)
          expect(status.cupsReachable).toBe(true)
          expect(status.reasons).toEqual(["usb-device-missing"])
          expect(status.message).toBe(
            "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off.",
          )
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer(
                  "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
                ),
              ),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "marks USB printers detached when the configured sysfs device is deauthorized",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          writeUsbDevice(usbSysfsRoot, "1-1", {
            manufacturer: "HP",
            product: "Laser MFP 131 133 135-138",
            serial: "ABC123",
            authorized: false,
          })

          const printerProbe = yield* PrinterProbe
          const status = yield* printerProbe.status("cold-start")

          expect(status.attached).toBe(false)
          expect(status.queueAvailable).toBe(false)
          expect(status.cupsReachable).toBe(true)
          expect(status.reasons).toEqual(["usb-device-deauthorized"])
          expect(status.message).toBe(
            "Configured USB printer device is present in sysfs but deauthorized by the kernel. Reconnect or reauthorize the USB device before printing.",
          )
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer(
                  "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
                ),
              ),
            ),
          ),
        ),
      ),
  )

  it.effect("matches USB devices exposed as sysfs symlinks", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        const targetRoot = join(usbSysfsRoot, "targets")
        writeUsbDevice(targetRoot, "real-1-1", {
          manufacturer: "HP",
          product: "Laser MFP 131 133 135-138",
          serial: "ABC123",
        })
        symlinkSync(
          join(targetRoot, "real-1-1"),
          join(usbSysfsRoot, "1-1"),
          "dir",
        )

        const printerProbe = yield* PrinterProbe
        const status = yield* printerProbe.status("cold-start")

        expect(status.attached).toBe(true)
        expect(status.queueAvailable).toBe(true)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(NodeServices.layer),
            Layer.provide(cupsObserverLayer()),
            Layer.provide(
              printerDeviceSourceLayer(
                "ipp-orch-usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect(
    "keeps network printers attached without the USB presence check",
    () =>
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
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer("ipp://printer.local/ipp/print"),
              ),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "reuses cached sysfs attachment outside explicit udev refreshes",
    () =>
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
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer(
                  "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
                ),
              ),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "refreshes USB attachment from sysfs on udev-triggered observations",
    () =>
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
          expect(refreshed.reasons).toEqual(["usb-device-missing"])
          expect(refreshed.message).toBe(
            "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off.",
          )
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer(
                  "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
                ),
              ),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "refreshes USB attachment back to attached when sysfs device reappears",
    () =>
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
          const detached = yield* printerProbe.status("udev-usb-event")
          writeUsbDevice(usbSysfsRoot, "1-2", {
            manufacturer: "HP",
            product: "Laser MFP 131 133 135-138",
            serial: "ABC123",
          })
          const reattached = yield* printerProbe.status("udev-usb-event")

          expect(initial.attached).toBe(true)
          expect(detached.attached).toBe(false)
          expect(detached.queueAvailable).toBe(false)
          expect(detached.reasons).toEqual(["usb-device-missing"])
          expect(detached.message).toBe(
            "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off.",
          )
          expect(reattached.attached).toBe(true)
          expect(reattached.queueAvailable).toBe(true)
          expect(reattached.reasons).toEqual([])
          expect(reattached.message).toBe(
            "Configured USB printer device is present in sysfs",
          )
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
              Layer.provide(
                printerDeviceSourceLayer(
                  "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
                ),
              ),
            ),
          ),
        ),
      ),
  )
})
