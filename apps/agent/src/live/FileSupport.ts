import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect } from "effect"

export const ensureParentDirectories = (
  fs: FileSystem,
  path: Path,
  targetPath: string,
) => fs.makeDirectory(path.dirname(targetPath), { recursive: true })

export const ensureAppDirectories = (paths: {
  readonly dataDir: string
  readonly jobsDir: string
  readonly outboxDir: string
  readonly tmpDir: string
  readonly runDir: string
}, fs: FileSystem) =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(paths.dataDir, { recursive: true })
    yield* fs.makeDirectory(paths.jobsDir, { recursive: true })
    yield* fs.makeDirectory(paths.outboxDir, { recursive: true })
    yield* fs.makeDirectory(paths.tmpDir, { recursive: true })
    yield* fs.makeDirectory(paths.runDir, { recursive: true })
  })

export const writeFileStringAtomic = (
  fs: FileSystem,
  path: Path,
  targetPath: string,
  content: string,
) =>
  Effect.gen(function* () {
    yield* ensureParentDirectories(fs, path, targetPath)
    const tempPath = `${targetPath}.tmp-${Date.now()}`
    yield* fs.writeFileString(tempPath, content)
    yield* fs.rename(tempPath, targetPath)
  })

export const writeFileAtomic = (
  fs: FileSystem,
  path: Path,
  targetPath: string,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    yield* ensureParentDirectories(fs, path, targetPath)
    const tempPath = `${targetPath}.tmp-${Date.now()}`
    yield* fs.writeFile(tempPath, bytes)
    yield* fs.rename(tempPath, targetPath)
  })
