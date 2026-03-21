import { describe, expect, it } from "@effect/vitest"

import { createJob, transitionJob } from "./StateMachine.js"
import { JobId } from "./JobId.js"

const createdAt = "2026-03-09T00:00:00.000Z"

const makeJob = () =>
  createJob({
    id: JobId.makeUnsafe("job-1"),
    requestId: "req-1",
    printerName: "printer",
    fileName: "document.pdf",
    mimeType: "application/pdf",
    fileSize: 128,
    createdAt,
  })

describe("StateMachine", () => {
  it("applies the happy path with explicit events", () => {
    const received = makeJob()
    const stored = transitionJob(received, { _tag: "Stored" }, createdAt)

    expect(stored._tag).toBe("TransitionApplied")
    if (stored._tag !== "TransitionApplied") {
      return
    }

    expect(stored.job.state).toBe("Stored")
    expect(stored.event.eventName).toBe("print.job.stored")
    expect(stored.event.previousState).toBe("Received")
    expect(stored.event.currentState).toBe("Stored")

    const queued = transitionJob(stored.job, { _tag: "Queued" }, createdAt)
    expect(queued._tag).toBe("TransitionApplied")
    if (queued._tag !== "TransitionApplied") {
      return
    }

    const submitting = transitionJob(
      queued.job,
      { _tag: "SubmissionAttemptStarted" },
      createdAt,
    )
    expect(submitting._tag).toBe("TransitionApplied")
    if (submitting._tag !== "TransitionApplied") {
      return
    }

    const submitted = transitionJob(
      submitting.job,
      { _tag: "Submitted", cupsJobId: "cups-42" },
      createdAt,
    )
    expect(submitted._tag).toBe("TransitionApplied")
    if (submitted._tag !== "TransitionApplied") {
      return
    }

    const completed = transitionJob(submitted.job, { _tag: "Completed" }, createdAt)
    expect(completed._tag).toBe("TransitionApplied")
    if (completed._tag !== "TransitionApplied") {
      return
    }

    expect(completed.job.state).toBe("Completed")
    expect(completed.event.eventName).toBe("print.job.completed")
    expect(completed.event.previousState).toBe("Submitted")
    expect(completed.event.currentState).toBe("Completed")
  })

  it("keeps terminal states terminal", () => {
    const completed = {
      ...makeJob(),
      state: "Completed" as const,
    }

    const result = transitionJob(
      completed,
      { _tag: "SubmissionAttemptStarted" },
      createdAt,
    )

    expect(result._tag).toBe("InvalidTransition")
    if (result._tag !== "InvalidTransition") {
      return
    }

    expect(result.reason).toContain("terminal")
  })

  it("does not allow blind re-submit after SubmissionUncertain", () => {
    const received = makeJob()
    const stored = transitionJob(received, { _tag: "Stored" }, createdAt)
    expect(stored._tag).toBe("TransitionApplied")
    if (stored._tag !== "TransitionApplied") {
      return
    }

    const queued = transitionJob(stored.job, { _tag: "Queued" }, createdAt)
    expect(queued._tag).toBe("TransitionApplied")
    if (queued._tag !== "TransitionApplied") {
      return
    }

    const submitting = transitionJob(
      queued.job,
      { _tag: "SubmissionAttemptStarted" },
      createdAt,
    )
    expect(submitting._tag).toBe("TransitionApplied")
    if (submitting._tag !== "TransitionApplied") {
      return
    }

    const uncertain = transitionJob(
      submitting.job,
      { _tag: "SubmissionUncertain", reason: "lp exited after partial write" },
      createdAt,
    )
    expect(uncertain._tag).toBe("TransitionApplied")
    if (uncertain._tag !== "TransitionApplied") {
      return
    }

    expect(uncertain.job.state).toBe("SubmissionUncertain")

    const retried = transitionJob(
      uncertain.job,
      { _tag: "SubmissionAttemptStarted" },
      createdAt,
    )

    expect(retried._tag).toBe("InvalidTransition")
  })
})
