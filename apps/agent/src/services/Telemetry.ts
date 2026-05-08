import { Context, type Effect } from "effect"

import type { TelemetryUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class Telemetry extends Context.Service<
  Telemetry,
  {
    readonly emit: (
      event: WideEvent,
    ) => Effect.Effect<void, TelemetryUnavailable>
  }
>()("@ipp/agent/services/Telemetry") {}
