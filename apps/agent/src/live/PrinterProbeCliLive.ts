import { Effect, Layer } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const cupsObserver = yield* CupsObserver

    const status = Effect.fn("PrinterProbe.status")(function* () {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.map((observation) => ({
          attached: observation.attached,
          queueAvailable: observation.queueAvailable,
          cupsReachable: true,
          state: observation.state,
          reasons: observation.reasons,
          message: observation.message,
        })),
        Effect.catchAll((error) =>
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
