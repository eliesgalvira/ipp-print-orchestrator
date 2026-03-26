import * as FileSystem from "effect/FileSystem"
import { Effect, Layer } from "effect"

import { EventSinkUnavailable } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
import { EventSink } from "../services/EventSink.js"
import { decodeJsonLines, encodeJson } from "../util/Json.js"
import { makeAppPaths } from "../util/Paths.js"
import { ensureAppDirectories } from "./FileSupport.js"

export const EventSinkFileLive = Layer.effect(
  EventSink,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(
      Effect.mapError((error) =>
        new EventSinkUnavailable({ message: String(error) }),
      ),
    )

    const all = () =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(paths.outboxFile).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )
        if (!exists) {
          return [] as readonly WideEvent[]
        }

        const contents = yield* fs.readFileString(paths.outboxFile).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )

        return yield* decodeJsonLines(WideEvent, contents).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )
      })

    const append = (event: WideEvent) =>
      Effect.gen(function* () {
        const line = yield* encodeJson(WideEvent)(event).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )
        yield* fs.writeFileString(paths.outboxFile, `${line}\n`, {
          flag: "a",
        }).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )
      })

    return EventSink.of({
      append,
      all,
    })
  }),
)
