export type SplOutputGuardRejectionReason =
  | "invalid-copies"
  | "missing-page-log"
  | "unexpected-page-count"
  | "oversized-output"

export const SplOutputGuardRejectionReasons = [
  "invalid-copies",
  "missing-page-log",
  "unexpected-page-count",
  "oversized-output",
] as const

export type SplOutputGuardDecision =
  | {
      readonly _tag: "Accepted"
      readonly expectedPages: number
      readonly observedPages: number
      readonly maxBytes: number
    }
  | {
      readonly _tag: "Rejected"
      readonly reason: SplOutputGuardRejectionReason
      readonly message: string
      readonly expectedPages?: number
      readonly observedPages?: number
      readonly maxBytes?: number
    }

const pageLogPattern = /^PAGE:\s+\d+\s+\d+\s*$/gim

export const parseCupsCopies = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export const countCupsPageLogEntries = (stderr: string): number =>
  Array.from(stderr.matchAll(pageLogPattern)).length

export const decideSplOutputGuard = (params: {
  readonly pdfPages: number
  readonly copies: string
  readonly splBytes: number
  readonly filterStderr: string
  readonly maxBytesPerPage: number
  readonly maxTotalBytes: number
}): SplOutputGuardDecision => {
  const copies = parseCupsCopies(params.copies)
  if (copies !== 1) {
    return {
      _tag: "Rejected",
      reason: "invalid-copies",
      message:
        "Only single-copy PDF jobs are accepted by this printer safety filter",
    }
  }

  const expectedPages = params.pdfPages
  const observedPages = countCupsPageLogEntries(params.filterStderr)

  if (observedPages === 0) {
    return {
      _tag: "Rejected",
      reason: "missing-page-log",
      message:
        "Final printer driver did not report PAGE entries; refusing unverified printer output",
      expectedPages,
      observedPages,
    }
  }

  if (observedPages !== expectedPages) {
    return {
      _tag: "Rejected",
      reason: "unexpected-page-count",
      message: `Final printer driver reported ${observedPages} pages for a ${expectedPages}-page PDF`,
      expectedPages,
      observedPages,
    }
  }

  const pageBudget = expectedPages * params.maxBytesPerPage
  const maxBytes = Math.min(pageBudget, params.maxTotalBytes)

  if (params.splBytes > maxBytes) {
    return {
      _tag: "Rejected",
      reason: "oversized-output",
      message: `Final printer output was ${params.splBytes} bytes, above the safety limit of ${maxBytes} bytes`,
      expectedPages,
      observedPages,
      maxBytes,
    }
  }

  return {
    _tag: "Accepted",
    expectedPages,
    observedPages,
    maxBytes,
  }
}
