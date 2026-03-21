import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

export interface PrinterStatus {
  readonly attached: boolean
  readonly queueAvailable: boolean
  readonly cupsReachable: boolean
  readonly state: string | null
  readonly reasons: readonly string[]
  readonly message: string | null
}

export class PrinterProbe extends ServiceMap.Service<
  PrinterProbe,
  {
    readonly status: () => Effect.Effect<PrinterStatus>
  }
>()("@ipp/agent/PrinterProbe") {}
