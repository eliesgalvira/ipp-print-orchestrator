import { Schema } from "effect"

import {
  CupsJobAccountingAnomalies,
  CupsJobStates,
} from "../cups-observation/CupsJobObservation.js"
import { CupsQueueStates } from "../cups-observation/CupsQueueObservation.js"
import {
  UsbDeviceObservationSources,
  UsbDeviceStateNames,
} from "./PrinterReadiness.js"

const timestamp = { timestamp: Schema.String }
const hostObservation = {
  hostname: Schema.String,
  observationReason: Schema.String,
}
const cupsQueueState = Schema.NullOr(Schema.Literals(CupsQueueStates))
const usbDeviceState = Schema.Literals(UsbDeviceStateNames)
const usbDeviceStateSource = Schema.Literals(UsbDeviceObservationSources)
const readiness = {
  printerReady: Schema.Boolean,
  cupsReachable: Schema.Boolean,
  cupsQueueAvailable: Schema.Boolean,
  cupsQueueState,
  cupsQueueReasons: Schema.Array(Schema.String),
  cupsQueueMessage: Schema.NullOr(Schema.String),
  usbDeviceState,
  usbDeviceStateSource,
}
const previousReadiness = {
  previousPrinterReady: Schema.Boolean,
  previousCupsReachable: Schema.Boolean,
  previousCupsQueueAvailable: Schema.Boolean,
  previousCupsQueueState: cupsQueueState,
  previousCupsQueueReasons: Schema.Array(Schema.String),
  previousCupsQueueMessage: Schema.NullOr(Schema.String),
  previousUsbDeviceState: usbDeviceState,
  previousUsbDeviceStateSource: usbDeviceStateSource,
}
const jobObservation = {
  ...timestamp,
  ...hostObservation,
  cupsQueueName: Schema.String,
  cupsJobId: Schema.Number,
  cupsJobState: Schema.Literals(CupsJobStates),
  cupsJobStateReasons: Schema.Array(Schema.String),
  jobMediaSheetsCompleted: Schema.NullOr(Schema.Number),
  jobImpressionsCompleted: Schema.NullOr(Schema.Number),
}

const NetworkStatusChanged = Schema.Struct({
  eventName: Schema.Literal("network.status.changed"),
  ...timestamp,
  ...hostObservation,
  networkOnline: Schema.Boolean,
  previousNetworkOnline: Schema.Boolean,
  localIps: Schema.Array(Schema.String),
})

const CupsStatusChanged = Schema.Struct({
  eventName: Schema.Literal("cups.status.changed"),
  ...timestamp,
  ...hostObservation,
  ...readiness,
  previousCupsReachable: Schema.Boolean,
})

const PrinterStatusChanged = Schema.Struct({
  eventName: Schema.Literal("printer.status.changed"),
  ...timestamp,
  ...hostObservation,
  ...readiness,
  ...previousReadiness,
})

const HttpRequestCompleted = Schema.Struct({
  eventName: Schema.Literal("http.request.completed"),
  ...timestamp,
  route: Schema.String,
  method: Schema.String,
  statusCode: Schema.Number,
  durationMs: Schema.Number,
  clientAddress: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
  errorTag: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.String),
})

const Heartbeat = Schema.Struct({
  eventName: Schema.Literal("heartbeat"),
  ...timestamp,
  hostname: Schema.String,
  appUp: Schema.Boolean,
  networkOnline: Schema.Boolean,
  localIps: Schema.Array(Schema.String),
  ...readiness,
  lastSuccessfulHeartbeatAt: Schema.String,
})

const CupsJobObserved = Schema.Struct({
  eventName: Schema.Literal("cups.job.observed"),
  ...jobObservation,
})

const CupsJobAccountingAnomaly = Schema.Struct({
  eventName: Schema.Literal("cups.job.accounting.anomaly"),
  ...jobObservation,
  cupsJobAccountingAnomaly: Schema.Literals(CupsJobAccountingAnomalies),
})

export const WideEvent = Schema.Union([
  NetworkStatusChanged,
  CupsStatusChanged,
  PrinterStatusChanged,
  HttpRequestCompleted,
  Heartbeat,
  CupsJobObserved,
  CupsJobAccountingAnomaly,
]).pipe(Schema.toTaggedUnion("eventName"))

export type WideEvent = typeof WideEvent.Type
