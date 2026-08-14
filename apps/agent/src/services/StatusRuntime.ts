import { Context, type Effect } from "effect"

export interface StatusObservationInput {
  readonly timestamp: string
  readonly hostname: string
  readonly observationReason: string
  readonly networkOnline?: boolean
  readonly localIps?: readonly string[]
  readonly cupsReachable?: boolean
  readonly printerAttached?: boolean
  readonly printerQueueAvailable?: boolean
  readonly printerState?: string | null
  readonly printerReasons?: readonly string[]
  readonly printerMessage?: string | null
}

export interface StatusSnapshot {
  readonly timestamp: string
  readonly hostname: string
  readonly networkOnline: boolean
  readonly localIps: readonly string[]
  readonly cupsReachable: boolean
  readonly printerAttached: boolean
  readonly printerQueueAvailable: boolean
  readonly printerState: string | null
  readonly printerReasons: readonly string[]
  readonly printerMessage: string | null
}

export class StatusRuntime extends Context.Service<
  StatusRuntime,
  {
    readonly recordObservedStatus: (
      input: StatusObservationInput,
    ) => Effect.Effect<void>
    readonly observeNow: (reason: string) => Effect.Effect<StatusSnapshot>
    readonly current: () => Effect.Effect<StatusSnapshot>
  }
>()("@ipp/agent/services/StatusRuntime") {}
