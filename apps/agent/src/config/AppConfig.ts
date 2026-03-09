import { Context } from "effect"

export interface AppConfigShape {
  readonly dataDir: string
  readonly printerName: string
  readonly bindHost: string
  readonly bindPort: number
  readonly heartbeatIntervalMs: number
  readonly reconcileIntervalMs: number
  readonly logPretty: boolean
  readonly enableOtlp: boolean
}

export class AppConfig extends Context.Tag("@ipp/agent/AppConfig")<
  AppConfig,
  AppConfigShape
>() {}
