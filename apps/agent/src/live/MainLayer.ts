import { Layer } from "effect"
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
} from "@effect/platform-node"

import { CupsObserverIppLive } from "../cups-observation/CupsObserverIppLive.js"
import { AppConfig } from "../config/AppConfig.js"
import { Orchestrator } from "../services/Orchestrator.js"
import { BlobStoreLive } from "./BlobStoreLive.js"
import { CupsEventStreamIppLive } from "./CupsEventStreamIppLive.js"
import { CupsClientCliLive } from "./CupsClientCliLive.js"
import { EventSinkFileLive } from "./EventSinkFileLive.js"
import { JobRepoFileLive } from "./JobRepoFileLive.js"
import { NetworkProbeCliLive } from "./NetworkProbeCliLive.js"
import { HeartbeatLive } from "./HeartbeatLive.js"
import { PrinterProbeCliLive } from "./PrinterProbeCliLive.js"
import { QueueRuntimeLive } from "./QueueRuntimeLive.js"
import { ReconcilerLive } from "./ReconcilerLive.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"
import { TelemetryLive } from "./TelemetryLive.js"
import { WideEventPublisherLive } from "./WideEventPublisherLive.js"

const configLayer = AppConfig.layer

const fileSupportLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
)

const storageSupportLayer = Layer.mergeAll(
  configLayer,
  fileSupportLayer,
)

const commandLayer = NodeChildProcessSpawner.layer

const storageLayer = Layer.mergeAll(
  BlobStoreLive,
  JobRepoFileLive,
  EventSinkFileLive,
).pipe(Layer.provide(storageSupportLayer))

const cupsLayer = CupsClientCliLive.pipe(
  Layer.provide(storageSupportLayer),
  Layer.provide(commandLayer),
)

const cupsObservationLayer = CupsObserverIppLive.pipe(
  Layer.provide(configLayer),
)

const probeLayer = Layer.mergeAll(
  NetworkProbeCliLive,
  PrinterProbeCliLive.pipe(
    Layer.provide(cupsObservationLayer),
    Layer.provide(cupsLayer),
  ),
)

const runtimeSupportLayer = Layer.mergeAll(
  storageLayer,
  commandLayer,
  cupsLayer,
  cupsObservationLayer,
  probeLayer,
  TelemetryLive,
)

const eventLayer = WideEventPublisherLive.pipe(
  Layer.provide(runtimeSupportLayer),
)

const eventRuntimeLayer = Layer.mergeAll(
  configLayer,
  runtimeSupportLayer,
  eventLayer,
)

const queueLayer = QueueRuntimeLive.pipe(
  Layer.provide(eventRuntimeLayer),
)

const queueRuntimeLayer = Layer.merge(
  eventRuntimeLayer,
  queueLayer,
)

const statusRuntimeLayer = StatusRuntimeLive.pipe(
  Layer.provide(queueRuntimeLayer),
)

const statusAwareRuntimeLayer = Layer.merge(
  queueRuntimeLayer,
  statusRuntimeLayer,
)

const orchestratorLayer = Orchestrator.layer.pipe(
  Layer.provide(queueRuntimeLayer),
)

const reconcilerLayer = ReconcilerLive.pipe(
  Layer.provide(queueRuntimeLayer),
)

const heartbeatLayer = HeartbeatLive.pipe(
  Layer.provide(statusAwareRuntimeLayer),
)

const cupsEventStreamLayer = CupsEventStreamIppLive.pipe(
  Layer.provide(
    Layer.merge(
      statusAwareRuntimeLayer,
      reconcilerLayer,
    ),
  ),
)

export const MainLayer = Layer.mergeAll(
  queueRuntimeLayer,
  statusRuntimeLayer,
  orchestratorLayer,
  reconcilerLayer,
  heartbeatLayer,
  cupsEventStreamLayer,
)
