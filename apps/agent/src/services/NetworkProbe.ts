import { Context, type Effect } from "effect"

export interface NetworkStatus {
  readonly online: boolean
  readonly localIps: readonly string[]
}

export class NetworkProbe extends Context.Service<
  NetworkProbe,
  {
    readonly status: () => Effect.Effect<NetworkStatus>
  }
>()("@ipp/agent/services/NetworkProbe") {}
