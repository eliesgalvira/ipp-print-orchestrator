import { Effect, Layer } from "effect"

import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const cupsClient = yield* CupsClient

    const status = () =>
      cupsClient.getPrinterSummary().pipe(
        Effect.map((summary) => ({
          attached: summary.available,
          queueAvailable: true,
        })),
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
