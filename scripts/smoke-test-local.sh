#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${IPP_ORCH_BIND_PORT:-4310}"
DATA_DIR="${IPP_ORCH_DATA_DIR:-$(mktemp -d /tmp/ipp-orch-smoke.XXXXXX)}"
TMP_FILE="$(mktemp /tmp/ipp-orch-smoke-file.XXXXXX.txt)"
LOG_FILE="$(mktemp /tmp/ipp-orch-smoke-log.XXXXXX.txt)"

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    wait "${APP_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${TMP_FILE}" "${LOG_FILE}"
}

trap cleanup EXIT

printf 'smoke test document\n' > "${TMP_FILE}"
PAYLOAD_BASE64="$(base64 -w0 "${TMP_FILE}")"

cd "${ROOT_DIR}"

IPP_ORCH_DATA_DIR="${DATA_DIR}" \
IPP_ORCH_BIND_HOST="127.0.0.1" \
IPP_ORCH_BIND_PORT="${PORT}" \
IPP_ORCH_PRINTER_NAME="${IPP_ORCH_PRINTER_NAME:-printer}" \
bun --filter @ipp/agent dev >"${LOG_FILE}" 2>&1 &
APP_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/v1/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -fsS "http://127.0.0.1:${PORT}/v1/health"
echo
curl -fsS "http://127.0.0.1:${PORT}/v1/status"
echo

SUBMIT_RESPONSE="$(
  curl -fsS \
    -H 'content-type: application/json' \
    -d "{\"fileName\":\"smoke.txt\",\"mimeType\":\"text/plain\",\"contentBase64\":\"${PAYLOAD_BASE64}\"}" \
    "http://127.0.0.1:${PORT}/v1/jobs"
)"

echo "${SUBMIT_RESPONSE}"

JOB_ID="$(printf '%s' "${SUBMIT_RESPONSE}" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')"
if [[ -z "${JOB_ID}" ]]; then
  echo "failed to extract job id from submit response" >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:${PORT}/v1/jobs/${JOB_ID}"
echo

test -f "${DATA_DIR}/jobs/${JOB_ID}/state.json"
test -f "${DATA_DIR}/outbox/events.jsonl"

echo "local smoke test passed"
