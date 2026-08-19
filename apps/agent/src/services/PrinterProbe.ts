import { Context, type Effect } from "effect"

export interface PrinterStatus {
  readonly attached: boolean
  readonly queueAvailable: boolean
  readonly cupsReachable: boolean
  readonly state: string | null
  readonly reasons: readonly string[]
  readonly message: string | null
}

export class PrinterProbe extends Context.Service<
  PrinterProbe,
  {
    readonly status: () => Effect.Effect<PrinterStatus>
  }
>()("@ipp/agent/services/PrinterProbe") {}
