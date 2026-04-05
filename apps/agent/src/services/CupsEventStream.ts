import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

export class CupsEventStream extends ServiceMap.Service<
  CupsEventStream,
  {
    readonly run: () => Effect.Effect<never>
  }
>()("@ipp/agent/CupsEventStream") {}
