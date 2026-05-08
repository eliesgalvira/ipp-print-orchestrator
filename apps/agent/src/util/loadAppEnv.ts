import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

const envRuntime = ManagedRuntime.make(
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
)

const defaultEnvFiles = Effect.gen(function* () {
  const path = yield* Path.Path
  return [
    "/etc/ipp-print-orchestrator.env",
    path.resolve(process.cwd(), ".env"),
  ] as const
})

const stripMatchingQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

const loadAppEnvFromFilesEffect = (
  envFiles: readonly string[],
  env: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const shellDefinedKeys = new Set(Object.keys(env))

    for (const envFile of envFiles) {
      const exists = yield* fs.exists(envFile)
      if (!exists) {
        continue
      }

      const contents = yield* fs.readFileString(envFile, "utf8")
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          continue
        }

        const separatorIndex = trimmed.indexOf("=")
        if (separatorIndex <= 0) {
          continue
        }

        const key = trimmed.slice(0, separatorIndex).trim()
        if (shellDefinedKeys.has(key) || env[key] !== undefined) {
          continue
        }

        const rawValue = trimmed.slice(separatorIndex + 1)
        env[key] = stripMatchingQuotes(rawValue)
      }
    }
  })

export const loadAppEnvFromFiles = (
  envFiles: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> =>
  envRuntime.runPromise(loadAppEnvFromFilesEffect(envFiles, env))

export const loadAppEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> =>
  envRuntime.runPromise(
    Effect.gen(function* () {
      const envFiles = yield* defaultEnvFiles
      yield* loadAppEnvFromFilesEffect(envFiles, env)
    }),
  )
