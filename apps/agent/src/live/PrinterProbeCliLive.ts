import { Effect, Layer } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const cupsObserver = yield* CupsObserver
    const cupsClient = yield* CupsClient

    const deriveAttached = Effect.fn("PrinterProbe.deriveAttached")(function* (
      attached: boolean,
    ) {
      if (!attached) {
        return false
      }

      const deviceUri = yield* cupsClient.getPrinterDeviceUri().pipe(
        Effect.catchTag("CupsUnavailable", () => Effect.succeed(null)),
        Effect.catchTag("CupsCommandFailed", () => Effect.succeed(null)),
      )

      if (deviceUri === null || !deviceUri.startsWith("usb://")) {
        return attached
      }

      const availableDevices = yield* cupsClient.listAvailableDevices().pipe(
        Effect.catchTag("CupsUnavailable", () => Effect.succeed<readonly string[]>([])),
        Effect.catchTag("CupsCommandFailed", () => Effect.succeed<readonly string[]>([])),
      )

      return availableDevices.includes(deviceUri)
    })

    const status = Effect.fn("PrinterProbe.status")(function* () {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.flatMap((observation) =>
          Effect.gen(function* () {
            const attached = yield* deriveAttached(observation.attached)
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
