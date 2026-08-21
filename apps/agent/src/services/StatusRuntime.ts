import { Context, type Effect } from "effect"

import type { PrinterReadiness } from "../domain/PrinterReadiness.js"

export interface CupsUnavailableObservation {
  readonly observationReason: string
  readonly message: string
}

export interface StatusSnapshot {
  readonly timestamp: string
  readonly hostname: string
  readonly networkOnline: boolean
  readonly localIps: readonly string[]
  readonly printerReadiness: PrinterReadiness
}

export class StatusRuntime extends Context.Service<
  StatusRuntime,
  {
    readonly recordCupsUnavailable: (
      input: CupsUnavailableObservation,
    ) => Effect.Effect<void>
    readonly observeNow: (reason: string) => Effect.Effect<StatusSnapshot>
    readonly current: () => Effect.Effect<StatusSnapshot>
  }
>()("@ipp/agent/services/StatusRuntime") {}
