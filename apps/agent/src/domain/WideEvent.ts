import { Schema } from "effect"

export const WideEventName = Schema.Literals([
  "network.status.changed",
  "cups.status.changed",
  "printer.status.changed",
  "http.request.completed",
  "heartbeat",
])

export type WideEventName = typeof WideEventName.Type

export class WideEvent extends Schema.Class<WideEvent>("WideEvent")({
  timestamp: Schema.String,
  eventName: WideEventName,
  errorTag: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  route: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  clientAddress: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
  appUp: Schema.optional(Schema.Boolean),
  hostname: Schema.optional(Schema.String),
  observationReason: Schema.optional(Schema.String),
  networkOnline: Schema.optional(Schema.Boolean),
  previousNetworkOnline: Schema.optional(Schema.Boolean),
  localIps: Schema.optional(Schema.Array(Schema.String)),
  cupsReachable: Schema.optional(Schema.Boolean),
  previousCupsReachable: Schema.optional(Schema.Boolean),
  printerReady: Schema.optional(Schema.Boolean),
  previousPrinterReady: Schema.optional(Schema.Boolean),
  cupsQueueAvailable: Schema.optional(Schema.Boolean),
  previousCupsQueueAvailable: Schema.optional(Schema.Boolean),
  cupsQueueState: Schema.optional(
    Schema.NullOr(
      Schema.Literals(["idle", "processing", "stopped", "unknown"]),
    ),
  ),
  previousCupsQueueState: Schema.optional(
    Schema.NullOr(
      Schema.Literals(["idle", "processing", "stopped", "unknown"]),
    ),
  ),
  cupsQueueReasons: Schema.optional(Schema.Array(Schema.String)),
  previousCupsQueueReasons: Schema.optional(Schema.Array(Schema.String)),
  cupsQueueMessage: Schema.optional(Schema.NullOr(Schema.String)),
  previousCupsQueueMessage: Schema.optional(Schema.NullOr(Schema.String)),
  usbDeviceState: Schema.optional(
    Schema.Literals(["attached", "missing", "deauthorized"]),
  ),
  previousUsbDeviceState: Schema.optional(
    Schema.Literals(["attached", "missing", "deauthorized"]),
  ),
  usbDeviceStateSource: Schema.optional(
    Schema.Literals(["sysfs", "cups-inference"]),
  ),
  previousUsbDeviceStateSource: Schema.optional(
    Schema.Literals(["sysfs", "cups-inference"]),
  ),
  printerAttached: Schema.optional(Schema.Boolean),
  previousPrinterAttached: Schema.optional(Schema.Boolean),
  printerQueueAvailable: Schema.optional(Schema.Boolean),
  previousPrinterQueueAvailable: Schema.optional(Schema.Boolean),
  printerState: Schema.optional(Schema.NullOr(Schema.String)),
  previousPrinterState: Schema.optional(Schema.NullOr(Schema.String)),
  printerReasons: Schema.optional(Schema.Array(Schema.String)),
  previousPrinterReasons: Schema.optional(Schema.Array(Schema.String)),
  printerMessage: Schema.optional(Schema.NullOr(Schema.String)),
  previousPrinterMessage: Schema.optional(Schema.NullOr(Schema.String)),
  lastSuccessfulHeartbeatAt: Schema.optional(Schema.NullOr(Schema.String)),
}) {}
