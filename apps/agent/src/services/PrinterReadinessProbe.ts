import { Context, type Effect } from "effect"

import type { PrinterReadiness } from "../domain/PrinterReadiness.js"

export class PrinterReadinessProbe extends Context.Service<
  PrinterReadinessProbe,
  {
    readonly observe: () => Effect.Effect<PrinterReadiness>
  }
>()("@ipp/agent/services/PrinterReadinessProbe") {}
