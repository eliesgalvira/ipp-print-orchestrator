import { Context, type Effect } from "effect"

export class CupsEventStream extends Context.Service<
  CupsEventStream,
  {
    readonly run: () => Effect.Effect<never>
  }
>()("@ipp/agent/services/CupsEventStream") {}
