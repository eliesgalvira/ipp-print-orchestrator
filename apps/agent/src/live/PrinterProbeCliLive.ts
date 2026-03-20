import { Effect, Layer } from "effect"

import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

const normalizeDeviceUri = (deviceUri: string): string => deviceUri.split("?")[0] ?? deviceUri

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const cupsClient = yield* CupsClient

    const status = () =>
      Effect.all({
        summary: cupsClient.getPrinterSummary(),
        configuredDeviceUri: cupsClient.getPrinterDeviceUri(),
        availableDevices: cupsClient.listAvailableDevices(),
      }).pipe(
        Effect.map(({ summary, configuredDeviceUri, availableDevices }) => {
          const normalizedConfigured = normalizeDeviceUri(configuredDeviceUri)
          const attached = availableDevices.some((deviceUri) => {
            const normalizedAvailable = normalizeDeviceUri(deviceUri)
            return (
              deviceUri === configuredDeviceUri ||
              normalizedAvailable === normalizedConfigured
            )
          })

          return {
            attached,
            queueAvailable: summary.available,
          }
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            attached: false,
            queueAvailable: false,
          }),
        ),
      )

    return PrinterProbe.of({
      status,
    })
  }),
)
