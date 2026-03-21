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
import { CupsClientCliLive } from "./CupsClientCliLive.js"
import { EventSinkFileLive } from "./EventSinkFileLive.js"
import { JobRepoFileLive } from "./JobRepoFileLive.js"
import { NetworkProbeCliLive } from "./NetworkProbeCliLive.js"
import { HeartbeatLive } from "./HeartbeatLive.js"
import { PrinterProbeCliLive } from "./PrinterProbeCliLive.js"
import { QueueRuntimeLive } from "./QueueRuntimeLive.js"
import { ReconcilerLive } from "./ReconcilerLive.js"
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
  PrinterProbeCliLive.pipe(Layer.provide(cupsObservationLayer)),
)

const runtimeSupportLayer = Layer.mergeAll(
  storageLayer,
  cupsLayer,
  cupsObservationLayer,
  probeLayer,
  TelemetryLive,
)

const eventLayer = WideEventPublisherLive.pipe(
  Layer.provide(runtimeSupportLayer),
)

const queueLayer = QueueRuntimeLive.pipe(Layer.provide(eventLayer))

const baseRuntimeLayer = Layer.mergeAll(
  configLayer,
  runtimeSupportLayer,
  eventLayer,
  queueLayer,
)

const orchestratorLayer = Orchestrator.layer.pipe(
  Layer.provide(baseRuntimeLayer),
)

const reconcilerLayer = ReconcilerLive.pipe(Layer.provide(baseRuntimeLayer))
const heartbeatLayer = HeartbeatLive.pipe(Layer.provide(baseRuntimeLayer))

export const MainLayer = Layer.mergeAll(
  baseRuntimeLayer,
  orchestratorLayer,
  reconcilerLayer,
  heartbeatLayer,
)
