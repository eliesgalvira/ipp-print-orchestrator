import { Context, Effect } from "effect"

import { EventSinkUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class EventSink extends Context.Tag("@ipp/agent/EventSink")<
  EventSink,
  {
    readonly append: (
      event: WideEvent,
    ) => Effect.Effect<void, EventSinkUnavailable>
    readonly all: () => Effect.Effect<readonly WideEvent[], EventSinkUnavailable>
  }
>() {}
