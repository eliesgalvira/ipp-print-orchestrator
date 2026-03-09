import { Console, Effect, Layer } from "effect"

import { TelemetryUnavailable } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
import { Telemetry } from "../services/Telemetry.js"
import { encodeJson } from "../util/Json.js"

export const TelemetryLive = Layer.succeed(
  Telemetry,
  Telemetry.of({
    emit: (event) =>
      encodeJson(WideEvent)(event).pipe(
        Effect.mapError((error) =>
          TelemetryUnavailable.make({ message: String(error) }),
        ),
        Effect.flatMap((json) => Console.log(json)),
      ),
  }),
)
