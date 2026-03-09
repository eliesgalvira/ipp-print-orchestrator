import { Context, Effect } from "effect"

export interface PrinterStatus {
  readonly attached: boolean
  readonly queueAvailable: boolean
}

export class PrinterProbe extends Context.Tag("@ipp/agent/PrinterProbe")<
  PrinterProbe,
  {
    readonly status: () => Effect.Effect<PrinterStatus>
  }
>() {}
