// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import { spawnSync } from "node:child_process"
// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Cause, Effect, Schema } from "effect"

import {
  decideCupsCopiesGuard,
  decideSplOutputGuard,
  extractCupsJobAccounting,
  hasSplBlankPageSuppression,
} from "../domain/CupsFilterOutputGuard.js"
import {
  CupsCommandFailed,
  CupsTmpDirFull,
  OutputGuardRejected,
  PdfPreflightRejected,
  ValidationError,
} from "../domain/Errors.js"
import {
  decidePdfPreflight,
  type PdfInfoCommandResult,
} from "../domain/PdfPreflight.js"

export interface CupsFilterInvocation {
  readonly jobId: string
  readonly user: string
  readonly title: string
  readonly copies: string
  readonly options: string
  readonly filePath?: string
}

const pdfToPdfFilter =
  process.env.IPP_ORCH_CUPS_PDFTOPDF_FILTER ?? "/usr/lib/cups/filter/pdftopdf"
const ghostscriptRasterFilter =
  process.env.IPP_ORCH_CUPS_GSTORASTER_FILTER ??
  "/usr/lib/cups/filter/gstoraster"
const splRasterFilter =
  process.env.IPP_ORCH_CUPS_RASTERTOSPL_FILTER ??
  "/usr/lib/cups/filter/rastertospl"
const rawPdfContentType = "application/pdf"
const cupsPdfContentType = "application/vnd.cups-pdf"
const cupsRasterContentType = "application/vnd.cups-raster"
const enforcedPdfFilterOptions = [
  "print-scaling=none",
  "print-color-mode=monochrome",
  "sides=one-sided",
  "ColorModel=Gray",
  "PageSize=A4",
  "media=A4",
  "Quality=600dpi",
  "Resolution=300dpi",
  "JCLSkipBlankPages=True",
] as const
const defaultCupsSubfilterTimeoutMs = 285_000
const defaultCupsSubfilterStderrMaxBufferBytes = 8 * 1024 * 1024
const defaultCupsSplMaxBytesPerPage = 64 * 1024 * 1024
const defaultCupsSplMaxTotalBytes = 256 * 1024 * 1024
const defaultCupsTmpDirMinFreeBytes = 16 * 1024 * 1024
const privateTempFileMode = 0o600 // Owner read/write only for staged printer artifacts.
const pdfPreflightRejectedStateReason =
  "com.ipp-print-orchestrator-pdf-preflight-rejected"
const outputGuardRejectedStateReason =
  "com.ipp-print-orchestrator-output-guard-rejected"
const transientCupsStateReasons = [
  pdfPreflightRejectedStateReason,
  outputGuardRejectedStateReason,
] as const

const parsePositiveIntegerEnv = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (value === undefined) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const cupsSubfilterTimeoutMs = parsePositiveIntegerEnv(
  "IPP_ORCH_CUPS_SUBFILTER_TIMEOUT_MS",
  defaultCupsSubfilterTimeoutMs,
)
const cupsSubfilterStderrMaxBufferBytes = parsePositiveIntegerEnv(
  "IPP_ORCH_CUPS_SUBFILTER_STDERR_MAX_BUFFER_BYTES",
  defaultCupsSubfilterStderrMaxBufferBytes,
)
const cupsSplMaxBytesPerPage = parsePositiveIntegerEnv(
  "IPP_ORCH_CUPS_SPL_MAX_BYTES_PER_PAGE",
  defaultCupsSplMaxBytesPerPage,
)
const cupsSplMaxTotalBytes = parsePositiveIntegerEnv(
  "IPP_ORCH_CUPS_SPL_MAX_TOTAL_BYTES",
  defaultCupsSplMaxTotalBytes,
)
const tempDirPrefix = "ipp-cups-pdf-"
const defaultTempDirRetentionMs = 60 * 60 * 1000
const tempDirRetentionMs = Math.max(
  parsePositiveIntegerEnv(
    "IPP_ORCH_CUPS_TEMP_DIR_RETENTION_MS",
    defaultTempDirRetentionMs,
  ),
  cupsSubfilterTimeoutMs + 60_000,
)
const cupsTmpDirMinFreeBytes = parsePositiveIntegerEnv(
  "IPP_ORCH_CUPS_TMP_DIR_MIN_FREE_BYTES",
  defaultCupsTmpDirMinFreeBytes,
)

const bytesFromNumberOrBigInt = (value: number | bigint): number =>
  typeof value === "bigint" ? Number(value) : value

const formatBytesForDebug = (bytes: number): string =>
  `${Math.max(0, bytes)} bytes (${(Math.max(0, bytes) / (1024 * 1024)).toFixed(
    1,
  )} MiB)`

class TempDirCleanupFailed extends Schema.TaggedError<TempDirCleanupFailed>()(
  "TempDirCleanupFailed",
  {
    message: Schema.String,
  },
) {}

export const parseCupsFilterInvocation = (
  args: readonly string[],
): CupsFilterInvocation => {
  const [jobId, user, title, copies, options, filePath] = args

  if (
    jobId === undefined ||
    user === undefined ||
    title === undefined ||
    copies === undefined ||
    options === undefined
  ) {
    throw new ValidationError({
      message:
        "usage: ipp-pdf-preflight-to-spl job user title copies options [file]",
    })
  }

  return filePath === undefined
    ? { jobId, user, title, copies, options }
    : { jobId, user, title, copies, options, filePath }
}

const writeCupsStderr = (level: "ERROR" | "INFO" | "STATE", message: string) =>
  Effect.sync(() => {
    const lines = message.split(/\r?\n/)
    const linesToWrite =
      lines.length > 1 && lines[lines.length - 1] === ""
        ? lines.slice(0, -1)
        : lines

    for (const line of linesToWrite.length === 0 ? [""] : linesToWrite) {
      process.stderr.write(`${level}: ${line}\n`)
    }
  })

const clearTransientCupsStateReasons = () =>
  Effect.gen(function* () {
    for (const reason of transientCupsStateReasons) {
      yield* writeCupsStderr("STATE", `-${reason}`)
    }
  })

const setTransientCupsStateReason = (
  activeReason: (typeof transientCupsStateReasons)[number],
) =>
  Effect.gen(function* () {
    for (const reason of transientCupsStateReasons) {
      if (reason !== activeReason) {
        yield* writeCupsStderr("STATE", `-${reason}`)
      }
    }
    yield* writeCupsStderr("STATE", `+${activeReason}`)
  })

const safeOptionsFor = (options: string): string =>
  [...options.trim().split(/\s+/).filter(Boolean), ...enforcedPdfFilterOptions]
    .join(" ")
    .trim()

const cupsArgsFor = (
  invocation: CupsFilterInvocation,
  filePath: string,
): readonly string[] => [
  invocation.jobId,
  invocation.user,
  invocation.title,
  invocation.copies,
  safeOptionsFor(invocation.options),
  filePath,
]

const commandOutputToString = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8")
  }
  return ""
}

const readPdfInfoForCups = (filePath: string): PdfInfoCommandResult => {
  const result = spawnSync("pdfinfo", [filePath], {
    encoding: "utf8",
    env: {
      ...process.env,
      LC_ALL: "C",
    },
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  })
  const errorMessage = result.error?.message

  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: commandOutputToString(result.stdout),
    stderr: commandOutputToString(result.stderr),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

const validatePdfForCups = (filePath: string) =>
  Effect.gen(function* () {
    const commandResult = yield* Effect.try({
      try: () => readPdfInfoForCups(filePath),
      catch: (error) =>
        new CupsCommandFailed({
          message: `pdfinfo failed to execute: ${String(error)}`,
        }),
    })
    const decision = decidePdfPreflight(commandResult)

    if (decision._tag === "Rejected") {
      return yield* new PdfPreflightRejected({
        reason: decision.reason,
        message: decision.message,
        ...(decision.details !== undefined
          ? { details: decision.details }
          : {}),
      })
    }

    return {
      filePath,
      summary: decision.summary,
    }
  })

const runCupsFilter = (params: {
  readonly label: string
  readonly command: string
  readonly args: readonly string[]
  readonly inputContentType: string
  readonly output: { readonly _tag: "File"; readonly path: string }
}) =>
  Effect.try({
    try: () => {
      const stdout = openSync(params.output.path, "w", privateTempFileMode)

      try {
        const result = spawnSync(params.command, params.args, {
          env: {
            ...process.env,
            CONTENT_TYPE: params.inputContentType,
          },
          maxBuffer: cupsSubfilterStderrMaxBufferBytes,
          timeout: cupsSubfilterTimeoutMs,
          stdio: ["ignore", stdout, "pipe"],
        })
        const stderr = commandOutputToString(result.stderr)

        if (result.error !== undefined) {
          throw result.error
        }

        if (result.status !== 0) {
          throw new Error(
            `${params.label} exited with status ${result.status ?? "unknown"}`,
          )
        }

        return { stderr }
      } finally {
        if (typeof stdout === "number") {
          closeSync(stdout)
        }
      }
    },
    catch: (error) =>
      new CupsCommandFailed({
        message: `${params.label} failed: ${String(error)}`,
      }),
  })

const copyStdinToFile = (targetPath: string) =>
  Effect.tryPromise({
    try: () => pipeline(process.stdin, createWriteStream(targetPath)),
    catch: (error) =>
      new CupsCommandFailed({
        message: `failed to copy CUPS stdin to temp file: ${String(error)}`,
      }),
  })

const copyFileToStdout = (sourcePath: string) =>
  Effect.tryPromise({
    try: () => pipeline(createReadStream(sourcePath), process.stdout),
    catch: (error) =>
      new CupsCommandFailed({
        message: `failed to copy guarded printer output to CUPS stdout: ${String(error)}`,
      }),
  })

const readFileSize = (filePath: string) =>
  Effect.try({
    try: () => statSync(filePath).size,
    catch: (error) =>
      new CupsCommandFailed({
        message: `failed to stat guarded printer output ${filePath}: ${String(error)}`,
      }),
  })

const readFilePrefix = (filePath: string, bytes: number) =>
  Effect.try({
    try: () => {
      const fd = openSync(filePath, "r")
      try {
        const buffer = Buffer.alloc(bytes)
        const bytesRead = readSync(fd, buffer, 0, bytes, 0)
        return buffer.subarray(0, bytesRead).toString("latin1")
      } finally {
        closeSync(fd)
      }
    },
    catch: (error) =>
      new CupsCommandFailed({
        message: `failed to read guarded printer output header ${filePath}: ${String(error)}`,
      }),
  })

const validateSplBlankPageSuppression = (filePath: string, splBytes: number) =>
  Effect.gen(function* () {
    const header = yield* readFilePrefix(filePath, Math.min(splBytes, 4096))

    if (!hasSplBlankPageSuppression(header)) {
      return yield* new OutputGuardRejected({
        reason: "unsafe-printer-language",
        message:
          "Final printer output did not enable blank-page/form-feed suppression",
        actualBytes: splBytes,
      })
    }
  })

const validateSingleCopyForCups = (invocation: CupsFilterInvocation) =>
  Effect.gen(function* () {
    const guardDecision = decideCupsCopiesGuard(invocation.copies)

    if (guardDecision._tag === "Rejected") {
      return yield* new OutputGuardRejected({
        reason: guardDecision.reason,
        message: guardDecision.message,
        actualBytes: 0,
      })
    }
  })

const cleanupStaleTempDirs = (tempRoot: string) =>
  Effect.sync(() => {
    const now = Date.now()
    let entries: ReadonlyArray<{
      readonly isDirectory: () => boolean
      readonly name: string
    }>

    try {
      entries = readdirSync(tempRoot, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(tempDirPrefix)) {
        continue
      }

      const tempPath = join(tempRoot, entry.name)
      try {
        const ageMs = now - statSync(tempPath).mtimeMs
        if (ageMs > tempDirRetentionMs) {
          rmSync(tempPath, { force: true, recursive: true })
        }
      } catch {}
    }
  })

const getTmpDirAvailableBytes = (tempRoot: string): number => {
  const stats = statfsSync(tempRoot)
  const availableBlocks = stats.bavail ?? stats.bfree
  return (
    bytesFromNumberOrBigInt(stats.bsize) *
    bytesFromNumberOrBigInt(availableBlocks)
  )
}

const ensureTmpDirCapacity = (tempRoot: string) =>
  Effect.gen(function* () {
    const availableBytes = yield* Effect.try({
      try: () => getTmpDirAvailableBytes(tempRoot),
      catch: (error) =>
        new CupsCommandFailed({
          message: `failed to read temporary-directory stats for ${tempRoot}: ${String(error)}`,
        }),
    })

    if (availableBytes >= cupsTmpDirMinFreeBytes) {
      return
    }

    return yield* new CupsTmpDirFull({
      message: `Insufficient temporary space at ${tempRoot}: available ${formatBytesForDebug(availableBytes)}, minimum ${formatBytesForDebug(cupsTmpDirMinFreeBytes)} required before running preflight filters`,
    })
  })

const removeTempDir = (directory: string) =>
  Effect.try({
    try: () => rmSync(directory, { force: true, recursive: true }),
    catch: (error) =>
      new TempDirCleanupFailed({
        message: `failed to remove temp dir ${directory}: ${String(error)}`,
      }),
  }).pipe(Effect.catch(() => Effect.void))

const withTempDir = <A, E, R>(
  use: (directory: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const tempRoot = tmpdir()
      yield* cleanupStaleTempDirs(tempRoot)
      yield* ensureTmpDirCapacity(tempRoot)

      return yield* Effect.try({
        try: () => mkdtempSync(join(tempRoot, tempDirPrefix)),
        catch: (error) =>
          new CupsCommandFailed({
            message: `failed to allocate preflight temp directory: ${String(error)}`,
          }),
      })
    }),
    removeTempDir,
  ).pipe(Effect.flatMap(use), Effect.scoped)

const prepareInputFile = (
  invocation: CupsFilterInvocation,
  tempDirectory: string,
) =>
  Effect.gen(function* () {
    if (invocation.filePath !== undefined) {
      return invocation.filePath
    }

    const inputPath = join(tempDirectory, "input.pdf")
    yield* copyStdinToFile(inputPath)
    return inputPath
  })

const renderPipeline = (
  invocation: CupsFilterInvocation,
  inputPath: string,
  tempDirectory: string,
  pdfPages: number,
) =>
  Effect.gen(function* () {
    const normalizedPdfPath = join(tempDirectory, "normalized.pdf")
    const cupsRasterPath = join(tempDirectory, "document.cups-raster")
    const splPath = join(tempDirectory, "document.spl")

    yield* runCupsFilter({
      label: "pdftopdf",
      command: pdfToPdfFilter,
      args: cupsArgsFor(invocation, inputPath),
      inputContentType: rawPdfContentType,
      output: { _tag: "File", path: normalizedPdfPath },
    })
    yield* runCupsFilter({
      label: "gstoraster",
      command: ghostscriptRasterFilter,
      args: cupsArgsFor(invocation, normalizedPdfPath),
      inputContentType: cupsPdfContentType,
      output: { _tag: "File", path: cupsRasterPath },
    })
    const rasterToSpl = yield* runCupsFilter({
      label: "rastertospl",
      command: splRasterFilter,
      args: cupsArgsFor(invocation, cupsRasterPath),
      inputContentType: cupsRasterContentType,
      output: { _tag: "File", path: splPath },
    })
    const splBytes = yield* readFileSize(splPath)
    const guardDecision = decideSplOutputGuard({
      pdfPages,
      copies: invocation.copies,
      splBytes,
      filterStderr: rasterToSpl.stderr,
      maxBytesPerPage: cupsSplMaxBytesPerPage,
      maxTotalBytes: cupsSplMaxTotalBytes,
    })

    if (guardDecision._tag === "Rejected") {
      return yield* new OutputGuardRejected({
        reason: guardDecision.reason,
        message: guardDecision.message,
        actualBytes: splBytes,
        ...(guardDecision.expectedPages !== undefined
          ? { expectedPages: guardDecision.expectedPages }
          : {}),
        ...(guardDecision.observedPages !== undefined
          ? { observedPages: guardDecision.observedPages }
          : {}),
        ...(guardDecision.maxBytes !== undefined
          ? { maxBytes: guardDecision.maxBytes }
          : {}),
      })
    }

    yield* validateSplBlankPageSuppression(splPath, splBytes)

    yield* copyFileToStdout(splPath)
    yield* Effect.sync(() => {
      process.stderr.write(extractCupsJobAccounting(rasterToSpl.stderr))
    })
    yield* writeCupsStderr(
      "INFO",
      `Guarded printer output accepted job ${invocation.jobId}: pages=${guardDecision.observedPages} bytes=${splBytes} maxBytes=${guardDecision.maxBytes}`,
    )
  })

const program = Effect.gen(function* () {
  const invocation = yield* Effect.try({
    try: () => parseCupsFilterInvocation(process.argv.slice(2)),
    catch: (error) =>
      Schema.is(ValidationError)(error)
        ? error
        : new ValidationError({ message: String(error) }),
  })
  yield* clearTransientCupsStateReasons()

  return yield* withTempDir((tempDirectory) =>
    Effect.gen(function* () {
      const inputPath = yield* prepareInputFile(invocation, tempDirectory)
      const report = yield* validatePdfForCups(inputPath)
      yield* validateSingleCopyForCups(invocation)

      yield* writeCupsStderr(
        "INFO",
        `PDF preflight accepted job ${invocation.jobId}: pages=${report.summary.pages}`,
      )
      yield* renderPipeline(
        invocation,
        inputPath,
        tempDirectory,
        report.summary.pages,
      )
    }),
  )
})

const reportFailure = (
  error:
    | CupsCommandFailed
    | OutputGuardRejected
    | PdfPreflightRejected
    | CupsTmpDirFull
    | ValidationError,
) =>
  Effect.gen(function* () {
    if (error._tag === "PdfPreflightRejected") {
      yield* setTransientCupsStateReason(pdfPreflightRejectedStateReason)
      yield* writeCupsStderr(
        "ERROR",
        `PDF preflight rejected job: ${error.reason}: ${error.message}`,
      )
      if (error.details !== undefined) {
        yield* writeCupsStderr("ERROR", error.details)
      }
    } else if (error._tag === "OutputGuardRejected") {
      yield* setTransientCupsStateReason(outputGuardRejectedStateReason)
      yield* writeCupsStderr(
        "ERROR",
        `Printer output guard rejected job: ${error.reason}: ${error.message}`,
      )
    } else {
      yield* writeCupsStderr("ERROR", `${error._tag}: ${error.message}`)
    }

    process.exitCode = 1
  })

const reportUnexpectedFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    yield* writeCupsStderr(
      "ERROR",
      `Unexpected CUPS filter failure: ${Cause.pretty(cause)}`,
    )
    process.exitCode = 1
  })

const main = program.pipe(
  Effect.catchTags({
    CupsCommandFailed: reportFailure,
    CupsTmpDirFull: reportFailure,
    OutputGuardRejected: reportFailure,
    PdfPreflightRejected: reportFailure,
    ValidationError: reportFailure,
  }),
  Effect.catchCause(reportUnexpectedFailure),
)

await Effect.runPromise(main)
