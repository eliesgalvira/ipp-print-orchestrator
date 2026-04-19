#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_env_value() {
  local key="$1"
  local file="$2"

  [[ -f "${file}" ]] || return 0
  awk -F= -v key="${key}" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
    }
  ' "${file}" | tail -n 1
}

PRINTER_NAME="${IPP_ORCH_PRINTER_NAME:-}"
if [[ -z "${PRINTER_NAME}" ]]; then
  PRINTER_NAME="$(read_env_value IPP_ORCH_PRINTER_NAME /etc/ipp-print-orchestrator.env)"
fi
if [[ -z "${PRINTER_NAME}" ]]; then
  PRINTER_NAME="$(read_env_value IPP_ORCH_PRINTER_NAME "${ROOT_DIR}/.env")"
fi
PRINTER_NAME="${PRINTER_NAME:-printer}"

cd "${ROOT_DIR}"

node --input-type=module - "${ROOT_DIR}" "${PRINTER_NAME}" <<'NODE'
import { createRequire } from "node:module"
import { join } from "node:path"

const rootDir = process.argv[2]
const require = createRequire(join(rootDir, "apps/agent/dist/main.js"))
const ipp = require("ipp")

const printerName = process.argv[3]
const encodedName = encodeURIComponent(printerName)

const variants = [
  {
    name: "default-null-127",
    url: `http://127.0.0.1:631/printers/${encodedName}`,
    options: undefined,
    message: null,
  },
  {
    name: "default-null-localhost",
    url: `http://localhost:631/printers/${encodedName}`,
    options: undefined,
    message: null,
  },
  {
    name: "ipptool-like",
    url: `http://localhost:631/printers/${encodedName}`,
    options: {
      language: "en",
      uri: `ipp://localhost:631/printers/${encodedName}`,
    },
    message: {
      "operation-attributes-tag": {
        "requested-attributes": ["all", "media-col-database"],
      },
    },
  },
  {
    name: "ipptool-like-with-ipp-1-1",
    url: `http://localhost:631/printers/${encodedName}`,
    options: {
      language: "en",
      uri: `ipp://localhost:631/printers/${encodedName}`,
      version: "1.1",
    },
    message: {
      "operation-attributes-tag": {
        "requested-attributes": ["all", "media-col-database"],
      },
    },
  },
  {
    name: "explicit-http-uri",
    url: `http://localhost:631/printers/${encodedName}`,
    options: {
      language: "en",
      uri: `http://localhost:631/printers/${encodedName}`,
    },
    message: {
      "operation-attributes-tag": {
        "requested-attributes": ["all", "media-col-database"],
      },
    },
  },
]

const execute = (variant) =>
  new Promise((resolve) => {
    const printer = ipp.Printer(variant.url, variant.options)
    const builtMessage = printer._message("Get-Printer-Attributes", variant.message)
    printer.execute("Get-Printer-Attributes", variant.message, (error, response) => {
      resolve({
        name: variant.name,
        request: builtMessage,
        error: error === null || error === undefined
          ? null
          : {
              name: error.name,
              message: error.message,
              statusCode: error.statusCode,
              stack: error.stack,
            },
        response,
      })
    })
  })

for (const variant of variants) {
  const result = await execute(variant)
  console.log(`\n== ${result.name} ==`)
  console.log(JSON.stringify(result, null, 2))
}
NODE
