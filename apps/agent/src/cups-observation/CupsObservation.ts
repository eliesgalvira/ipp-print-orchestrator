import { Match } from "effect"

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

export interface CupsPrinterObservation {
  readonly printerName: string
  readonly acceptingJobs: boolean
  readonly state: CupsPrinterState
  readonly reasons: readonly string[]
  readonly message: string | null
  readonly attached: boolean
  readonly queueAvailable: boolean
}

const normalizeReasons = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" && item.length > 0 && item !== "none"
        ? [item]
        : [],
    )
  }

  return typeof value === "string" && value.length > 0 && value !== "none"
    ? [value]
    : []
}

const normalizePrinterState = (value: unknown): CupsPrinterState =>
  Match.value(value).pipe(
    Match.withReturnType<CupsPrinterState>(),
    Match.when("idle", () => "idle"),
    Match.when("processing", () => "processing"),
    Match.when("stopped", () => "stopped"),
    Match.orElse(() => "unknown"),
  )

const normalizeBoolean = (value: unknown): boolean => value === true

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

export const derivePrinterAttached = (
  reasons: readonly string[],
  state: CupsPrinterState,
): boolean =>
  state !== "stopped" &&
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
