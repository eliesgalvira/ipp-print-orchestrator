import { FileSystem } from "@effect/platform"
import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { randomUUID } from "node:crypto"

import { MainLayer } from "../live/MainLayer.js"
import { JobId } from "../domain/JobId.js"
import { Orchestrator } from "../services/Orchestrator.js"

const mimeFromFileName = (fileName: string): string => {
  if (fileName.endsWith(".pdf")) {
    return "application/pdf"
  }
  if (fileName.endsWith(".txt")) {
    return "text/plain"
  }
  return "application/octet-stream"
}

const program = Effect.gen(function* () {
  const filePath = process.argv[2]
  if (filePath === undefined) {
    return yield* Console.error("usage: tsx src/cli/submit.ts <file-path>")
  }

  const fs = yield* FileSystem.FileSystem
  const orchestrator = yield* Orchestrator
  const bytes = yield* fs.readFile(filePath)
  const fileName = filePath.split("/").at(-1) ?? filePath

  const job = yield* orchestrator.submit({
    id: JobId.make(randomUUID()),
    requestId: randomUUID(),
    fileName,
    mimeType: mimeFromFileName(fileName),
    bytes,
  })

  yield* Console.log(`queued print job ${String(job.id)} in state ${job.state}`)
})

program.pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
