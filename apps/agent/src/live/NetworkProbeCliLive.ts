import { Effect, Layer } from "effect"
import { networkInterfaces } from "node:os"

import { NetworkProbe } from "../services/NetworkProbe.js"

export const NetworkProbeCliLive = Layer.succeed(
  NetworkProbe,
  NetworkProbe.of({
    status: () =>
      Effect.sync(() => {
        const interfaces = networkInterfaces()
        const localIps = Object.values(interfaces)
          .flatMap((entries) => entries ?? [])
          .filter((entry) => !entry.internal)
          .map((entry) => entry.address)

        return {
          online: localIps.length > 0,
          localIps,
        }
      }),
  }),
)
