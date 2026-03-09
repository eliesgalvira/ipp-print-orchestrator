import { FileSystem, Path } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

import { JobRepoUnavailable } from "../domain/Errors.js"
import { Job } from "../domain/Job.js"
import type { JobId } from "../domain/JobId.js"
import { terminalJobStates } from "../domain/JobState.js"
import { PrintRequest } from "../domain/PrintRequest.js"
import { WideEvent } from "../domain/WideEvent.js"
import { JobRepo } from "../services/JobRepo.js"
import { encodeJson } from "../util/Json.js"
import { makeAppPaths } from "../util/Paths.js"
import {
  ensureAppDirectories,
  writeFileStringAtomic,
} from "./FileSupport.js"

const mapRepoError = (error: unknown) =>
  JobRepoUnavailable.make({ message: String(error) })

const decodeJob = Schema.decodeUnknown(Job)
const decodeWideEvent = Schema.decodeUnknown(WideEvent)

export const JobRepoFileLive = Layer.effect(
  JobRepo,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(Effect.mapError(mapRepoError))

    const writeTransitions = (jobId: JobId, events: readonly WideEvent[]) =>
      writeFileStringAtomic(
        fs,
        path,
        paths.transitionsFile(jobId),
        events.map((event) => JSON.stringify(event)).join("\n") +
          (events.length > 0 ? "\n" : ""),
      ).pipe(Effect.mapError(mapRepoError))

    const create = (job: Job) =>
      Effect.gen(function* () {
        yield* writeFileStringAtomic(
          fs,
          path,
          paths.requestFile(job.id),
          encodeJson(
            PrintRequest.make({
              id: job.id,
              requestId: job.requestId,
              printerName: job.printerName,
              fileName: job.fileName,
              mimeType: job.mimeType,
              fileSize: job.fileSize,
              createdAt: job.createdAt,
            }),
          ),
        ).pipe(Effect.mapError(mapRepoError))

        yield* writeFileStringAtomic(fs, path, paths.stateFile(job.id), encodeJson(job)).pipe(
          Effect.mapError(mapRepoError),
        )

        const exists = yield* fs.exists(paths.transitionsFile(job.id)).pipe(
          Effect.mapError(mapRepoError),
        )
        if (!exists) {
          yield* writeTransitions(job.id, [])
        }
      })

    const get = (jobId: JobId) =>
      fs.readFileString(paths.stateFile(jobId)).pipe(
        Effect.mapError(mapRepoError),
        Effect.flatMap((json) =>
          Effect.try({
            try: () => JSON.parse(json),
            catch: mapRepoError,
          }),
        ),
        Effect.flatMap((parsed) =>
          decodeJob(parsed).pipe(Effect.mapError(mapRepoError)),
        ),
      )

    const save = (job: Job) =>
      writeFileStringAtomic(fs, path, paths.stateFile(job.id), encodeJson(job)).pipe(
        Effect.mapError(mapRepoError),
      )

    const getTransitions = (jobId: JobId) =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(paths.transitionsFile(jobId)).pipe(
          Effect.mapError(mapRepoError),
        )
        if (!exists) {
          return [] as readonly WideEvent[]
        }

        const contents = yield* fs.readFileString(paths.transitionsFile(jobId)).pipe(
          Effect.mapError(mapRepoError),
        )

        const lines = contents
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        const events = yield* Effect.forEach(lines, (line) =>
          Effect.try({
            try: () => JSON.parse(line),
            catch: mapRepoError,
          }).pipe(
            Effect.flatMap((parsed) =>
              decodeWideEvent(parsed).pipe(Effect.mapError(mapRepoError)),
            ),
          ),
        )

        return events
      })

    const appendTransition = (jobId: JobId, event: WideEvent) =>
      Effect.gen(function* () {
        const current = yield* getTransitions(jobId)
        yield* writeTransitions(jobId, [...current, event])
      })

    const listNonTerminal = () =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(paths.jobsDir).pipe(Effect.mapError(mapRepoError))
        if (!exists) {
          return [] as readonly Job[]
        }

        const jobDirs = yield* fs.readDirectory(paths.jobsDir).pipe(
          Effect.mapError(mapRepoError),
        )

        const loaded = yield* Effect.forEach(jobDirs, (jobDirName) =>
          get(jobDirName as JobId).pipe(
            Effect.catchTag("JobRepoUnavailable", () => Effect.succeed(null)),
          ),
        )

        return loaded.filter(
          (job): job is Job => job !== null && !terminalJobStates.has(job.state),
        )
      })

    return JobRepo.of({
      create,
      get,
      save,
      appendTransition,
      getTransitions,
      listNonTerminal,
    })
  }),
)
