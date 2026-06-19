import { Schema } from "effect"

export const PdfPreflightRejectionReason = Schema.Literals([
  "encrypted",
  "pdfinfo-failed",
  "missing-encryption-status",
  "missing-page-count",
])

export type PdfPreflightRejectionReason =
  typeof PdfPreflightRejectionReason.Type

export interface PdfInfoCommandResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly errorMessage?: string
}

export interface PdfInfoSummary {
  readonly encrypted: boolean | null
  readonly pages: number | null
}

export type PdfPreflightDecision =
  | {
      readonly _tag: "Accepted"
      readonly summary: PdfInfoSummary & {
        readonly encrypted: false
        readonly pages: number
      }
    }
  | {
      readonly _tag: "Rejected"
      readonly reason: PdfPreflightRejectionReason
      readonly message: string
      readonly details?: string
      readonly summary?: PdfInfoSummary
    }

const fieldPattern = (fieldName: string): RegExp =>
  new RegExp(`^${fieldName}:\\s*(.+?)\\s*$`, "im")

export const parsePdfInfoSummary = (stdout: string): PdfInfoSummary => {
  const encryptedValue =
    stdout.match(fieldPattern("Encrypted"))?.[1]?.toLowerCase() ?? null
  const pagesValue = stdout.match(fieldPattern("Pages"))?.[1] ?? null
  const pages = pagesValue === null ? null : Number.parseInt(pagesValue, 10)

  return {
    encrypted:
      encryptedValue === null
        ? null
        : encryptedValue === "yes" || encryptedValue.startsWith("yes "),
    pages: pages !== null && Number.isFinite(pages) && pages > 0 ? pages : null,
  }
}

export const decidePdfPreflight = (
  result: PdfInfoCommandResult,
): PdfPreflightDecision => {
  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter((part) => part.length > 0)
    .join("\n")
  const failureDetails =
    result.errorMessage !== undefined
      ? result.errorMessage
      : output.length > 0
        ? output
        : undefined

  if (result.errorMessage !== undefined || result.exitCode !== 0) {
    return {
      _tag: "Rejected",
      reason: "pdfinfo-failed",
      message:
        "PDF metadata could not be read safely; refusing to send it to the printer",
      ...(failureDetails !== undefined ? { details: failureDetails } : {}),
    }
  }

  const summary = parsePdfInfoSummary(result.stdout)

  if (summary.encrypted === true) {
    return {
      _tag: "Rejected",
      reason: "encrypted",
      message:
        "Encrypted or protected PDFs are rejected for this printer; export an unlocked PDF first",
      ...(output.length > 0 ? { details: output } : {}),
      summary,
    }
  }

  if (summary.encrypted !== false) {
    return {
      _tag: "Rejected",
      reason: "missing-encryption-status",
      message:
        "PDF encryption status could not be determined; refusing to send it to the printer",
      ...(output.length > 0 ? { details: output } : {}),
      summary,
    }
  }

  if (summary.pages === null) {
    return {
      _tag: "Rejected",
      reason: "missing-page-count",
      message:
        "PDF page count could not be determined; refusing to send it to the printer",
      ...(output.length > 0 ? { details: output } : {}),
      summary,
    }
  }

  return {
    _tag: "Accepted",
    summary: {
      encrypted: summary.encrypted,
      pages: summary.pages,
    },
  }
}
