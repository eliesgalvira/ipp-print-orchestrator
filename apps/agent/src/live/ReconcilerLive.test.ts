import { describe, expect, it } from "@effect/vitest"
import { FileSystem } from "@effect/platform"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { Job } from "../domain/Job.js"
import { JobId } from "../domain/JobId.js"
import { EventSink } from "../services/EventSink.js"
import { JobRepo } from "../services/JobRepo.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Reconciler } from "../services/Reconciler.js"
import { EventSinkFileLive } from "./EventSinkFileLive.js"
import { JobRepoFileLive } from "./JobRepoFileLive.js"
import { QueueRuntimeLive } from "./QueueRuntimeLive.js"
import { ReconcilerLive } from "./ReconcilerLive.js"
import { TelemetryLive } from "./TelemetryLive.js"

const appConfigLayer = (dataDir: string) =>
  Layer.succeed(AppConfig, {
    dataDir,
    printerName: "test-printer",
    bindHost: "127.0.0.1",
    bindPort: 4310,
    heartbeatIntervalMs: 60_000,
    reconcileIntervalMs: 1_000,
    logPretty: false,
    enableOtlp: false,
  })

describe("ReconcilerLive", () => {
  it.effect("re-enqueues persisted nonterminal jobs on startup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dataDir = yield* fs.makeTempDirectory({ prefix: "ipp-orch-reconcile-" })

      const storageLayer = JobRepoFileLive.pipe(
        Layer.provideMerge(appConfigLayer(dataDir)),
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePath.layer),
      )

      const queuedJob = Job.make({
        id: JobId.make("job-reconcile-1"),
        requestId: "req-reconcile-1",
        printerName: "test-printer",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        fileSize: 12,
        state: "Queued",
        retryCount: 0,
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
      })

      yield* Effect.gen(function* () {
        const repo = yield* JobRepo
        yield* repo.create(queuedJob)
      }).pipe(Effect.provide(storageLayer))

      const runtimeLayer = ReconcilerLive.pipe(
        Layer.provideMerge(JobRepoFileLive),
        Layer.provideMerge(EventSinkFileLive),
        Layer.provideMerge(QueueRuntimeLive),
        Layer.provideMerge(TelemetryLive),
        Layer.provideMerge(appConfigLayer(dataDir)),
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePath.layer),
      )

      const result = yield* Effect.gen(function* () {
        const reconciler = yield* Reconciler
        const queueRuntime = yield* QueueRuntime
        const eventSink = yield* EventSink

        const jobs = yield* reconciler.reconcileStartup()
        const queueSize = yield* queueRuntime.size()
        const events = yield* eventSink.all()

        return { jobs, queueSize, events }
      }).pipe(Effect.provide(runtimeLayer))

      expect(result.jobs).toHaveLength(1)
      expect(result.queueSize).toBe(1)
      expect(result.events.map((event) => event.eventName)).toEqual([
        "startup.reconciliation.started",
        "startup.reconciliation.completed",
      ])
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
})
