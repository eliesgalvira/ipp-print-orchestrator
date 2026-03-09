import { Path } from "@effect/platform"
import { Effect } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import type { JobId } from "../domain/JobId.js"

export interface AppPaths {
  readonly dataDir: string
  readonly jobsDir: string
  readonly outboxDir: string
  readonly tmpDir: string
  readonly runDir: string
  readonly jobDir: (jobId: JobId) => string
  readonly requestFile: (jobId: JobId) => string
  readonly stateFile: (jobId: JobId) => string
  readonly transitionsFile: (jobId: JobId) => string
  readonly metadataFile: (jobId: JobId) => string
  readonly originalFile: (jobId: JobId, fileName: string) => string
  readonly outboxFile: string
}

export const makeAppPaths = Effect.gen(function* () {
  const config = yield* AppConfig
  const path = yield* Path.Path

  const dataDir = config.dataDir
  const jobsDir = path.join(dataDir, "jobs")
  const outboxDir = path.join(dataDir, "outbox")
  const tmpDir = path.join(dataDir, "tmp")
  const runDir = path.join(dataDir, "run")
  const jobDir = (jobId: JobId) => path.join(jobsDir, String(jobId))

  return {
    dataDir,
    jobsDir,
    outboxDir,
    tmpDir,
    runDir,
    jobDir,
    requestFile: (jobId: JobId) => path.join(jobDir(jobId), "request.json"),
    stateFile: (jobId: JobId) => path.join(jobDir(jobId), "state.json"),
    transitionsFile: (jobId: JobId) => path.join(jobDir(jobId), "transitions.jsonl"),
    metadataFile: (jobId: JobId) => path.join(jobDir(jobId), "metadata.json"),
    originalFile: (jobId: JobId, fileName: string) => path.join(jobDir(jobId), fileName),
    outboxFile: path.join(outboxDir, "events.jsonl"),
  } satisfies AppPaths
})
