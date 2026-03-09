import { Effect, Layer, Ref } from "effect"

import type { JobId } from "../../../apps/agent/src/domain/JobId.js"
import { BlobStoreUnavailable } from "../../../apps/agent/src/domain/Errors.js"
import { BlobStore } from "../../../apps/agent/src/services/BlobStore.js"

interface StoredBlob {
  readonly fileName: string
  readonly bytes: Uint8Array
}

export const layer = Layer.effect(
  BlobStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(new Map<string, StoredBlob>())

    const putOriginal = (jobId: JobId, fileName: string, bytes: Uint8Array) =>
      Ref.update(ref, (store) => {
        store.set(String(jobId), { fileName, bytes })
        return store
      }).pipe(
        Effect.as({
          path: `in-memory://${String(jobId)}/${fileName}`,
          size: bytes.byteLength,
          fileName,
        }),
      )

    const getOriginal = (jobId: JobId) =>
      Ref.get(ref).pipe(
        Effect.flatMap((store) => {
          const blob = store.get(String(jobId))
          return blob === undefined
            ? Effect.fail(
                BlobStoreUnavailable.make({
                  message: `missing blob ${String(jobId)}`,
                }),
              )
            : Effect.succeed(blob.bytes)
        }),
      )

    const getInfo = (jobId: JobId) =>
      Ref.get(ref).pipe(
        Effect.flatMap((store) => {
          const blob = store.get(String(jobId))
          return blob === undefined
            ? Effect.fail(
                BlobStoreUnavailable.make({
                  message: `missing blob ${String(jobId)}`,
                }),
              )
            : Effect.succeed({
                path: `in-memory://${String(jobId)}/${blob.fileName}`,
                size: blob.bytes.byteLength,
                fileName: blob.fileName,
              })
        }),
      )

    return BlobStore.of({
      putOriginal,
      getOriginal,
      getInfo,
    })
  }),
)
