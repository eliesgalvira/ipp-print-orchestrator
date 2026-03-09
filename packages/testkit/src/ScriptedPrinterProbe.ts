import { Effect, Layer } from "effect"

import { PrinterProbe } from "../../../apps/agent/src/services/PrinterProbe.js"
import { makeFaultScript } from "./FaultScript.js"

export type PrinterProbeStep = {
  readonly attached: boolean
  readonly queueAvailable: boolean
}

export const layer = (
  steps: readonly [PrinterProbeStep, ...readonly PrinterProbeStep[]],
) =>
  Layer.effect(
    PrinterProbe,
    Effect.gen(function* () {
      const script = yield* makeFaultScript(steps)

      const status = () => script.next

      return PrinterProbe.of({
        status,
      })
    }),
  )
