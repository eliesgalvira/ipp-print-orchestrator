import { Context, type Effect } from "effect"

import type {
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import type { CupsQueueObservation } from "./CupsQueueObservation.js"

export class CupsQueueObserver extends Context.Service<
  CupsQueueObserver,
  {
    readonly observeQueue: () => Effect.Effect<
      CupsQueueObservation,
      CupsIppUnavailable | CupsIppProtocolError
    >
  }
>()("@ipp/agent/cups-observation/CupsQueueObserver") {}
