import { Context, Effect } from "effect"

import { TelemetryUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class Telemetry extends Context.Tag("@ipp/agent/Telemetry")<
  Telemetry,
  {
    readonly emit: (
      event: WideEvent,
    ) => Effect.Effect<void, TelemetryUnavailable>
  }
>() {}
