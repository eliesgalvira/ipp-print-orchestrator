// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import { spawnSync } from "node:child_process"
// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import {
  closeSync,
  createWriteStream,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
// @effect-diagnostics-next-line effect/nodeBuiltinImport:off
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Effect, Schema } from "effect"

import {
  CupsCommandFailed,
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
const defaultCupsSubfilterTimeoutMs = 285_000

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
    process.stderr.write(`${level}: ${message}\n`)
  })

const cupsArgsFor = (
  invocation: CupsFilterInvocation,
  filePath: string,
): readonly string[] => [
  invocation.jobId,
  invocation.user,
  invocation.title,
  invocation.copies,
  invocation.options,
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

const runCupsFilter = (
  params: {
    readonly label: string
    readonly command: string
    readonly args: readonly string[]
    readonly inputContentType: string
    readonly output:
      | { readonly _tag: "File"; readonly path: string }
      | { readonly _tag: "Stdout" }
  },
) =>
  Effect.try({
    try: () => {
      const stdout =
        params.output._tag === "Stdout"
          ? "inherit"
          : openSync(params.output.path, "w", 0o600)

      try {
        const result = spawnSync(params.command, params.args, {
          env: {
            ...process.env,
            CONTENT_TYPE: params.inputContentType,
          },
          timeout: cupsSubfilterTimeoutMs,
          stdio: ["ignore", stdout, "pipe"],
        })
        const stderr = commandOutputToString(result.stderr)

        if (stderr.length > 0) {
          process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`)
        }

        if (result.error !== undefined) {
          throw result.error
        }

        if (result.status !== 0) {
          throw new Error(
            `${params.label} exited with status ${result.status ?? "unknown"}`,
          )
        }
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

const withTempDir = <A, E, R>(
  use: (directory: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "ipp-cups-pdf-"))),
    (directory) =>
      Effect.sync(() => rmSync(directory, { force: true, recursive: true })),
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
) =>
  Effect.gen(function* () {
    const normalizedPdfPath = join(tempDirectory, "normalized.pdf")
    const cupsRasterPath = join(tempDirectory, "document.cups-raster")

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
    yield* runCupsFilter({
      label: "rastertospl",
      command: splRasterFilter,
      args: cupsArgsFor(invocation, cupsRasterPath),
      inputContentType: cupsRasterContentType,
      output: { _tag: "Stdout" },
    })
  })

const program = Effect.gen(function* () {
  const invocation = yield* Effect.try({
    try: () => parseCupsFilterInvocation(process.argv.slice(2)),
    catch: (error) =>
      Schema.is(ValidationError)(error)
        ? error
        : new ValidationError({ message: String(error) }),
  })

  return yield* withTempDir((tempDirectory) =>
    Effect.gen(function* () {
      const inputPath = yield* prepareInputFile(invocation, tempDirectory)
      const report = yield* validatePdfForCups(inputPath)

      yield* writeCupsStderr(
        "INFO",
        `PDF preflight accepted job ${invocation.jobId}: pages=${report.summary.pages}`,
      )
      yield* renderPipeline(invocation, inputPath, tempDirectory)
    }),
  )
})

const reportFailure = (
  error: CupsCommandFailed | PdfPreflightRejected | ValidationError,
) =>
  Effect.gen(function* () {
    if (error._tag === "PdfPreflightRejected") {
      yield* writeCupsStderr(
        "STATE",
        "+com.ipp-print-orchestrator-pdf-preflight-rejected",
      )
      yield* writeCupsStderr(
        "ERROR",
        `PDF preflight rejected job: ${error.reason}: ${error.message}`,
      )
      if (error.details !== undefined) {
        yield* writeCupsStderr("ERROR", error.details)
      }
    } else {
      yield* writeCupsStderr("ERROR", `${error._tag}: ${error.message}`)
    }

    process.exitCode = 1
  })

const main = program.pipe(
  Effect.catchTags({
    CupsCommandFailed: reportFailure,
    PdfPreflightRejected: reportFailure,
    ValidationError: reportFailure,
  }),
)

await Effect.runPromise(main)
