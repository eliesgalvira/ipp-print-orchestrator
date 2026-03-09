import { Console } from "effect"
import { Layer } from "effect"

import { Telemetry } from "../services/Telemetry.js"

export const TelemetryLive = Layer.succeed(
  Telemetry,
  Telemetry.of({
    emit: (event) => Console.log(JSON.stringify(event)),
  }),
)
