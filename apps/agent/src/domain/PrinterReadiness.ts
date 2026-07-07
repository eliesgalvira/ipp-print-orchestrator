export interface PrinterReadinessInput {
  readonly attached: boolean
  readonly queueAvailable: boolean
  readonly reasons: readonly string[]
  readonly message: string | null
}

export type PrinterReadiness =
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Unavailable"; readonly reason: string }

export const derivePrinterReadiness = (
  printer: PrinterReadinessInput,
): PrinterReadiness => {
  if (printer.attached && printer.queueAvailable) {
    return { _tag: "Ready" }
  }

  const reason =
    printer.message ??
    (printer.reasons.length === 0 ? null : printer.reasons.join(", ")) ??
    "printer unavailable"

  return {
    _tag: "Unavailable",
    reason,
  }
}
