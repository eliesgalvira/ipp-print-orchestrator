import { NodeServices } from "@effect/platform-node"
import { NodeIppClientLive } from "@ipp/ipp"
import { Layer } from "effect"
import { AppConfig } from "../config/AppConfig.js"
import { CupsObserverIppLive } from "../cups-observation/CupsObserverIppLive.js"
import { CupsEventStreamIppLive } from "./CupsEventStreamIppLive.js"
import { HeartbeatLive } from "./HeartbeatLive.js"
import { NetworkProbeCliLive } from "./NetworkProbeCliLive.js"
import { PrinterProbeCliLive } from "./PrinterProbeCliLive.js"
import { StatusRuntimeLive } from "./StatusRuntimeLive.js"
import { TelemetryLive } from "./TelemetryLive.js"
import { WideEventPublisherLive } from "./WideEventPublisherLive.js"

const configLayer = AppConfig.layer
const nodeLayer = NodeServices.layer

const cupsObserverLayer = CupsObserverIppLive.pipe(
  Layer.provide(configLayer),
  Layer.provide(NodeIppClientLive),
)

const probeLayer = Layer.merge(
  NetworkProbeCliLive,
  PrinterProbeCliLive.pipe(
    Layer.provide(configLayer),
    Layer.provide(nodeLayer),
    Layer.provide(cupsObserverLayer),
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
)

export const MainLayer = Layer.mergeAll(
  configLayer,
  nodeLayer,
  cupsObserverLayer,
  probeLayer,
  eventLayer,
  statusLayer,
  heartbeatLayer,
  cupsEventStreamLayer,
)
