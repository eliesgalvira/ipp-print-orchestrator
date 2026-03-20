import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const envFiles = ["/etc/ipp-print-orchestrator.env", resolve(process.cwd(), ".env")]

const stripMatchingQuotes = (value: string): string => {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

export const loadAppEnv = (): void => {
  const shellDefinedKeys = new Set(Object.keys(process.env))

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
      if (shellDefinedKeys.has(key)) {
        continue
      }

      const rawValue = trimmed.slice(separatorIndex + 1)
      process.env[key] = stripMatchingQuotes(rawValue)
    }
  }
}
