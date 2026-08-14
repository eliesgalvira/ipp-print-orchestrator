import { Context, type Effect } from "effect"

import type {
  CupsIppProtocolError,
  CupsIppUnavailable,
} from "../domain/Errors.js"
import type { CupsPrinterObservation } from "./CupsObservation.js"

export class CupsObserver extends Context.Service<
  CupsObserver,
  {
    readonly observePrinter: () => Effect.Effect<
      CupsPrinterObservation,
      CupsIppUnavailable | CupsIppProtocolError
    >
  }
>()("@ipp/agent/cups-observation/CupsObserver") {}
