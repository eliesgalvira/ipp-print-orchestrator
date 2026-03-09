import { FileSystem, Path } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

import {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
} from "../domain/Errors.js"
import type { JobId } from "../domain/JobId.js"
import { BlobStore } from "../services/BlobStore.js"
import { decodeJson, encodeJson } from "../util/Json.js"
import { makeAppPaths } from "../util/Paths.js"
import { ensureAppDirectories, writeFileAtomic, writeFileStringAtomic } from "./FileSupport.js"

const mapBlobError = (error: unknown) =>
  String(error).toLowerCase().includes("no space") ||
  String(error).toLowerCase().includes("disk full")
    ? BlobStoreDiskFull.make({ message: String(error) })
    : BlobStoreUnavailable.make({ message: String(error) })

const BlobMetadata = Schema.Struct({
  fileName: Schema.String,
  size: Schema.Number,
  path: Schema.String,
})

export const BlobStoreLive = Layer.effect(
  BlobStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(
      Effect.mapError((error) =>
        BlobStoreUnavailable.make({ message: String(error) }),
      ),
    )

    const putOriginal = (jobId: JobId, fileName: string, bytes: Uint8Array) =>
      Effect.gen(function* () {
        const originalPath = paths.originalFile(jobId, fileName)
        yield* writeFileAtomic(fs, path, originalPath, bytes).pipe(
          Effect.mapError(mapBlobError),
        )
        const metadata = yield* encodeJson(BlobMetadata)({
          fileName,
          size: bytes.byteLength,
          path: originalPath,
        }).pipe(Effect.mapError(mapBlobError))
        yield* writeFileStringAtomic(
          fs,
          path,
          paths.metadataFile(jobId),
          metadata,
        ).pipe(Effect.mapError(mapBlobError))

        return {
          path: originalPath,
          size: bytes.byteLength,
          fileName,
        }
      })

    const getInfo = (jobId: JobId) =>
      fs.readFileString(paths.metadataFile(jobId)).pipe(
        Effect.mapError((error) =>
          BlobStoreUnavailable.make({ message: String(error) }),
        ),
        Effect.flatMap((json) =>
          decodeJson(BlobMetadata)(json).pipe(
            Effect.mapError((error) =>
              BlobStoreUnavailable.make({ message: String(error) }),
            ),
          ),
        ),
      )

    const getOriginal = (jobId: JobId) =>
      Effect.gen(function* () {
        const info = yield* getInfo(jobId)
        return yield* fs.readFile(info.path).pipe(
          Effect.mapError((error) =>
            BlobStoreUnavailable.make({ message: String(error) }),
          ),
        )
      })

    return BlobStore.of({
      putOriginal,
      getOriginal,
      getInfo,
    })
  }),
)
