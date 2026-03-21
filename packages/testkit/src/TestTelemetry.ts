import { Effect, Layer, Ref } from "effect"

import { TelemetryUnavailable } from "../../../apps/agent/src/domain/Errors.js"
import type { WideEvent } from "../../../apps/agent/src/domain/WideEvent.js"
import { Telemetry } from "../../../apps/agent/src/services/Telemetry.js"

export const layer = (options?: { readonly failAlways?: boolean }) =>
  Layer.effect(
    Telemetry,
    Effect.gen(function* () {
      const ref = yield* Ref.make([] as readonly WideEvent[])

      const emit = (event: WideEvent) =>
        Ref.update(ref, (events) => [...events, event]).pipe(
          Effect.andThen(
            options?.failAlways
              ? Effect.fail(
                  new TelemetryUnavailable({
                    message: "telemetry sink unavailable",
                  }),
                )
              : Effect.void,
          ),
        )

      return Telemetry.of({
        emit,
      })
    }),
  )
