import { Layer } from "effect"
import { NodeCommandExecutor, NodeFileSystem, NodePath } from "@effect/platform-node"

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

const platformLayer = Layer.mergeAll(
  AppConfig.layer,
  NodeFileSystem.layer,
  NodePath.layer,
)

const commandLayer = NodeCommandExecutor.layer.pipe(
  Layer.provide(NodeFileSystem.layer),
)

const storageLayer = Layer.mergeAll(
  BlobStoreLive,
  JobRepoFileLive,
  EventSinkFileLive,
).pipe(Layer.provideMerge(platformLayer))

const cupsLayer = CupsClientCliLive.pipe(
  Layer.provideMerge(platformLayer),
  Layer.provideMerge(commandLayer),
)

const probeLayer = Layer.mergeAll(
  NetworkProbeCliLive,
  PrinterProbeCliLive.pipe(Layer.provideMerge(cupsLayer)),
)

const baseRuntimeLayer = Layer.mergeAll(
  platformLayer,
  storageLayer,
  cupsLayer,
  probeLayer,
  QueueRuntimeLive,
  TelemetryLive,
)

const orchestratorLayer = Orchestrator.layer.pipe(
  Layer.provideMerge(baseRuntimeLayer),
)

const reconcilerLayer = ReconcilerLive.pipe(Layer.provideMerge(baseRuntimeLayer))
const heartbeatLayer = HeartbeatLive.pipe(Layer.provideMerge(baseRuntimeLayer))

export const MainLayer = Layer.mergeAll(
  baseRuntimeLayer,
  orchestratorLayer,
  reconcilerLayer,
  heartbeatLayer,
)
