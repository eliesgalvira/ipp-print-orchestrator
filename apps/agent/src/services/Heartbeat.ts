import { Context, type Effect } from "effect"

import type { OperationalError } from "../domain/Errors.js"
import type { StatusSnapshot } from "./StatusRuntime.js"

export interface HeartbeatSnapshot extends StatusSnapshot {
  readonly timestamp: string
  readonly hostname: string
  readonly appUp: boolean
  readonly lastSuccessfulHeartbeatAt: string | null
}

export class Heartbeat extends Context.Service<
  Heartbeat,
  {
    readonly beat: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly lastSuccess: () => Effect.Effect<string | null>
  }
>()("@ipp/agent/services/Heartbeat") {}
