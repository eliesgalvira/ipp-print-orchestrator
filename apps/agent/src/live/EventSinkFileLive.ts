import * as FileSystem from "effect/FileSystem"
import { Effect, Layer } from "effect"
import * as Path from "effect/Path"

import { EventSinkUnavailable } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
import { EventSink } from "../services/EventSink.js"
import { decodeJsonLines, encodeJsonLines } from "../util/Json.js"
import { makeAppPaths } from "../util/Paths.js"
import {
  ensureAppDirectories,
  writeFileStringAtomic,
} from "./FileSupport.js"

export const EventSinkFileLive = Layer.effect(
  EventSink,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
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
        const events = yield* all()
        const content = yield* encodeJsonLines(WideEvent, [...events, event]).pipe(
          Effect.mapError((error) =>
            new EventSinkUnavailable({ message: String(error) }),
          ),
        )
        yield* writeFileStringAtomic(
          fs,
          path,
          paths.outboxFile,
          content,
        ).pipe(
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
