import * as FileSystem from "effect/FileSystem"
import { Effect, Layer } from "effect"
import * as Path from "effect/Path"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import { AppConfig } from "../config/AppConfig.js"
import {
  CupsCommandFailed,
  CupsRejectedJob,
  CupsUnavailable,
  SubmissionUncertainError,
} from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import {
  CupsClient,
  type CupsJobSummary,
  type PrinterSummary,
} from "../services/CupsClient.js"
import { makeAppPaths } from "../util/Paths.js"
import { ensureAppDirectories, writeFileAtomic } from "./FileSupport.js"

export const parseLpSubmitOutput = (output: string): string => {
  const match = output.match(/request id is [^-]+-(\d+)/i)
  if (match?.[1] === undefined) {
    throw new Error(`Unable to parse lp output: ${output}`)
  }
  return match[1]
}

export const parseLpstatJobsOutput = (output: string): readonly CupsJobSummary[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [title] = line.split(/\s+/, 1)
      const idMatch = title?.match(/-(\d+)$/)
      if (title === undefined || idMatch?.[1] === undefined) {
        throw new Error(`Unable to parse lpstat jobs line: ${line}`)
      }
      return {
        cupsJobId: idMatch[1],
        state: "queued",
        title,
      } satisfies CupsJobSummary
    })

export const parseLpstatPrinterOutput = (output: string): PrinterSummary => {
  const normalized = output.trim()
  const match = normalized.match(/^printer\s+(\S+)\s+(is|now)\s+(.+)$/i)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Unable to parse lpstat printer output: ${output}`)
  }

  const verb = match[2].toLowerCase()
  const rawStatus = match[3]
  const status =
    verb === "now"
      ? "printing"
      : rawStatus.split(".")[0] ?? rawStatus

  return {
    printerName: match[1],
    available: !normalized.includes("disabled"),
    status,
  }
}

export const parseLpstatDeviceOutput = (
  output: string,
): { readonly printerName: string; readonly deviceUri: string } => {
  const normalized = output.trim()
  const match = normalized.match(/^device\s+for\s+(\S+):\s+(.+)$/i)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Unable to parse lpstat device output: ${output}`)
  }

  return {
    printerName: match[1],
    deviceUri: match[2].trim(),
  }
}

export const parseLpinfoDevicesOutput = (output: string): readonly string[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [, deviceUri] = line.split(/\s+/, 3)
      return deviceUri === undefined ? [] : [deviceUri]
    })

const mapCommandFailure = (error: unknown) =>
  new CupsCommandFailed({ message: String(error) })

export const CupsClientCliLive = Layer.effect(
  CupsClient,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const childProcessSpawner = yield* ChildProcessSpawner
    const appConfig = yield* AppConfig
    const paths = yield* makeAppPaths

    yield* ensureAppDirectories(paths, fs).pipe(
      Effect.mapError((error) =>
        new CupsUnavailable({ message: String(error) }),
      ),
    )

    const runString = (command: ChildProcess.Command) =>
      childProcessSpawner.string(command)

    const submitFile = Effect.fn("CupsClient.submitFile")(function* (
      job: Job,
      bytes: Uint8Array,
    ) {
      yield* Effect.annotateCurrentSpan({
        "cups.file_name": job.fileName,
        "cups.job_id": String(job.id),
        "cups.printer_name": job.printerName,
      })

        const tempPath = path.join(paths.tmpDir, `${String(job.id)}-${job.fileName}`)
        yield* writeFileAtomic(fs, path, tempPath, bytes).pipe(
          Effect.mapError((error) =>
            new CupsCommandFailed({ message: String(error) }),
          ),
        )

        const output = yield* runString(
          ChildProcess.make("lp", ["-d", job.printerName, tempPath]),
        ).pipe(
          Effect.mapError((error) =>
            String(error).includes("No such file")
              ? new CupsRejectedJob({ message: String(error) })
              : new CupsUnavailable({ message: String(error) }),
          ),
        )

        return yield* Effect.try({
          try: () => ({ cupsJobId: parseLpSubmitOutput(output) }),
          catch: (error) =>
            new SubmissionUncertainError({ message: String(error) }),
        })
    })

    const listRecentJobs = Effect.fn("CupsClient.listRecentJobs")(function* () {
      return yield* runString(ChildProcess.make("lpstat", ["-W", "not-completed", "-o"])).pipe(
        Effect.mapError(mapCommandFailure),
        Effect.flatMap((output) =>
          Effect.try({
            try: () => parseLpstatJobsOutput(output),
            catch: (error) => new CupsCommandFailed({ message: String(error) }),
          }),
        ),
      )
    })

    const getJobStatus = Effect.fn("CupsClient.getJobStatus")(function* (
      cupsJobId: string,
    ) {
      yield* Effect.annotateCurrentSpan("cups.job_id", cupsJobId)
      return yield* listRecentJobs().pipe(
        Effect.map((jobs) => jobs.find((job) => job.cupsJobId === cupsJobId)),
        Effect.flatMap((job) =>
          job === undefined
            ? Effect.fail(
                new CupsUnavailable({
                  message: `CUPS job ${cupsJobId} not found`,
                }),
              )
            : Effect.succeed(job),
        ),
      )
    })

    const getPrinterSummary = Effect.fn("CupsClient.getPrinterSummary")(function* () {
      yield* Effect.annotateCurrentSpan("cups.printer_name", appConfig.printerName)
      return yield* runString(ChildProcess.make("lpstat", ["-p", appConfig.printerName])).pipe(
        Effect.mapError((error) =>
          new CupsUnavailable({ message: String(error) }),
        ),
        Effect.flatMap((output) =>
          Effect.try({
            try: () => parseLpstatPrinterOutput(output),
            catch: (error) => new CupsCommandFailed({ message: String(error) }),
          }),
        ),
      )
    })

    const getPrinterDeviceUri = Effect.fn("CupsClient.getPrinterDeviceUri")(function* () {
      yield* Effect.annotateCurrentSpan("cups.printer_name", appConfig.printerName)
      return yield* runString(ChildProcess.make("lpstat", ["-v", appConfig.printerName])).pipe(
        Effect.mapError((error) =>
          new CupsUnavailable({ message: String(error) }),
        ),
        Effect.flatMap((output) =>
          Effect.try({
            try: () => parseLpstatDeviceOutput(output).deviceUri,
            catch: (error) => new CupsCommandFailed({ message: String(error) }),
          }),
        ),
      )
    })

    const listAvailableDevices = Effect.fn("CupsClient.listAvailableDevices")(function* () {
      return yield* runString(ChildProcess.make("lpinfo", ["-v"])).pipe(
        Effect.mapError((error) =>
          new CupsUnavailable({ message: String(error) }),
        ),
        Effect.flatMap((output) =>
          Effect.try({
            try: () => parseLpinfoDevicesOutput(output),
            catch: (error) => new CupsCommandFailed({ message: String(error) }),
          }),
        ),
      )
    })

    return CupsClient.of({
      submitFile,
      getJobStatus,
      listRecentJobs,
      getPrinterSummary,
      getPrinterDeviceUri,
      listAvailableDevices,
    })
  }),
)
