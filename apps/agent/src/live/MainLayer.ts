import { NodeServices } from "@effect/platform-node"
import { NodeIppClientLive } from "@ipp/ipp"
import { Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { CupsQueueObserverIppLive } from "../cups-observation/CupsQueueObserverIppLive.js"
import { CupsEventStreamIppLive } from "./CupsEventStreamIppLive.js"
import { HeartbeatLive } from "./HeartbeatLive.js"
import { NetworkProbeCliLive } from "./NetworkProbeCliLive.js"
import { PrinterReadinessProbeLive } from "./PrinterReadinessProbeLive.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"
import { TelemetryLive } from "./TelemetryLive.js"
import { WideEventPublisherLive } from "./WideEventPublisherLive.js"

const configLayer = AppConfig.layer
const nodeLayer = NodeServices.layer

const cupsQueueObserverLayer = CupsQueueObserverIppLive.pipe(
  Layer.provide(configLayer),
  Layer.provide(NodeIppClientLive),
)

const probeLayer = Layer.merge(
  NetworkProbeCliLive,
  PrinterReadinessProbeLive.pipe(
    Layer.provide(configLayer),
    Layer.provide(nodeLayer),
    Layer.provide(cupsQueueObserverLayer),
  ),
)

const eventLayer = WideEventPublisherLive.pipe(Layer.provide(TelemetryLive))

const statusLayer = StatusRuntimeLive.pipe(
  Layer.provide(probeLayer),
  Layer.provide(eventLayer),
)

const heartbeatLayer = HeartbeatLive.pipe(
  Layer.provide(statusLayer),
  Layer.provide(eventLayer),
)

const cupsEventStreamLayer = CupsEventStreamIppLive.pipe(
  Layer.provide(configLayer),
  Layer.provide(NodeIppClientLive),
  Layer.provide(statusLayer),
  Layer.provide(eventLayer),
)

export const MainLayer = Layer.mergeAll(
  configLayer,
  nodeLayer,
  cupsQueueObserverLayer,
  probeLayer,
  eventLayer,
  statusLayer,
  heartbeatLayer,
  cupsEventStreamLayer,
)
