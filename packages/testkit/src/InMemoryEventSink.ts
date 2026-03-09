import { Effect, Layer, Ref } from "effect"

import type { WideEvent } from "../../../apps/agent/src/domain/WideEvent.js"
import { EventSink } from "../../../apps/agent/src/services/EventSink.js"

export const layer = Layer.effect(
  EventSink,
  Effect.gen(function* () {
    const ref = yield* Ref.make([] as readonly WideEvent[])

    const append = (event: WideEvent) =>
      Ref.update(ref, (events) => [...events, event]).pipe(Effect.asVoid)

    const all = () => Ref.get(ref)

    return EventSink.of({
      append,
      all,
    })
  }),
)
