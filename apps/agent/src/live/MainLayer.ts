import { NodeServices } from "@effect/platform-node"
import { NodeIppClientLive } from "@ipp/ipp"
import { Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { CupsObserverIppLive } from "../cups-observation/CupsObserverIppLive.js"
import { Orchestrator } from "../services/Orchestrator.js"
import { BlobStoreLive } from "./BlobStoreLive.js"
import { CupsClientCliLive } from "./CupsClientCliLive.js"
import { CupsEventStreamIppLive } from "./CupsEventStreamIppLive.js"
import { EventSinkFileLive } from "./EventSinkFileLive.js"
import { HeartbeatLive } from "./HeartbeatLive.js"
import { JobRepoFileLive } from "./JobRepoFileLive.js"
import { NetworkProbeCliLive } from "./NetworkProbeCliLive.js"
import { PrinterProbeCliLive } from "./PrinterProbeCliLive.js"
import { QueueRuntimeLive } from "./QueueRuntimeLive.js"
import { ReconcilerLive } from "./ReconcilerLive.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"
import { TelemetryLive } from "./TelemetryLive.js"
import { WideEventPublisherLive } from "./WideEventPublisherLive.js"

const configLayer = AppConfig.layer

const nodeServicesLayer = NodeServices.layer

const fileSupportLayer = nodeServicesLayer

const storageSupportLayer = Layer.mergeAll(configLayer, fileSupportLayer)

const commandLayer = nodeServicesLayer

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
  Layer.provide(NodeIppClientLive),
)

const probeLayer = Layer.mergeAll(
  NetworkProbeCliLive,
  PrinterProbeCliLive.pipe(
    Layer.provide(configLayer),
    Layer.provide(fileSupportLayer),
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

const queueLayer = QueueRuntimeLive.pipe(Layer.provide(eventRuntimeLayer))

const queueRuntimeLayer = Layer.merge(eventRuntimeLayer, queueLayer)

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

const reconcilerLayer = ReconcilerLive.pipe(Layer.provide(queueRuntimeLayer))

const heartbeatLayer = HeartbeatLive.pipe(
  Layer.provide(statusAwareRuntimeLayer),
)

const cupsEventStreamLayer = CupsEventStreamIppLive.pipe(
  Layer.provide(Layer.merge(statusAwareRuntimeLayer, reconcilerLayer)),
  Layer.provide(NodeIppClientLive),
)

export const MainLayer = Layer.mergeAll(
  nodeServicesLayer,
  queueRuntimeLayer,
  statusRuntimeLayer,
  orchestratorLayer,
  reconcilerLayer,
  heartbeatLayer,
  cupsEventStreamLayer,
)
