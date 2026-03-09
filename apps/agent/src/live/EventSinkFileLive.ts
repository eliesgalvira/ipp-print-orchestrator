import { FileSystem, Path } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

import { EventSinkUnavailable } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
import { EventSink } from "../services/EventSink.js"
import { makeAppPaths } from "../util/Paths.js"
import {
  ensureAppDirectories,
  writeFileStringAtomic,
} from "./FileSupport.js"

const decodeWideEvent = Schema.decodeUnknown(WideEvent)

export const EventSinkFileLive = Layer.effect(
  EventSink,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(
      Effect.mapError((error) =>
        EventSinkUnavailable.make({ message: String(error) }),
      ),
    )

    const all = () =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(paths.outboxFile).pipe(
          Effect.mapError((error) =>
            EventSinkUnavailable.make({ message: String(error) }),
          ),
        )
        if (!exists) {
          return [] as readonly WideEvent[]
        }

        const contents = yield* fs.readFileString(paths.outboxFile).pipe(
          Effect.mapError((error) =>
            EventSinkUnavailable.make({ message: String(error) }),
          ),
        )
        const lines = contents
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        return yield* Effect.forEach(lines, (line) =>
          Effect.try({
            try: () => JSON.parse(line),
            catch: (error) =>
              EventSinkUnavailable.make({ message: String(error) }),
          }).pipe(
            Effect.flatMap((parsed) =>
              decodeWideEvent(parsed).pipe(
                Effect.mapError((error) =>
                  EventSinkUnavailable.make({ message: String(error) }),
                ),
              ),
            ),
          ),
        )
      })

    const append = (event: WideEvent) =>
      Effect.gen(function* () {
        const events = yield* all()
        yield* writeFileStringAtomic(
          fs,
          path,
          paths.outboxFile,
          [...events, event].map((item) => JSON.stringify(item)).join("\n") + "\n",
        ).pipe(
          Effect.mapError((error) =>
            EventSinkUnavailable.make({ message: String(error) }),
          ),
        )
      })

    return EventSink.of({
      append,
      all,
    })
  }),
)
