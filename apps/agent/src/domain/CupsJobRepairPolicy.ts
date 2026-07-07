import type { CupsJobObservation } from "../cups-observation/CupsObservation.js"
import type { Job } from "./Job.js"
import type { TransitionAction } from "./StateMachine.js"

const abortedReasonFor = (observation: CupsJobObservation): string => {
  if (observation.printerStateMessage !== null) {
    return observation.printerStateMessage
  }

  return observation.reasons.length === 0
    ? "CUPS reported aborted"
    : observation.reasons.join(", ")
}

export const deriveCupsJobRepairAction = (
  job: Job,
  observation: CupsJobObservation | null,
): TransitionAction | null => {
  if (observation === null) {
    if (job.state === "SubmissionUncertain") {
      return null
    }

    return {
      _tag: "SubmissionUncertain",
      reason: `CUPS no longer reports job ${job.cupsJobId ?? "unknown"}`,
    }
  }

  if (
    observation.state === "processing" ||
    observation.state === "processing-stopped"
  ) {
    return job.state === "Printing" ? null : { _tag: "Printing" }
  }

  if (observation.state === "completed") {
    return { _tag: "Completed" }
  }

  if (observation.state === "canceled") {
    return { _tag: "Cancelled" }
  }

  if (observation.state === "aborted") {
    return {
      _tag: "FailedTerminal",
      reason: abortedReasonFor(observation),
    }
  }

  return null
}
