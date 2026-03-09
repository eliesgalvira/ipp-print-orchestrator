import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import { JobId } from "./JobId.js"
import {
  type TransitionAction,
  createJob,
  transitionJob,
} from "./StateMachine.js"

const createdAt = "2026-03-09T00:00:00.000Z"

const actionArbitrary: fc.Arbitrary<TransitionAction> = fc.oneof(
  fc.constant({ _tag: "Stored" as const }),
  fc.constant({ _tag: "Queued" as const }),
  fc.constant({ _tag: "SubmissionAttemptStarted" as const }),
  fc.constant({ _tag: "Printing" as const }),
  fc.constant({ _tag: "Completed" as const }),
  fc.constant({ _tag: "Cancelled" as const }),
  fc.constant({ _tag: "Submitted" as const, cupsJobId: "cups-property" }),
  fc.constant({ _tag: "PrinterUnavailable" as const, reason: "printer missing" }),
  fc.constant({ _tag: "CupsUnavailable" as const, reason: "cups down" }),
  fc.constant({ _tag: "RetryScheduled" as const, reason: "retry later" }),
  fc.constant({
    _tag: "SubmissionUncertain" as const,
    reason: "submission unknown",
  }),
  fc.constant({ _tag: "FailedTerminal" as const, reason: "terminal" }),
)

describe("StateMachine property invariants", () => {
  it("keeps terminal states terminal and blocks blind retry after uncertainty", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { minLength: 1, maxLength: 25 }), (actions) => {
        let job = createJob({
          id: JobId.make("job-property"),
          requestId: "req-property",
          printerName: "printer",
          fileName: "document.pdf",
          mimeType: "application/pdf",
          fileSize: 32,
          createdAt,
        })

        let sawUncertain = false
        let sawTerminal = false

        for (const action of actions) {
          const result = transitionJob(job, action, createdAt)

          if (result._tag === "InvalidTransition") {
            if (sawTerminal) {
              expect(result.reason).toContain("terminal")
            }
            if (sawUncertain && action._tag === "SubmissionAttemptStarted") {
              expect(result.reason).toContain("SubmissionUncertain")
            }
            continue
          }

          job = result.job
          sawUncertain ||= job.state === "SubmissionUncertain"
          sawTerminal ||= ["Completed", "FailedTerminal", "Cancelled"].includes(
            job.state,
          )
        }

        if (sawUncertain) {
          const retried = transitionJob(
            job.state === "SubmissionUncertain"
              ? job
              : {
                  ...job,
                  state: "SubmissionUncertain",
                },
            { _tag: "SubmissionAttemptStarted" },
            createdAt,
          )
          expect(retried._tag).toBe("InvalidTransition")
        }
      }),
    )
  })
})
