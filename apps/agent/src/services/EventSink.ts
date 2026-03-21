import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { EventSinkUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class EventSink extends ServiceMap.Service<
  EventSink,
  {
    readonly append: (
      event: WideEvent,
    ) => Effect.Effect<void, EventSinkUnavailable>
    readonly all: () => Effect.Effect<readonly WideEvent[], EventSinkUnavailable>
  }
>()("@ipp/agent/EventSink") {}
