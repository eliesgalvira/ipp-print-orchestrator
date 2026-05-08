import { Context, type Effect } from "effect"
import type {
  BlobStoreDiskFull,
  BlobStoreUnavailable,
} from "../domain/Errors.js"
import type { JobId } from "../domain/JobId.js"

export interface StoredBlobInfo {
  readonly path: string
  readonly size: number
  readonly fileName: string
}

export class BlobStore extends Context.Service<
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
>()("@ipp/agent/services/BlobStore") {}
