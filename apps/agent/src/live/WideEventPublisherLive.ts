import { Effect, Layer } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { EventSink } from "../services/EventSink.js"
import { Telemetry } from "../services/Telemetry.js"

export const WideEventPublisherLive = Layer.effect(
  WideEventPublisher,
  Effect.gen(function* () {
    const eventSink = yield* EventSink
    const telemetry = yield* Telemetry

    const emit = Effect.fn("WideEventPublisher.emit")(function* (event: WideEvent) {
      yield* eventSink.append(event)
      yield* telemetry.emit(event).pipe(Effect.catchAll(() => Effect.void))
    })

    return WideEventPublisher.of({
      emit,
    })
  }),
)
