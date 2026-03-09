import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, TestClock } from "effect"

import { JobId } from "../domain/JobId.js"
import { EventSink } from "./EventSink.js"
import { BlobStore } from "./BlobStore.js"
import { JobRepo } from "./JobRepo.js"
import { Orchestrator } from "./Orchestrator.js"
import { QueueRuntime } from "./QueueRuntime.js"
import { makeTestLayer } from "../../../../packages/testkit/src/TestLayers.js"

const makeBytes = () => new TextEncoder().encode("test document")

describe("Orchestrator", () => {
  it.effect("stores, persists, enqueues, and submits on the happy path", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const blobStore = yield* BlobStore
      const jobRepo = yield* JobRepo
      const eventSink = yield* EventSink
      const queueRuntime = yield* QueueRuntime

      const job = yield* orchestrator.submit({
        id: JobId.make("job-happy"),
        requestId: "req-happy",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const blob = yield* blobStore.getInfo(job.id)
      expect(blob.size).toBe(makeBytes().byteLength)

      const persisted = yield* jobRepo.get(job.id)
      expect(persisted.state).toBe("Queued")

      expect(yield* queueRuntime.size()).toBe(1)

      const processed = yield* orchestrator.processJob(job.id)
      expect(processed.state).toBe("Submitted")
      expect(processed.cupsJobId).toBe("cups-1")

      const events = yield* eventSink.all()
      expect(events.map((event) => event.eventName)).toEqual([
        "print.request.received",
        "print.job.stored",
        "print.job.queued",
        "print.job.submission.attempt",
        "print.job.submitted",
      ])
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: true, queueAvailable: true }],
          cups: [{ _tag: "Submitted", cupsJobId: "cups-1" }],
        }),
      ),
    ),
  )

  it.effect("handles printer unplugged without a defect", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventSink = yield* EventSink

      const job = yield* orchestrator.submit({
        id: JobId.make("job-printer"),
        requestId: "req-printer",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const processed = yield* orchestrator.processJob(job.id)
      expect(processed.state).toBe("WaitingForPrinter")

      const events = yield* eventSink.all()
      const failureEvent = events.find(
        (event) => event.currentState === "WaitingForPrinter",
      )
      expect(failureEvent?.errorTag).toBe("PrinterNotReady")
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: false, queueAvailable: false }],
          cups: [{ _tag: "Submitted", cupsJobId: "unused" }],
        }),
      ),
    ),
  )

  it.effect("retries cups unavailability under TestClock and then succeeds", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const jobRepo = yield* JobRepo

      const job = yield* orchestrator.submit({
        id: JobId.make("job-cups-retry"),
        requestId: "req-cups-retry",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const fiber = yield* Effect.fork(orchestrator.processJob(job.id))
      yield* TestClock.adjust(2_000)
      const processed = yield* Fiber.join(fiber)

      expect(processed.state).toBe("Submitted")

      const transitions = yield* jobRepo.getTransitions(job.id)
      expect(
        transitions.filter((event) => event.currentState === "WaitingForCups").length,
      ).toBe(2)
      expect(
        transitions.filter((event) => event.currentState === "RetryScheduled").length,
      ).toBe(2)
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: true, queueAvailable: true }],
          cups: [
            { _tag: "CupsUnavailable", message: "cups is down" },
            { _tag: "CupsUnavailable", message: "cups is still down" },
            { _tag: "Submitted", cupsJobId: "cups-after-retry" },
          ],
        }),
      ),
    ),
  )

  it.effect("keeps printing working when telemetry is unavailable", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const eventSink = yield* EventSink

      const job = yield* orchestrator.submit({
        id: JobId.make("job-telemetry"),
        requestId: "req-telemetry",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const processed = yield* orchestrator.processJob(job.id)
      expect(processed.state).toBe("Submitted")

      const events = yield* eventSink.all()
      expect(events.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: true, queueAvailable: true }],
          cups: [{ _tag: "Submitted", cupsJobId: "cups-telemetry" }],
          failTelemetry: true,
        }),
      ),
    ),
  )

  it.effect("enters SubmissionUncertain without blind re-submit", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator
      const jobRepo = yield* JobRepo

      const job = yield* orchestrator.submit({
        id: JobId.make("job-uncertain"),
        requestId: "req-uncertain",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const processed = yield* orchestrator.processJob(job.id)
      expect(processed.state).toBe("SubmissionUncertain")

      const transitions = yield* jobRepo.getTransitions(job.id)
      expect(
        transitions.filter(
          (event) => event.eventName === "print.job.submission.attempt",
        ).length,
      ).toBe(1)
      expect(
        transitions.some((event) => event.eventName === "print.job.submitted"),
      ).toBe(false)
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: true, queueAvailable: true }],
          cups: [
            {
              _tag: "SubmissionUncertain",
              message: "lp disconnected before completion acknowledgement",
            },
          ],
        }),
      ),
    ),
  )

  it.effect("degrades gracefully when the network is offline", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      const job = yield* orchestrator.submit({
        id: JobId.make("job-network-offline"),
        requestId: "req-network-offline",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        bytes: makeBytes(),
      })

      const processed = yield* orchestrator.processJob(job.id)
      expect(processed.state).toBe("Submitted")
    }).pipe(
      Effect.provide(
        makeTestLayer({
          printer: [{ attached: true, queueAvailable: true }],
          cups: [{ _tag: "Submitted", cupsJobId: "cups-network-offline" }],
          network: [{ online: false, localIps: [] }],
        }),
      ),
    ),
  )
})
