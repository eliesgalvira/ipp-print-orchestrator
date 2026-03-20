import { Context, Effect } from "effect"

import type {
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import type {
  CupsJobObservation,
  CupsPrinterObservation,
} from "./CupsObservation.js"

export class CupsObserver extends Context.Tag("@ipp/agent/CupsObserver")<
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
>() {}
