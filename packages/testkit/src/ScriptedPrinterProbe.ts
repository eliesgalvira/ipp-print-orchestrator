import { Effect, Layer } from "effect"

import { PrinterProbe } from "../../../apps/agent/src/services/PrinterProbe.js"
import { makeFaultScript } from "./FaultScript.js"

export type PrinterProbeStep = {
  readonly attached: boolean
  readonly queueAvailable: boolean
  readonly cupsReachable?: boolean
  readonly state?: string | null
  readonly reasons?: readonly string[]
  readonly message?: string | null
}

export const layer = (
  steps: readonly [PrinterProbeStep, ...readonly PrinterProbeStep[]],
) =>
  Layer.effect(
    PrinterProbe,
    Effect.gen(function* () {
      const script = yield* makeFaultScript(steps)

      const status = () =>
        script.next.pipe(
          Effect.map((step) => ({
            attached: step.attached,
            queueAvailable: step.queueAvailable,
            cupsReachable: step.cupsReachable ?? true,
            state: step.state ?? "idle",
            reasons: step.reasons ?? [],
            message: step.message ?? null,
          })),
        )

      return PrinterProbe.of({
        status,
      })
    }),
  )
