import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { TelemetryUnavailable } from "../domain/Errors.js"
import type { WideEvent } from "../domain/WideEvent.js"

export class Telemetry extends ServiceMap.Service<
  Telemetry,
  {
    readonly emit: (
      event: WideEvent,
    ) => Effect.Effect<void, TelemetryUnavailable>
  }
>()("@ipp/agent/Telemetry") {}
