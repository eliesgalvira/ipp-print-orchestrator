import { Effect, Layer } from "effect"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import { AppConfig } from "../config/AppConfig.js"
import { CupsCommandFailed, CupsUnavailable } from "../domain/Errors.js"
import { PrinterDeviceSource } from "../services/PrinterDeviceSource.js"

export const parseInstalledDeviceUri = (output: string): string => {
  const match = output.trim().match(/^device\s+for\s+\S+:\s+(.+)$/i)
  if (match?.[1] === undefined) {
    throw new Error(`Unable to parse lpstat device output: ${output}`)
  }
  return match[1].trim()
}

export const PrinterDeviceSourceCliLive = Layer.effect(
  PrinterDeviceSource,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const childProcessSpawner = yield* ChildProcessSpawner

    const installedDeviceUri = Effect.fn(
      "PrinterDeviceSource.installedDeviceUri",
    )(function* () {
      const output = yield* childProcessSpawner
        .string(ChildProcess.make("lpstat", ["-v", appConfig.printerName]))
        .pipe(
          Effect.mapError(
            (error) => new CupsUnavailable({ message: String(error) }),
          ),
        )

      return yield* Effect.try({
        try: () => parseInstalledDeviceUri(output),
        catch: (error) => new CupsCommandFailed({ message: String(error) }),
      })
    })

    return PrinterDeviceSource.of({ installedDeviceUri })
  }),
)
