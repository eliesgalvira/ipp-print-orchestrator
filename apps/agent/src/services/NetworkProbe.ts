import { Context, Effect } from "effect"

export interface NetworkStatus {
  readonly online: boolean
  readonly localIps: readonly string[]
}

export class NetworkProbe extends Context.Tag("@ipp/agent/NetworkProbe")<
  NetworkProbe,
  {
    readonly status: () => Effect.Effect<NetworkStatus>
  }
>() {}
