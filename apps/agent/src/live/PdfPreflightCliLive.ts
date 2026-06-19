import { Effect, Layer } from "effect"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import {
  PdfPreflightRejected,
  PdfPreflightUnavailable,
} from "../domain/Errors.js"
import {
  decidePdfPreflight,
  type PdfInfoCommandResult,
} from "../domain/PdfPreflight.js"
import { PdfPreflight } from "../services/PdfPreflight.js"

export const PdfPreflightCliLive = Layer.effect(
  PdfPreflight,
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner

    const readPdfInfo = Effect.fn("PdfPreflight.readPdfInfo")(function* (
      filePath: string,
    ) {
      return yield* childProcessSpawner
        .string(ChildProcess.make("pdfinfo", [filePath]), {
          includeStderr: true,
        })
        .pipe(
          Effect.timeout("15 seconds"),
          Effect.map(
            (stdout): PdfInfoCommandResult => ({
              exitCode: 0,
              signal: null,
              stdout,
              stderr: "",
            }),
          ),
          Effect.catch((error) =>
            Effect.succeed({
              exitCode: 1,
              signal: null,
              stdout: "",
              stderr: String(error),
            } satisfies PdfInfoCommandResult),
          ),
        )
    })

    const validate = Effect.fn("PdfPreflight.validate")(function* (
      filePath: string,
    ) {
      const commandResult = yield* readPdfInfo(filePath).pipe(
        Effect.mapError(
          (error) => new PdfPreflightUnavailable({ message: String(error) }),
        ),
      )
      const decision = decidePdfPreflight(commandResult)

      if (decision._tag === "Rejected") {
        return yield* new PdfPreflightRejected({
          reason: decision.reason,
          message: decision.message,
          ...(decision.details !== undefined
            ? { details: decision.details }
            : {}),
        })
      }

      return {
        filePath,
        summary: decision.summary,
      }
    })

    return PdfPreflight.of({ validate })
  }),
)
