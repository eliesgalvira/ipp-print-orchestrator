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
import { CupsIppUnavailable } from "../domain/Errors.js"
import { makeUsbDeviceIdentity } from "../domain/UsbDeviceIdentity.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
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
    }),
  )

const cupsUnavailableLayer = Layer.succeed(
  CupsObserver,
  CupsObserver.of({
    observePrinter: () =>
      Effect.fail(new CupsIppUnavailable({ message: "CUPS unavailable" })),
  }),
)

const appConfigLayer = (usbSysfsRoot: string) =>
  Layer.succeed(AppConfig, {
    printerName: "test-printer",
    bindHost: "127.0.0.1",
    bindPort: 4310,
    usbSysfsRoot,
    usbDeviceIdentity: makeUsbDeviceIdentity({
      vendorId: "03f0",
      productId: "f22a",
    }),
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
    readonly vendorId?: string
    readonly productId?: string
    readonly manufacturer?: string
    readonly product?: string
    readonly serial?: string
    readonly authorized?: boolean
  },
) => {
  const deviceRoot = join(usbSysfsRoot, name)
  mkdirSync(deviceRoot, { recursive: true })

  writeFileSync(join(deviceRoot, "idVendor"), `${values.vendorId ?? "03f0"}\n`)
  writeFileSync(
    join(deviceRoot, "idProduct"),
    `${values.productId ?? "f22a"}\n`,
  )

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
  it.effect(
    "does not attach a lookalike descriptor with the wrong USB product ID",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          writeUsbDevice(usbSysfsRoot, "1-1", {
            productId: "ffff",
            manufacturer: "HP",
            product: "Laser MFP 131 133 135-138",
            serial: "ABC123",
          })

          const printerProbe = yield* PrinterProbe
          const status = yield* printerProbe.status()

          expect(status.attached).toBe(false)
          expect(status.reasons).toEqual(["usb-device-missing"])
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "marks USB printers detached when the configured device is missing from sysfs",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          const printerProbe = yield* PrinterProbe
          const status = yield* printerProbe.status()

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
            ),
          ),
        ),
      ),
  )

  it.effect(
    "reports an attached USB printer while CUPS is temporarily unreachable",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          writeUsbDevice(usbSysfsRoot, "1-1", {})

          const printerProbe = yield* PrinterProbe
          const status = yield* printerProbe.status()

          expect(status).toEqual({
            attached: true,
            queueAvailable: false,
            cupsReachable: false,
            state: null,
            reasons: [],
            message: "CUPS unavailable",
          })
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsUnavailableLayer),
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
          const status = yield* printerProbe.status()

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
        const status = yield* printerProbe.status()

        expect(status.attached).toBe(true)
        expect(status.queueAvailable).toBe(true)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(NodeServices.layer),
            Layer.provide(cupsObserverLayer()),
          ),
        ),
      ),
    ),
  )

  it.effect("reads current sysfs attachment on every observation", () =>
    withUsbSysfsRoot((usbSysfsRoot) =>
      Effect.gen(function* () {
        writeUsbDevice(usbSysfsRoot, "1-1", {
          manufacturer: "HP",
          product: "Laser MFP 131 133 135-138",
          serial: "ABC123",
        })

        const printerProbe = yield* PrinterProbe
        const initial = yield* printerProbe.status()
        rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
        const current = yield* printerProbe.status()

        expect(initial.attached).toBe(true)
        expect(current.attached).toBe(false)
      }).pipe(
        Effect.provide(
          PrinterProbeCliLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(NodeServices.layer),
            Layer.provide(cupsObserverLayer()),
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
          const initial = yield* printerProbe.status()
          rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
          const refreshed = yield* printerProbe.status()

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
          const initial = yield* printerProbe.status()
          rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
          const detached = yield* printerProbe.status()
          writeUsbDevice(usbSysfsRoot, "1-2", {
            manufacturer: "HP",
            product: "Laser MFP 131 133 135-138",
            serial: "ABC123",
          })
          const reattached = yield* printerProbe.status()

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
          expect(reattached.message).toBeNull()
        }).pipe(
          Effect.provide(
            PrinterProbeCliLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsObserverLayer()),
            ),
          ),
        ),
      ),
  )
})
