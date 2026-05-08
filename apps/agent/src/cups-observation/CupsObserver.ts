import { Context, type Effect } from "effect"

import type {
  CupsIppJobNotFound,
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import type {
  CupsJobObservation,
  CupsPrinterObservation,
} from "./CupsObservation.js"

export class CupsObserver extends Context.Service<
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
>()("@ipp/agent/cups-observation/CupsObserver") {}
