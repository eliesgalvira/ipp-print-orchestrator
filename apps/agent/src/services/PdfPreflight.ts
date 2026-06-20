import { Context, type Effect } from "effect"

import type {
  PdfPreflightRejected,
  PdfPreflightUnavailable,
} from "../domain/Errors.js"
import type { PdfInfoSummary } from "../domain/PdfPreflight.js"

export interface PdfPreflightReport {
  readonly filePath: string
  readonly summary: PdfInfoSummary & {
    readonly encrypted: false
    readonly pages: number
  }
}

export class PdfPreflight extends Context.Service<
  PdfPreflight,
  {
    readonly validate: (
      filePath: string,
    ) => Effect.Effect<
      PdfPreflightReport,
      PdfPreflightRejected | PdfPreflightUnavailable
    >
  }
>()("@ipp/agent/services/PdfPreflight") {}
