import { Context, type Effect } from "effect"

import type { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"

export class Reconciler extends Context.Service<
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
>()("@ipp/agent/services/Reconciler") {}
