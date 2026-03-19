# ipp-print-orchestrator

`ipp-print-orchestrator` is a local-first, fault-tolerant print orchestrator for a Raspberry Pi print server. It runs beside CUPS, keeps durable orchestration state on disk, and uses Effect services, tags, and layers as the application architecture.

## Status

Implemented so far:

- Effect-first Bun workspace setup with strict TypeScript and Effect language service
- Pure domain model, typed operational errors, and explicit state machine
- Scripted testkit with in-memory and fault-injection layers
- File-backed blob store, job repository, and durable event outbox
- Startup reconciliation and queue re-enqueueing
- Live CUPS CLI adapter based on `lp` and `lpstat`
- Local HTTP API with health and status endpoints
- Internal heartbeat emission and local smoke testing
- Pi deployment scripts and systemd unit files

Current deviation from the original pnpm-oriented scaffold:

- This repository uses a Bun workspace because the package manager was chosen up front as `bun`
- Deployment and local commands therefore use `bun` instead of `pnpm`

## Repository Layout

```text
apps/agent/
  src/
    cli/
    config/
    domain/
    http/
    live/
    services/
    util/
packages/shared/
packages/testkit/
scripts/
systemd/
```

## Architecture

Key rules enforced in the current implementation:

- CUPS remains the real spooler
- The orchestrator persists local state before acknowledging accepted jobs
- Durable repo state is the orchestration source of truth
- External interactions are hidden behind Effect services
- Operational failures are typed domain errors, not raw exceptions
- `SubmissionUncertain` is explicit and blocks blind re-submit
- Startup reconciliation is mandatory and re-enqueues retryable jobs

Important services:

- `BlobStore`
- `JobRepo`
- `EventSink`
- `Telemetry`
- `CupsClient`
- `PrinterProbe`
- `NetworkProbe`
- `QueueRuntime`
- `Reconciler`
- `Heartbeat`
- `Orchestrator`

## Effect Setup

This repository is configured to work with Effect:

- `effect-solutions` guidance is referenced in `CLAUDE.md` and `AGENTS.md`
- the Effect language service is installed and patched through `prepare`
- strict TypeScript settings live in `tsconfig.base.json`
- a local reference checkout of Effect lives under `.reference/effect/`

When working on Effect code:

```bash
effect-solutions list
effect-solutions show basics services-and-layers data-modeling error-handling testing
```

## Local Setup

Install dependencies:

```bash
bun install
```

Copy or adapt environment values if needed:

```bash
cp .env.example .env
```

The app reads configuration from environment variables. The most important settings are:

- `IPP_ORCH_DATA_DIR`
- `IPP_ORCH_PRINTER_NAME`
- `IPP_ORCH_BIND_HOST`
- `IPP_ORCH_BIND_PORT`
- `IPP_ORCH_HEARTBEAT_INTERVAL_MS`
- `IPP_ORCH_RECONCILE_INTERVAL_MS`

## Running Locally

Run the full daemon:

```bash
bun --filter @ipp/agent dev
```

Run the built daemon:

```bash
bun run build
bun --filter @ipp/agent start
```

Run targeted entrypoints:

```bash
bun --filter @ipp/agent worker
bun --filter @ipp/agent reconcile
bun --filter @ipp/agent submit -- ./path/to/file.pdf
```

## HTTP API

Available endpoints:

- `POST /v1/jobs`
- `GET /v1/jobs/:id`
- `GET /v1/health`
- `GET /v1/status`

Example submit request:

```bash
curl -X POST http://127.0.0.1:4310/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "fileName": "hello.txt",
    "mimeType": "text/plain",
    "contentBase64": "aGVsbG8K"
  }'
```

## Running Tests

Root commands:

```bash
bun run typecheck
bun run test
bun run build
bun run lint
bun run format
```

Agent package commands:

```bash
bun --filter @ipp/agent test
bun --filter @ipp/agent test:watch
bun --filter @ipp/agent smoke
```

## Smoke Testing

Local smoke test:

```bash
bash scripts/smoke-test-local.sh
```

Pi smoke test:

```bash
bash scripts/smoke-test-pi.sh
```

The Pi smoke script checks:

- local health endpoint
- local status endpoint
- `lpstat -p`
- `lpstat -t`
- the configured printer queue exists in CUPS

## Deploying To The Pi

Expected target:

- SSH host: `pi@print-server.local`
- app directory: `/home/pi/apps/ipp-print-orchestrator`

One-time bootstrap on the Pi:

```bash
bash scripts/bootstrap-pi.sh
```

Deploy from the development machine:

```bash
bash scripts/deploy-pi.sh
```

The deploy script:

- rsyncs the repository to the Pi
- runs `bun install --frozen-lockfile --ignore-scripts`
- runs `bun run build`
- installs systemd units
- restarts the service and heartbeat timer

The deploy install step skips lifecycle scripts on the Pi. This is intentional:

- the root `prepare` hook only patches the local TypeScript install for the Effect editor language service
- that patch is not needed to build or run the service on the Pi
- on low-memory Raspberry Pi targets, the patch step can abort with a Node heap OOM during `bun install`

If a deploy already failed on the Pi with an OOM in `effect-language-service patch`, rerun the install manually and continue:

```bash
ssh pi@print-server.local
cd /home/pi/apps/ipp-print-orchestrator
bun install --frozen-lockfile --ignore-scripts
bun run build
bash scripts/install-systemd.sh
sudo systemctl restart ipp-print-orchestrator
sudo systemctl restart ipp-print-orchestrator-heartbeat.timer
```

## Systemd And Journald

Installed units:

- `systemd/ipp-print-orchestrator.service`
- `systemd/ipp-print-orchestrator-heartbeat.service`
- `systemd/ipp-print-orchestrator-heartbeat.timer`

Manual commands on the Pi:

```bash
sudo systemctl status ipp-print-orchestrator
journalctl -u ipp-print-orchestrator -f
curl http://127.0.0.1:4310/v1/health
curl http://127.0.0.1:4310/v1/status
lpstat -p
lpstat -t
```

## Common Failure Modes

`Printer unavailable`

- the worker moves jobs into `WaitingForPrinter`
- startup reconciliation will reload them after restart

`CUPS unavailable`

- submission attempts transition through `WaitingForCups` and `RetryScheduled`
- retries use Effect scheduling and avoid busy loops

`Submission uncertain`

- the job enters `SubmissionUncertain`
- the system will not blindly resubmit until reconciliation determines what happened

`Telemetry unavailable`

- printing continues
- durable local state and outbox persistence still happen

`Network offline`

- the app degrades locally without crashing
- local orchestration and disk persistence still work
