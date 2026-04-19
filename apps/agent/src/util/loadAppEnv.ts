import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const defaultEnvFiles = () => [
  "/etc/ipp-print-orchestrator.env",
  resolve(process.cwd(), ".env"),
]

const stripMatchingQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

export const loadAppEnvFromFiles = (
  envFiles: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const shellDefinedKeys = new Set(Object.keys(env))

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue
    }

    const contents = readFileSync(envFile, "utf8")
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
}

export const loadAppEnv = (): void => {
  loadAppEnvFromFiles(defaultEnvFiles())
}
