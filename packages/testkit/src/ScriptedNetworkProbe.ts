import { Effect, Layer } from "effect"

import { NetworkProbe } from "../../../apps/agent/src/services/NetworkProbe.js"
import { makeFaultScript } from "./FaultScript.js"

export type NetworkProbeStep = {
  readonly online: boolean
  readonly localIps: readonly string[]
}

export const layer = (
  steps: readonly [NetworkProbeStep, ...readonly NetworkProbeStep[]],
) =>
  Layer.effect(
    NetworkProbe,
    Effect.gen(function* () {
      const script = yield* makeFaultScript(steps)

      const status = () => script.next

      return NetworkProbe.of({
        status,
      })
    }),
  )
