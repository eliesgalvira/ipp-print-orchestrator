const attachedBlockingReasons = new Set([
  "connecting-to-device",
  "offline",
  "offline-report",
  "shutdown",
  "stopped-partly",
  "timed-out",
])

const queueBlockingReasons = new Set([
  ...attachedBlockingReasons,
  "cover-open",
  "door-open",
  "input-tray-missing",
  "interlock-open",
  "marker-supply-empty",
  "media-empty",
  "media-jam",
  "paused",
  "toner-empty",
])

export type CupsPrinterState = "idle" | "processing" | "stopped" | "unknown"

export type CupsJobState =
  | "pending"
  | "pending-held"
  | "processing"
  | "processing-stopped"
  | "canceled"
  | "aborted"
  | "completed"
  | "unknown"

export interface CupsPrinterObservation {
  readonly printerName: string
  readonly acceptingJobs: boolean
  readonly state: CupsPrinterState
  readonly reasons: readonly string[]
  readonly message: string | null
  readonly attached: boolean
  readonly queueAvailable: boolean
}

export interface CupsJobObservation {
  readonly cupsJobId: string
  readonly state: CupsJobState
  readonly reasons: readonly string[]
  readonly printerState: CupsPrinterState | null
  readonly printerStateReasons: readonly string[]
  readonly printerStateMessage: string | null
  readonly mediaSheetsCompleted: number | null
}

const normalizeReasons = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" && item.length > 0 && item !== "none" ? [item] : [],
    )
  }

  return typeof value === "string" && value.length > 0 && value !== "none"
    ? [value]
    : []
}

const normalizePrinterState = (value: unknown): CupsPrinterState => {
  switch (value) {
    case "idle":
      return "idle"
    case "processing":
      return "processing"
    case "stopped":
      return "stopped"
    default:
      return "unknown"
  }
}

const normalizeJobState = (value: unknown): CupsJobState => {
  switch (value) {
    case "pending":
    case "pending-held":
    case "processing":
    case "processing-stopped":
    case "canceled":
    case "aborted":
    case "completed":
      return value
    default:
      return "unknown"
  }
}

const normalizeBoolean = (value: unknown): boolean => value === true

const normalizeNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

export const derivePrinterAttached = (
  reasons: readonly string[],
  state: CupsPrinterState,
): boolean =>
  state !== "stopped" ||
  !reasons.some((reason) => attachedBlockingReasons.has(reason))

export const deriveQueueAvailable = (
  acceptingJobs: boolean,
  state: CupsPrinterState,
  reasons: readonly string[],
): boolean =>
  acceptingJobs &&
  state !== "stopped" &&
  !reasons.some((reason) => queueBlockingReasons.has(reason))

export const makePrinterObservation = (input: {
  readonly printerName: string
  readonly acceptingJobs: unknown
  readonly state: unknown
  readonly reasons: unknown
  readonly message: unknown
}): CupsPrinterObservation => {
  const state = normalizePrinterState(input.state)
  const reasons = normalizeReasons(input.reasons)
  const acceptingJobs = normalizeBoolean(input.acceptingJobs)

  return {
    printerName: input.printerName,
    acceptingJobs,
    state,
    reasons,
    message: normalizeString(input.message),
    attached: derivePrinterAttached(reasons, state),
    queueAvailable: deriveQueueAvailable(acceptingJobs, state, reasons),
  }
}

export const makeJobObservation = (input: {
  readonly cupsJobId: string
  readonly state: unknown
  readonly reasons: unknown
  readonly printerState: unknown
  readonly printerStateReasons: unknown
  readonly printerStateMessage: unknown
  readonly mediaSheetsCompleted: unknown
}): CupsJobObservation => ({
  cupsJobId: input.cupsJobId,
  state: normalizeJobState(input.state),
  reasons: normalizeReasons(input.reasons),
  printerState:
    input.printerState === undefined || input.printerState === null
      ? null
      : normalizePrinterState(input.printerState),
  printerStateReasons: normalizeReasons(input.printerStateReasons),
  printerStateMessage: normalizeString(input.printerStateMessage),
  mediaSheetsCompleted: normalizeNumber(input.mediaSheetsCompleted),
})
