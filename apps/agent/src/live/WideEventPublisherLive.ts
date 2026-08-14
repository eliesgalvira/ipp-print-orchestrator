import { Effect, Layer } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { Telemetry } from "../services/Telemetry.js"

export const WideEventPublisherLive = Layer.effect(
  WideEventPublisher,
  Effect.gen(function* () {
    const telemetry = yield* Telemetry

    const emit = Effect.fn("WideEventPublisher.emit")((event: WideEvent) =>
      telemetry.emit(event).pipe(Effect.catch(() => Effect.void)),
    )

    return WideEventPublisher.of({
      emit,
    })
  }),
)
