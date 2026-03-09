import { FileSystem, Path } from "@effect/platform"
import { Effect, Layer } from "effect"

import { JobRepoUnavailable } from "../domain/Errors.js"
import { Job } from "../domain/Job.js"
import type { JobId } from "../domain/JobId.js"
import { terminalJobStates } from "../domain/JobState.js"
import { PrintRequest } from "../domain/PrintRequest.js"
import { WideEvent } from "../domain/WideEvent.js"
import { JobRepo } from "../services/JobRepo.js"
import {
  decodeJson,
  decodeJsonLines,
  encodeJson,
  encodeJsonLines,
} from "../util/Json.js"
import { makeAppPaths } from "../util/Paths.js"
import {
  ensureAppDirectories,
  writeFileStringAtomic,
} from "./FileSupport.js"

const mapRepoError = (error: unknown) =>
  JobRepoUnavailable.make({ message: String(error) })

export const JobRepoFileLive = Layer.effect(
  JobRepo,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(Effect.mapError(mapRepoError))

    const writeTransitions = (jobId: JobId, events: readonly WideEvent[]) =>
      encodeJsonLines(WideEvent, events).pipe(
        Effect.mapError(mapRepoError),
        Effect.flatMap((content) =>
          writeFileStringAtomic(
            fs,
            path,
            paths.transitionsFile(jobId),
            content,
          ).pipe(Effect.mapError(mapRepoError)),
        ),
      )

    const create = (job: Job) =>
      Effect.gen(function* () {
        yield* writeFileStringAtomic(
          fs,
          path,
          paths.requestFile(job.id),
          yield* encodeJson(PrintRequest)(
            PrintRequest.make({
              id: job.id,
              requestId: job.requestId,
              printerName: job.printerName,
              fileName: job.fileName,
              mimeType: job.mimeType,
              fileSize: job.fileSize,
              createdAt: job.createdAt,
            }),
          ).pipe(Effect.mapError(mapRepoError)),
        ).pipe(Effect.mapError(mapRepoError))

        const encodedJob = yield* encodeJson(Job)(job).pipe(
          Effect.mapError(mapRepoError),
        )
        yield* writeFileStringAtomic(fs, path, paths.stateFile(job.id), encodedJob).pipe(
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
        Effect.flatMap((json) => decodeJson(Job)(json).pipe(Effect.mapError(mapRepoError))),
      )

    const getOption = (jobId: JobId) =>
      fs.exists(paths.stateFile(jobId)).pipe(
        Effect.mapError(mapRepoError),
        Effect.flatMap((exists) => (exists ? get(jobId) : Effect.succeed(null))),
      )

    const save = (job: Job) =>
      encodeJson(Job)(job).pipe(
        Effect.mapError(mapRepoError),
        Effect.flatMap((encodedJob) =>
          writeFileStringAtomic(fs, path, paths.stateFile(job.id), encodedJob).pipe(
            Effect.mapError(mapRepoError),
          ),
        ),
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

        return yield* decodeJsonLines(WideEvent, contents).pipe(
          Effect.mapError(mapRepoError),
        )
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
      getOption,
      save,
      appendTransition,
      getTransitions,
      listNonTerminal,
    })
  }),
)
