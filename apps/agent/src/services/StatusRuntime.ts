import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import type { OperationalError } from "../domain/Errors.js"

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
  readonly queueDepth: number
  readonly nonterminalJobCount: number
}

export class StatusRuntime extends ServiceMap.Service<
  StatusRuntime,
  {
    readonly recordObservedStatus: (
      input: StatusObservationInput,
    ) => Effect.Effect<void, OperationalError>
    readonly observeNow: (
      reason: string,
    ) => Effect.Effect<StatusSnapshot, OperationalError>
    readonly current: () => Effect.Effect<StatusSnapshot, OperationalError>
  }
>()("@ipp/agent/StatusRuntime") {}
