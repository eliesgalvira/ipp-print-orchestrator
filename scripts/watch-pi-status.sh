#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi@print-server.local}"
PORT="${IPP_ORCH_BIND_PORT:-4310}"
INTERVAL_SEC="${WATCH_INTERVAL_SEC:-2}"

ssh "${PI_HOST}" "bash -lc '
set -euo pipefail

while true; do
  curl -fsS \"http://127.0.0.1:${PORT}/v1/status\"
  printf \"\n\"
  sleep \"${INTERVAL_SEC}\"
done
'" | node -e '
const readline = require("node:readline")

const formatHeartbeatAge = (value) => {
  if (value === null || value === undefined) {
    return "never"
  }

  const elapsedMs = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsedMs)) {
    return value
  }

  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000))
  return `${elapsedSec}s`
}

const formatFlag = (value, yes, no) => (value ? yes : no)

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on("line", (line) => {
  if (line.trim().length === 0) {
    return
  }

  let status
  try {
    status = JSON.parse(line)
  } catch (error) {
    console.log(`[${new Date().toISOString()}] invalid-json ${line}`)
    return
  }

  const parts = [
    `printer=${formatFlag(status.printerAttached, "attached", "missing")}`,
    `state=${status.printerState ?? "unknown"}`,
    `cups=${formatFlag(status.cupsReachable, "up", "down")}`,
    `net=${formatFlag(status.networkOnline, "online", "offline")}`,
    `jobs=${status.nonterminalJobCount}`,
    `queue=${status.queueDepth}`,
    `heartbeat=${formatHeartbeatAge(status.lastSuccessfulHeartbeatAt)}`,
  ]

  if (Array.isArray(status.printerReasons) && status.printerReasons.length > 0) {
    parts.push(`reasons=${status.printerReasons.join(",")}`)
  }

  if (Array.isArray(status.localIps) && status.localIps.length > 0) {
    parts.push(`ip=${status.localIps[0]}`)
  }

  if (typeof status.hostname === "string" && status.hostname.length > 0) {
    parts.push(`host=${status.hostname}`)
  }

  console.log(`[${new Date().toISOString()}] ${parts.join("  ")}`)
})
'
