import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "@effect/vitest"

import { loadAppEnv, loadAppEnvFromFiles } from "./loadAppEnv.js"

const withCwd = (cwd: string, run: () => void) => {
  const previousCwd = process.cwd()
  process.chdir(cwd)
  try {
    run()
  } finally {
    process.chdir(previousCwd)
  }
}

const withEnv = (key: string, value: string | undefined, run: () => void) => {
  const previousValue = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }

  try {
    run()
  } finally {
    if (previousValue === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previousValue
    }
  }
}

describe("loadAppEnv", () => {
  it("keeps values from earlier env files when later files define the same key", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ipp-env-"))
    try {
      const systemEnv = join(tempDir, "system.env")
      const repoEnv = join(tempDir, ".env")
      writeFileSync(systemEnv, "IPP_ORCH_PRINTER_NAME=HP135a\n")
      writeFileSync(repoEnv, "IPP_ORCH_PRINTER_NAME=printer\n")

      const env: NodeJS.ProcessEnv = {}
      loadAppEnvFromFiles([systemEnv, repoEnv], env)

      expect(env.IPP_ORCH_PRINTER_NAME).toBe("HP135a")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("does not let repo .env override shell-defined values", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ipp-env-"))
    try {
      writeFileSync(join(tempDir, ".env"), "IPP_ORCH_PRINTER_NAME=from-dotenv\n")

      withCwd(tempDir, () =>
        withEnv("IPP_ORCH_PRINTER_NAME", "from-shell", () => {
          loadAppEnv()
          expect(process.env.IPP_ORCH_PRINTER_NAME).toBe("from-shell")
        }),
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
