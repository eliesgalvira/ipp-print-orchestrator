import { Console, Effect, Layer, Option } from "effect"

import { TelemetryUnavailable } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
import { emitWideEventLog } from "../observability/index.js"
import { Telemetry } from "../services/Telemetry.js"
import { encodeJson } from "../util/Json.js"

export const TelemetryLive = Layer.succeed(
  Telemetry,
  Telemetry.of({
    emit: (event) =>
      encodeJson(WideEvent)(event).pipe(
        Effect.mapError((error) =>
          new TelemetryUnavailable({ message: String(error) }),
        ),
        Effect.flatMap((json) =>
          Effect.gen(function* () {
            const currentSpan = yield* Effect.currentParentSpan.pipe(Effect.option)
            yield* Console.log(json)
            yield* Effect.sync(() =>
              emitWideEventLog(event, Option.getOrUndefined(currentSpan)),
            )
          }),
        ),
      ),
  }),
)
