import { Context, Effect } from "effect"

import type { JobId } from "../domain/JobId.js"
import {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
} from "../domain/Errors.js"

export interface StoredBlobInfo {
  readonly path: string
  readonly size: number
  readonly fileName: string
}

export class BlobStore extends Context.Tag("@ipp/agent/BlobStore")<
  BlobStore,
  {
    readonly putOriginal: (
      jobId: JobId,
      fileName: string,
      bytes: Uint8Array,
    ) => Effect.Effect<StoredBlobInfo, BlobStoreUnavailable | BlobStoreDiskFull>
    readonly getOriginal: (
      jobId: JobId,
    ) => Effect.Effect<Uint8Array, BlobStoreUnavailable>
    readonly getInfo: (
      jobId: JobId,
    ) => Effect.Effect<StoredBlobInfo, BlobStoreUnavailable>
  }
>() {}
