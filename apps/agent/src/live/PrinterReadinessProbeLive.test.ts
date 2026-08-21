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
import { CupsQueueObserver } from "../cups-observation/CupsQueueObserver.js"
import { CupsIppUnavailable } from "../domain/Errors.js"
import { makeUsbDeviceIdentity } from "../domain/UsbDeviceIdentity.js"
import { PrinterReadinessProbe } from "../services/PrinterReadinessProbe.js"
import { PrinterReadinessProbeLive } from "./PrinterReadinessProbeLive.js"

const cupsQueueObserverLayer = (physicalPrinterAppearsAttached = true) =>
  Layer.succeed(
    CupsQueueObserver,
    CupsQueueObserver.of({
      observeQueue: () =>
        Effect.succeed({
          queueName: "test-printer",
          acceptingJobs: true,
          state: "idle",
          reasons: [],
          message: null,
          available: true,
          physicalPrinterAppearsAttached,
        }),
    }),
  )

const cupsUnavailableLayer = Layer.succeed(
  CupsQueueObserver,
  CupsQueueObserver.of({
    observeQueue: () =>
      Effect.fail(new CupsIppUnavailable({ message: "CUPS unavailable" })),
  }),
)

const appConfigLayer = (usbSysfsRoot: string) =>
  Layer.succeed(AppConfig, {
    cupsQueueName: "test-printer",
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

describe("PrinterReadinessProbeLive", () => {
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

          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness.ready).toBe(false)
          expect(readiness.usbDevice).toEqual({
            _tag: "Missing",
            source: "sysfs",
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
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
          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness.ready).toBe(false)
          expect(readiness.cupsQueue._tag).toBe("Reachable")
          expect(readiness.usbDevice).toEqual({
            _tag: "Missing",
            source: "sysfs",
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
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

          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness).toEqual({
            ready: false,
            cupsQueue: {
              _tag: "Unreachable",
              message: "CUPS unavailable",
            },
            usbDevice: {
              _tag: "Attached",
              source: "sysfs",
            },
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsUnavailableLayer),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "marks CUPS-derived USB attachment as an inference when sysfs is unavailable",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness.ready).toBe(true)
          expect(readiness.usbDevice).toEqual({
            _tag: "Attached",
            source: "cups-inference",
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(
                appConfigLayer(join(usbSysfsRoot, "missing-sysfs-root")),
              ),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
            ),
          ),
        ),
      ),
  )

  it.effect(
    "keeps a CUPS-derived missing USB state distinct from a sysfs observation",
    () =>
      withUsbSysfsRoot((usbSysfsRoot) =>
        Effect.gen(function* () {
          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness.ready).toBe(false)
          expect(readiness.usbDevice).toEqual({
            _tag: "Missing",
            source: "cups-inference",
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(
                appConfigLayer(join(usbSysfsRoot, "missing-sysfs-root")),
              ),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer(false)),
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

          const readinessProbe = yield* PrinterReadinessProbe
          const readiness = yield* readinessProbe.observe()

          expect(readiness.ready).toBe(false)
          expect(readiness.cupsQueue._tag).toBe("Reachable")
          expect(readiness.usbDevice).toEqual({
            _tag: "Deauthorized",
            source: "sysfs",
          })
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
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

        const readinessProbe = yield* PrinterReadinessProbe
        const readiness = yield* readinessProbe.observe()

        expect(readiness.ready).toBe(true)
        expect(readiness.usbDevice).toEqual({
          _tag: "Attached",
          source: "sysfs",
        })
      }).pipe(
        Effect.provide(
          PrinterReadinessProbeLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(NodeServices.layer),
            Layer.provide(cupsQueueObserverLayer()),
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

        const readinessProbe = yield* PrinterReadinessProbe
        const initial = yield* readinessProbe.observe()
        rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
        const current = yield* readinessProbe.observe()

        expect(initial.usbDevice._tag).toBe("Attached")
        expect(current.usbDevice._tag).toBe("Missing")
      }).pipe(
        Effect.provide(
          PrinterReadinessProbeLive.pipe(
            Layer.provide(appConfigLayer(usbSysfsRoot)),
            Layer.provide(NodeServices.layer),
            Layer.provide(cupsQueueObserverLayer()),
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

          const readinessProbe = yield* PrinterReadinessProbe
          const initial = yield* readinessProbe.observe()
          rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
          const refreshed = yield* readinessProbe.observe()

          expect(initial.ready).toBe(true)
          expect(refreshed.ready).toBe(false)
          expect(refreshed.usbDevice._tag).toBe("Missing")
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
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

          const readinessProbe = yield* PrinterReadinessProbe
          const initial = yield* readinessProbe.observe()
          rmSync(join(usbSysfsRoot, "1-1"), { recursive: true, force: true })
          const detached = yield* readinessProbe.observe()
          writeUsbDevice(usbSysfsRoot, "1-2", {
            manufacturer: "HP",
            product: "Laser MFP 131 133 135-138",
            serial: "ABC123",
          })
          const reattached = yield* readinessProbe.observe()

          expect(initial.ready).toBe(true)
          expect(detached.ready).toBe(false)
          expect(detached.usbDevice._tag).toBe("Missing")
          expect(reattached.ready).toBe(true)
          expect(reattached.usbDevice._tag).toBe("Attached")
        }).pipe(
          Effect.provide(
            PrinterReadinessProbeLive.pipe(
              Layer.provide(appConfigLayer(usbSysfsRoot)),
              Layer.provide(NodeServices.layer),
              Layer.provide(cupsQueueObserverLayer()),
            ),
          ),
        ),
      ),
  )
})
