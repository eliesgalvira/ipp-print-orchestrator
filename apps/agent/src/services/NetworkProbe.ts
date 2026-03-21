import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

export interface NetworkStatus {
  readonly online: boolean
  readonly localIps: readonly string[]
}

export class NetworkProbe extends ServiceMap.Service<
  NetworkProbe,
  {
    readonly status: () => Effect.Effect<NetworkStatus>
  }
>()("@ipp/agent/NetworkProbe") {}
