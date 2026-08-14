import { Context, type Effect } from "effect"

import type { CupsCommandFailed, CupsUnavailable } from "../domain/Errors.js"

export class PrinterDeviceSource extends Context.Service<
  PrinterDeviceSource,
  {
    readonly installedDeviceUri: () => Effect.Effect<
      string,
      CupsUnavailable | CupsCommandFailed
    >
  }
>()("@ipp/agent/services/PrinterDeviceSource") {}
