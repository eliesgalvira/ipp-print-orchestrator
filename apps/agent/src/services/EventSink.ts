import { Context, type Effect } from "effect"

import type { EventSinkUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class EventSink extends Context.Service<
  EventSink,
  {
    readonly append: (
      event: WideEvent,
    ) => Effect.Effect<void, EventSinkUnavailable>
    readonly all: () => Effect.Effect<
      readonly WideEvent[],
      EventSinkUnavailable
    >
  }
>()("@ipp/agent/services/EventSink") {}
