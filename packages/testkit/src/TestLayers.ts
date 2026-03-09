import { Effect, Layer, Queue } from "effect"

import { AppConfig } from "../../../apps/agent/src/config/AppConfig.js"
import type { JobId } from "../../../apps/agent/src/domain/JobId.js"
import { Orchestrator } from "../../../apps/agent/src/services/Orchestrator.js"
import { QueueRuntime } from "../../../apps/agent/src/services/QueueRuntime.js"
import { layer as blobStoreLayer } from "./InMemoryBlobStore.js"
import { layer as eventSinkLayer } from "./InMemoryEventSink.js"
import { layer as jobRepoLayer } from "./InMemoryJobRepo.js"
import {
  layer as scriptedCupsClientLayer,
  type CupsSubmitStep,
} from "./ScriptedCupsClient.js"
import {
  layer as scriptedNetworkProbeLayer,
  type NetworkProbeStep,
} from "./ScriptedNetworkProbe.js"
import {
  layer as scriptedPrinterProbeLayer,
  type PrinterProbeStep,
} from "./ScriptedPrinterProbe.js"
import { layer as telemetryLayer } from "./TestTelemetry.js"

const queueRuntimeLayer = Layer.effect(
  QueueRuntime,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<JobId>()

    return QueueRuntime.of({
      enqueue: (jobId) => Queue.offer(queue, jobId).pipe(Effect.asVoid),
      take: () => Queue.take(queue),
      size: () => Queue.size(queue),
    })
  }),
)

export interface TestLayerOptions {
  readonly printer: readonly [PrinterProbeStep, ...readonly PrinterProbeStep[]]
  readonly cups: readonly [CupsSubmitStep, ...readonly CupsSubmitStep[]]
  readonly network?: readonly [NetworkProbeStep, ...readonly NetworkProbeStep[]]
  readonly failTelemetry?: boolean
}

export const makeTestLayer = (options: TestLayerOptions) =>
  Orchestrator.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(AppConfig, {
        dataDir: "./data-test",
        printerName: "test-printer",
        bindHost: "127.0.0.1",
        bindPort: 4310,
        heartbeatIntervalMs: 60_000,
        reconcileIntervalMs: 1_000,
        logPretty: false,
        enableOtlp: false,
      }),
    ),
    Layer.provideMerge(blobStoreLayer),
    Layer.provideMerge(jobRepoLayer),
    Layer.provideMerge(eventSinkLayer),
    Layer.provideMerge(
      options.failTelemetry === undefined
        ? telemetryLayer()
        : telemetryLayer({ failAlways: options.failTelemetry }),
    ),
    Layer.provideMerge(scriptedCupsClientLayer(options.cups)),
    Layer.provideMerge(scriptedPrinterProbeLayer(options.printer)),
    Layer.provideMerge(
      scriptedNetworkProbeLayer(
        options.network ?? [{ online: true, localIps: ["127.0.0.1"] }],
      ),
    ),
    Layer.provideMerge(queueRuntimeLayer),
  )
