import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import type { WideEvent } from "../domain/WideEvent.js"
import { WideEventPublisher } from "../observability/WideEventPublisher.js"
import { NetworkProbe } from "../services/NetworkProbe.js"
import { PrinterProbe } from "../services/PrinterProbe.js"
import { StatusRuntime } from "../services/StatusRuntime.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"

describe("StatusRuntimeLive", () => {
  it.effect("does not invent prior values from partial observations", () => {
    const emitted: WideEvent[] = []
    const supportLayer = Layer.mergeAll(
      Layer.succeed(
        NetworkProbe,
        NetworkProbe.of({
          status: () => Effect.succeed({ online: true, localIps: [] }),
        }),
      ),
      Layer.succeed(
        PrinterProbe,
        PrinterProbe.of({
          status: () =>
            Effect.succeed({
              attached: true,
              queueAvailable: true,
              cupsReachable: true,
              state: "idle",
              reasons: [],
              message: null,
            }),
        }),
      ),
      Layer.succeed(
        WideEventPublisher,
        WideEventPublisher.of({
          emit: (event) => Effect.sync(() => void emitted.push(event)),
        }),
      ),
    )

    return Effect.gen(function* () {
      const runtime = yield* StatusRuntime

      yield* runtime.recordObservedStatus({
        timestamp: "2026-08-19T10:00:00.000Z",
        hostname: "test-host",
        observationReason: "cups-stream-disconnect",
        cupsReachable: false,
      })
      yield* runtime.recordObservedStatus({
        timestamp: "2026-08-19T10:00:01.000Z",
        hostname: "test-host",
        observationReason: "network-change",
        networkOnline: true,
      })

      expect(emitted).toEqual([])
    }).pipe(Effect.provide(StatusRuntimeLive.pipe(Layer.provide(supportLayer))))
  })
})
