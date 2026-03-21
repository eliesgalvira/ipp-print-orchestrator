import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import type {
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import type {
  CupsJobObservation,
  CupsPrinterObservation,
} from "./CupsObservation.js"

export class CupsObserver extends ServiceMap.Service<
  CupsObserver,
  {
    readonly observePrinter: () => Effect.Effect<
      CupsPrinterObservation,
      CupsIppUnavailable | CupsIppProtocolError
    >
    readonly observeJob: (
      cupsJobId: string,
    ) => Effect.Effect<
      CupsJobObservation | null,
      CupsIppUnavailable | CupsIppProtocolError | CupsIppJobNotFound
    >
  }
>()("@ipp/agent/CupsObserver") {}
