import { Context, Effect } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"

export class EventSink extends Context.Tag("@ipp/agent/EventSink")<
  EventSink,
  {
    readonly append: (event: WideEvent) => Effect.Effect<void>
    readonly all: () => Effect.Effect<readonly WideEvent[]>
  }
>() {}
