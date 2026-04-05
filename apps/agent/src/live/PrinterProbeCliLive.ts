import { Clock, Effect, Layer, Ref } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const cupsObserver = yield* CupsObserver
    const cupsClient = yield* CupsClient
    const configuredDeviceUriRef = yield* Ref.make<string | null>(null)
    const availableDevicesCacheRef = yield* Ref.make<{
      readonly fetchedAtMs: number
      readonly deviceUris: readonly string[]
    } | null>(null)

    const availableDevicesCacheTtlMs = 60_000

    const getConfiguredDeviceUri = Effect.fn("PrinterProbe.getConfiguredDeviceUri")(function* () {
      const cached = yield* Ref.get(configuredDeviceUriRef)
      if (cached !== null) {
        return cached
      }

      const deviceUri = yield* cupsClient.getPrinterDeviceUri().pipe(
        Effect.catchTag("CupsUnavailable", () => Effect.succeed<string | null>(null)),
        Effect.catchTag("CupsCommandFailed", () => Effect.succeed<string | null>(null)),
      )

      if (deviceUri !== null) {
        yield* Ref.set(configuredDeviceUriRef, deviceUri)
      }

      return deviceUri
    })

    const listAvailableDevicesCached = Effect.fn("PrinterProbe.listAvailableDevicesCached")(function* (
      forceRefresh: boolean,
    ) {
      const now = yield* Clock.currentTimeMillis
      const cached = yield* Ref.get(availableDevicesCacheRef)

      if (
        !forceRefresh &&
        cached !== null &&
        now - cached.fetchedAtMs < availableDevicesCacheTtlMs
      ) {
        return cached.deviceUris
      }

      const refreshed = yield* cupsClient.listAvailableDevices().pipe(
        Effect.catchTag("CupsUnavailable", () =>
          cached === null
            ? Effect.succeed<readonly string[]>([])
            : Effect.succeed(cached.deviceUris),
        ),
        Effect.catchTag("CupsCommandFailed", () =>
          cached === null
            ? Effect.succeed<readonly string[]>([])
            : Effect.succeed(cached.deviceUris),
        ),
      )

      yield* Ref.set(availableDevicesCacheRef, {
        fetchedAtMs: now,
        deviceUris: refreshed,
      })

      return refreshed
    })

    const deriveAttached = Effect.fn("PrinterProbe.deriveAttached")(function* (
      attached: boolean,
      reason?: string,
    ) {
      if (!attached) {
        return false
      }

      const deviceUri = yield* getConfiguredDeviceUri()

      if (deviceUri === null || !deviceUri.startsWith("usb://")) {
        return attached
      }

      const availableDevices = yield* listAvailableDevicesCached(
        reason === "udev-usb-event",
      )

      return availableDevices.includes(deviceUri)
    })

    const status = Effect.fn("PrinterProbe.status")(function* (reason?: string) {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.flatMap((observation) =>
          Effect.gen(function* () {
            const attached = yield* deriveAttached(observation.attached, reason)
            return {
              attached,
              queueAvailable: attached && observation.queueAvailable,
              cupsReachable: true,
              state: observation.state,
              reasons: observation.reasons,
              message: observation.message,
            }
          }),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            attached: false,
            queueAvailable: false,
            cupsReachable: false,
            state: null,
            reasons: [error._tag],
            message: error.message,
          }),
        ),
      )
    })

    return PrinterProbe.of({
      status,
    })
  }),
)
