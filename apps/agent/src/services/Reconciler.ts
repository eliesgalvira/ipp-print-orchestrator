import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"

export class Reconciler extends ServiceMap.Service<
  Reconciler,
  {
    readonly rehydrateRetryableJobs: () => Effect.Effect<
      readonly Job[],
      StartupRecoveryFailed
    >
    readonly repairCupsTrackedJobs: () => Effect.Effect<
      readonly Job[],
      StartupRecoveryFailed
    >
    readonly recoverStartup: () => Effect.Effect<
      readonly Job[],
      StartupRecoveryFailed
    >
  }
>()("@ipp/agent/Reconciler") {}
