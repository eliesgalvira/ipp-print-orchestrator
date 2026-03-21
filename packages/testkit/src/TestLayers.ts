import { Clock, Effect, Layer, Queue } from "effect"

import { AppConfig } from "../../../apps/agent/src/config/AppConfig.js"
import type { JobId } from "../../../apps/agent/src/domain/JobId.js"
import {
  makeQueueEvent,
  WideEventPublisher,
} from "../../../apps/agent/src/observability/WideEventPublisher.js"
import { Orchestrator } from "../../../apps/agent/src/services/Orchestrator.js"
import { QueueRuntime } from "../../../apps/agent/src/services/QueueRuntime.js"
import { WideEventPublisherLive } from "../../../apps/agent/src/live/WideEventPublisherLive.js"
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
    const wideEventPublisher = yield* WideEventPublisher

    const enqueue = Effect.fn("QueueRuntime.enqueue")(function* (jobId: JobId) {
      yield* Queue.offer(queue, jobId).pipe(Effect.asVoid)
      const queueDepth = yield* Queue.size(queue)
      const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString()
      yield* wideEventPublisher.emit(
        makeQueueEvent({
          timestamp,
          eventName: "queue.job.enqueued",
          printId: jobId,
          queueDepth,
        }),
      ).pipe(Effect.catch(() => Effect.void))
    })

    const take = Effect.fn("QueueRuntime.take")(function* () {
      const jobId = yield* Queue.take(queue)
      const queueDepth = yield* Queue.size(queue)
      const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString()
      yield* wideEventPublisher.emit(
        makeQueueEvent({
          timestamp,
          eventName: "queue.job.dequeued",
          printId: jobId,
          queueDepth,
        }),
      ).pipe(Effect.catch(() => Effect.void))
      return jobId
    })

    const size = Effect.fn("QueueRuntime.size")(function* () {
      return yield* Queue.size(queue)
    })

    return QueueRuntime.of({
      enqueue,
      take,
      size,
    })
  }),
)

export interface TestLayerOptions {
  readonly printer: readonly [PrinterProbeStep, ...readonly PrinterProbeStep[]]
  readonly cups: readonly [CupsSubmitStep, ...readonly CupsSubmitStep[]]
  readonly network?: readonly [NetworkProbeStep, ...readonly NetworkProbeStep[]]
  readonly failTelemetry?: boolean
}

export const makeTestLayer = (options: TestLayerOptions) => {
  const supportLayer = Layer.mergeAll(
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
    blobStoreLayer,
    jobRepoLayer,
    eventSinkLayer,
    options.failTelemetry === undefined
      ? telemetryLayer()
      : telemetryLayer({ failAlways: options.failTelemetry }),
    scriptedCupsClientLayer(options.cups),
    scriptedPrinterProbeLayer(options.printer),
    scriptedNetworkProbeLayer(
      options.network ?? [{ online: true, localIps: ["127.0.0.1"] }],
    ),
  )

  const eventLayer = WideEventPublisherLive.pipe(
    Layer.provideMerge(supportLayer),
  )

  const runtimeLayer = queueRuntimeLayer.pipe(
    Layer.provideMerge(eventLayer),
  )

  const baseLayer = Layer.mergeAll(
    supportLayer,
    eventLayer,
    runtimeLayer,
  )

  const orchestratorLayer = Orchestrator.layer.pipe(
    Layer.provideMerge(baseLayer),
  )

  return Layer.mergeAll(baseLayer, orchestratorLayer)
}
