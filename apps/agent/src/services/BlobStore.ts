import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

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

export class BlobStore extends ServiceMap.Service<
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
>()("@ipp/agent/BlobStore") {}
