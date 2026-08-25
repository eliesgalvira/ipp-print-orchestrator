import {
  attributeGroups,
  attributeValues,
  type IppAttributeGroup,
  type IppAttributeValue,
  type IppMessage,
  type IppRequestMessage,
} from "@ipp/ipp"

export const CupsJobStates = [
  "pending",
  "pending-held",
  "processing",
  "processing-stopped",
  "canceled",
  "aborted",
  "completed",
  "unknown",
] as const

const knownJobStates = new Set<string>(CupsJobStates)

export type CupsJobState = (typeof CupsJobStates)[number]

export interface CupsJobObservation {
  readonly cupsJobId: number
  readonly state: CupsJobState
  readonly reasons: readonly string[]
  readonly mediaSheetsCompleted: number | null
  readonly impressionsCompleted: number | null
}

export const CupsJobAccountingAnomalies = [
  "completed-without-media-sheet-accounting",
  "completed-with-zero-media-sheets",
  "unsuccessful-with-media-sheets",
] as const

export type CupsJobAccountingAnomaly =
  (typeof CupsJobAccountingAnomalies)[number]

export type CupsJobReconciliation =
  | {
      readonly _tag: "Reconciled"
      readonly current: ReadonlyMap<number, CupsJobObservation>
      readonly changed: readonly CupsJobObservation[]
    }
  | { readonly _tag: "InvalidResponse"; readonly message: string }

const retainedJobAttributes = [
  "job-id",
  "job-state",
  "job-state-reasons",
  "job-media-sheets-completed",
  "job-impressions-completed",
] as const

export const retainedJobsRequest = (printerUri: string): IppRequestMessage => ({
  "operation-attributes-tag": {
    "printer-uri": printerUri,
    "requesting-user-name": "ipp-print-orchestrator",
    "which-jobs": "all",
    "requested-attributes": retainedJobAttributes,
  },
})

const flattenedValues = (
  group: IppAttributeGroup,
  name: string,
): readonly IppAttributeValue[] =>
  attributeValues(group, name).flatMap((value) =>
    Array.isArray(value) ? value : [value],
  )

const singleValue = (
  group: IppAttributeGroup,
  name: string,
): IppAttributeValue | undefined => {
  const values = flattenedValues(group, name)
  return values.length === 1 ? values[0] : undefined
}

const nonNegativeInteger = (
  group: IppAttributeGroup,
  name: string,
): number | null => {
  const value = singleValue(group, name)
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

const jobState = (group: IppAttributeGroup): CupsJobState => {
  const value = singleValue(group, "job-state")
  return typeof value === "string" && knownJobStates.has(value)
    ? (value as CupsJobState)
    : "unknown"
}

const reasons = (group: IppAttributeGroup): readonly string[] =>
  flattenedValues(group, "job-state-reasons").filter(
    (value): value is string => typeof value === "string",
  )

const sameObservation = (
  left: CupsJobObservation,
  right: CupsJobObservation,
): boolean =>
  left.cupsJobId === right.cupsJobId &&
  left.state === right.state &&
  left.mediaSheetsCompleted === right.mediaSheetsCompleted &&
  left.impressionsCompleted === right.impressionsCompleted &&
  left.reasons.length === right.reasons.length &&
  left.reasons.every((reason, index) => reason === right.reasons[index])

export const reconcileRetainedCupsJobs = (
  previous: ReadonlyMap<number, CupsJobObservation>,
  response: IppMessage,
): CupsJobReconciliation => {
  const current = new Map<number, CupsJobObservation>()

  for (const group of attributeGroups(response, "job-attributes-tag")) {
    const cupsJobId = singleValue(group, "job-id")
    if (
      typeof cupsJobId !== "number" ||
      !Number.isInteger(cupsJobId) ||
      cupsJobId <= 0
    ) {
      return {
        _tag: "InvalidResponse",
        message: "Get-Jobs response contains a job without one valid job-id",
      }
    }

    if (current.has(cupsJobId)) {
      return {
        _tag: "InvalidResponse",
        message: `Get-Jobs response contains duplicate job-id ${cupsJobId}`,
      }
    }

    current.set(cupsJobId, {
      cupsJobId,
      state: jobState(group),
      reasons: reasons(group),
      mediaSheetsCompleted: nonNegativeInteger(
        group,
        "job-media-sheets-completed",
      ),
      impressionsCompleted: nonNegativeInteger(
        group,
        "job-impressions-completed",
      ),
    })
  }

  return {
    _tag: "Reconciled",
    current,
    changed: [...current.values()].filter((observation) => {
      const prior = previous.get(observation.cupsJobId)
      return prior === undefined || !sameObservation(prior, observation)
    }),
  }
}

export const cupsJobAccountingAnomaly = (
  observation: CupsJobObservation,
): CupsJobAccountingAnomaly | null => {
  if (observation.state === "completed") {
    if (observation.mediaSheetsCompleted === null) {
      return "completed-without-media-sheet-accounting"
    }
    return observation.mediaSheetsCompleted === 0
      ? "completed-with-zero-media-sheets"
      : null
  }

  return (observation.state === "canceled" ||
    observation.state === "aborted") &&
    observation.mediaSheetsCompleted !== null &&
    observation.mediaSheetsCompleted > 0
    ? "unsuccessful-with-media-sheets"
    : null
}
