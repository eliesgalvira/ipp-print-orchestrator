import { describe, expect, it } from "@effect/vitest"
import { FileSystem } from "@effect/platform"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { Job } from "../domain/Job.js"
import { JobId } from "../domain/JobId.js"
import { WideEvent } from "../domain/WideEvent.js"
import { BlobStore } from "../services/BlobStore.js"
import { EventSink } from "../services/EventSink.js"
import { JobRepo } from "../services/JobRepo.js"
import { BlobStoreLive } from "./BlobStoreLive.js"
import { EventSinkFileLive } from "./EventSinkFileLive.js"
import { JobRepoFileLive } from "./JobRepoFileLive.js"

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

const makeJob = () =>
  Job.make({
    id: JobId.make("job-file-1"),
    requestId: "req-file-1",
    printerName: "test-printer",
    fileName: "document.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    state: "Queued",
    retryCount: 0,
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
  })

const makeEvent = () =>
  WideEvent.make({
    timestamp: "2026-03-09T00:00:00.000Z",
    eventName: "print.job.queued",
    requestId: "req-file-1",
    printId: JobId.make("job-file-1"),
    printerName: "test-printer",
    fileName: "document.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    retryCount: 0,
    currentState: "Queued",
    previousState: "Stored",
  })

describe("file-backed storage", () => {
  it.effect("stores blobs durably on disk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dataDir = yield* fs.makeTempDirectory({ prefix: "ipp-orch-blob-" })
      const liveLayer = BlobStoreLive.pipe(
        Layer.provideMerge(appConfigLayer(dataDir)),
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePath.layer),
      )

      const bytes = new TextEncoder().encode("hello world")
      const result = yield* Effect.gen(function* () {
        const blobStore = yield* BlobStore
        const info = yield* blobStore.putOriginal(
          JobId.make("job-file-1"),
          "document.pdf",
          bytes,
        )
        const loaded = yield* blobStore.getOriginal(JobId.make("job-file-1"))
        return { info, loaded }
      }).pipe(Effect.provide(liveLayer))

      expect(result.info.size).toBe(bytes.byteLength)
      expect(new TextDecoder().decode(result.loaded)).toBe("hello world")
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )

  it.effect("persists jobs and transitions across layer reloads", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dataDir = yield* fs.makeTempDirectory({ prefix: "ipp-orch-jobrepo-" })

      const liveLayer = JobRepoFileLive.pipe(
        Layer.provideMerge(appConfigLayer(dataDir)),
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePath.layer),
      )

      const job = makeJob()
      const event = makeEvent()

      yield* Effect.gen(function* () {
        const repo = yield* JobRepo
        yield* repo.create(job)
        yield* repo.appendTransition(job.id, event)
      }).pipe(Effect.provide(liveLayer))

      const reloaded = yield* Effect.gen(function* () {
        const repo = yield* JobRepo
        const jobAgain = yield* repo.get(job.id)
        const transitions = yield* repo.getTransitions(job.id)
        return { jobAgain, transitions }
      }).pipe(Effect.provide(liveLayer))

      expect(reloaded.jobAgain.state).toBe("Queued")
      expect(reloaded.transitions).toHaveLength(1)
      expect(reloaded.transitions[0]?.eventName).toBe("print.job.queued")
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )

  it.effect("writes wide events to the durable outbox", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dataDir = yield* fs.makeTempDirectory({ prefix: "ipp-orch-events-" })

      const liveLayer = EventSinkFileLive.pipe(
        Layer.provideMerge(appConfigLayer(dataDir)),
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePath.layer),
      )

      yield* Effect.gen(function* () {
        const sink = yield* EventSink
        yield* sink.append(makeEvent())
      }).pipe(Effect.provide(liveLayer))

      const events = yield* Effect.gen(function* () {
        const sink = yield* EventSink
        return yield* sink.all()
      }).pipe(Effect.provide(liveLayer))

      expect(events).toHaveLength(1)
      expect(events[0]?.eventName).toBe("print.job.queued")
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
})
