import { Match } from "effect"

const physicalPrinterDetachedReasons = new Set([
  "connecting-to-device",
  "offline",
  "shutdown",
  "stopped-partly",
  "timed-out",
])

const cupsQueueBlockingReasons = new Set([
  ...physicalPrinterDetachedReasons,
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

export type CupsQueueState = "idle" | "processing" | "stopped" | "unknown"

export interface CupsQueueObservation {
  readonly queueName: string
  readonly acceptingJobs: boolean
  readonly state: CupsQueueState
  readonly reasons: readonly string[]
  readonly message: string | null
  readonly available: boolean
  readonly physicalPrinterAppearsAttached: boolean
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

const reasonKeyword = (reason: string): string =>
  reason.replace(/-(?:report|warning|error)$/, "")

const normalizeCupsQueueState = (value: unknown): CupsQueueState =>
  Match.value(value).pipe(
    Match.withReturnType<CupsQueueState>(),
    Match.when("idle", () => "idle"),
    Match.when("processing", () => "processing"),
    Match.when("stopped", () => "stopped"),
    Match.orElse(() => "unknown"),
  )

const normalizeBoolean = (value: unknown): boolean => value === true

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

export const derivePhysicalPrinterAppearsAttachedFromCups = (
  reasons: readonly string[],
  state: CupsQueueState,
): boolean =>
  state !== "stopped" &&
  !reasons.some((reason) =>
    physicalPrinterDetachedReasons.has(reasonKeyword(reason)),
  )

export const deriveCupsQueueAvailable = (
  acceptingJobs: boolean,
  state: CupsQueueState,
  reasons: readonly string[],
): boolean =>
  acceptingJobs &&
  state !== "stopped" &&
  !reasons.some((reason) => cupsQueueBlockingReasons.has(reasonKeyword(reason)))

export const makeCupsQueueObservation = (input: {
  readonly queueName: string
  readonly acceptingJobs: unknown
  readonly state: unknown
  readonly reasons: unknown
  readonly message: unknown
}): CupsQueueObservation => {
  const state = normalizeCupsQueueState(input.state)
  const reasons = normalizeReasons(input.reasons)
  const acceptingJobs = normalizeBoolean(input.acceptingJobs)

  return {
    queueName: input.queueName,
    acceptingJobs,
    state,
    reasons,
    message: normalizeString(input.message),
    available: deriveCupsQueueAvailable(acceptingJobs, state, reasons),
    physicalPrinterAppearsAttached:
      derivePhysicalPrinterAppearsAttachedFromCups(reasons, state),
  }
}
