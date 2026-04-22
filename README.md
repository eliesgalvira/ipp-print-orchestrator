# ipp-print-orchestrator

`ipp-print-orchestrator` is a local-first, fault-tolerant print orchestrator for a Raspberry Pi print server. It runs beside CUPS, keeps durable orchestration state on disk, and uses Effect services, tags, and layers as the application architecture.

## Status

Implemented so far:

- Effect-first Bun workspace setup with strict TypeScript and Effect language service
- Pure domain model, typed operational errors, and explicit state machine
- Scripted testkit with in-memory and fault-injection layers
- File-backed blob store, job repository, and durable event outbox
- Startup recovery with queue rehydration and targeted CUPS job repair
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
    observability/
    services/
    util/
packages/shared/
packages/ipp/
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
- Startup recovery is mandatory and rehydrates retryable jobs

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

Runtime entrypoints load configuration from shell environment first, then `.env` in the repository root if present. On the Pi, ad hoc CLI commands also fall back to `/etc/ipp-print-orchestrator.env`.

The app reads configuration from environment variables. The most important settings are:

- `IPP_ORCH_DATA_DIR`
- `IPP_ORCH_PRINTER_NAME`
- `IPP_ORCH_BIND_HOST`
- `IPP_ORCH_BIND_PORT`
- `IPP_ORCH_USB_SYSFS_ROOT`
- `IPP_ORCH_HEARTBEAT_INTERVAL_MS`
- `IPP_ORCH_RECONCILE_INTERVAL_MS`

Deprecated compatibility setting:

- `IPP_ORCH_STATUS_OBSERVATION_INTERVAL_MS`
  - ignored by the current runtime
  - older installs may still have it in `/etc/ipp-print-orchestrator.env` from the previous polling-based design

For local USB printers, the runtime checks both the configured CUPS queue and Linux USB presence under sysfs. USB hotplug events trigger a sysfs-backed attachment refresh, and cold-start status hydrates the same state without running `lpinfo -v` on the request path.

Mandatory printer setup for home/USB printers:

- disable any printer-side `Auto Power Off`, `Sleep`, `Deep Sleep`, `Eco`, or similar automatic power-saving mode before using the orchestrator

If you do not disable printer-side auto power-off, the printer can disappear from the USB bus while CUPS still has a configured queue, which presents as intermittent `printerAttached=false` transitions and confusing "printer looks idle but does not print" behavior.

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
nu scripts/smoke-test-local.nu
```

Live Pi smoke test:

```bash
nu scripts/smoke-test-live-to-pi.nu
```

Continuous live Pi status watch from your laptop:

```bash
nu scripts/watch-status-live-to-pi.nu
```

The watcher prints a compact status line on every poll, including printer attachment, CUPS reachability, network state, nonterminal job count, queue depth, heartbeat age, and the first local IP.

USB hotplug diagnostics from your laptop:

```bash
nu scripts/diagnose-usb-hotplug-live-to-pi.nu
```

The diagnostic SSHes into the Pi and prints the CUPS device URI, current
`/v1/status`, matching USB sysfs devices, and raw `udevadm monitor` events while
you unplug and replug the printer.

The live Pi smoke script checks:

- local health endpoint
- local status endpoint
- `lpstat -p`
- `lpstat -t`
- the configured printer queue exists in CUPS

Live Axiom observability check:

```bash
nu scripts/check-observability-live-to-pi.nu
```

The check SSHes into the Pi, reads `/etc/ipp-print-orchestrator.env`, verifies
that enabled OTLP has usable Axiom endpoint/header configuration, triggers one
local status request, and queries the configured Axiom logs and traces datasets
for recent rows.

`AXIOM_QUERY_TOKEN` and `AXIOM_QUERY_DOMAIN` are optional and are only used by
this live query check. They are not required for OTLP export. If your OTLP token
is ingest-only, set `AXIOM_QUERY_TOKEN` in local `.env` to an Axiom token with
query access before deploying. `AXIOM_QUERY_DOMAIN` is only needed when the
query API domain cannot be derived from the OTLP endpoint.

## Deploying To The Pi

Expected target:

- SSH host: `pi@print-server.local`
- app directory: `/home/pi/apps/ipp-print-orchestrator`

One-time bootstrap on the live Pi:

```bash
nu scripts/bootstrap-live-to-pi.nu
```

Bootstrap installs base packages, installs Nushell on the Pi from the official Nushell Debian/Ubuntu apt repository when `nu` is missing, installs Bun when needed, and creates `/etc/ipp-print-orchestrator.env` on first run. That first file is only a safe placeholder: OTLP defaults to disabled there because bootstrap does not know the production Axiom endpoints or tokens yet. If the Pi already has exactly one CUPS printer queue, the script uses that queue name automatically for `IPP_ORCH_PRINTER_NAME`. If there are multiple queues or none yet, set `IPP_ORCH_PRINTER_NAME` manually after bootstrap.

Before treating the Pi setup as complete, verify on the physical printer itself that any `Auto Power Off`, `Sleep`, `Deep Sleep`, `Eco`, or similar automatic power-saving mode is disabled. This is a mandatory step for reliable USB-attached printing.

Deploy to the live Pi from the development machine:

```bash
nu scripts/deploy-live-to-pi.nu
```

Local deploy requirements:

- `nu`
- `bun`
- `ssh`
- `ssh-keygen`
- `rsync`
- ability to password-login once with `ssh pi@print-server.local` for first-time bootstrap
- passwordless `sudo` for the Pi user

Deployment target and auth can be configured in the ignored local `.env` file:

```dotenv
PI_HOST=pi@print-server.local
APP_DIR=/home/pi/apps/ipp-print-orchestrator
```

Optionally set `PI_SSH_KEY_PATH` in local `.env` if you want to override the default key location of `~/.ssh/ipp-print-orchestrator-pi`.

Script environment naming convention:

- `scripts/*-live-to-pi.nu` commands are run from the development machine and use SSH against the configured live Pi. These are the entrypoints for production-like Pi operations, for example `deploy-live-to-pi.nu` and `bootstrap-live-to-pi.nu`.
- `scripts/*-live-from-pi.nu` commands are target-side implementations that execute from an SSH session on the Pi or are invoked by a `*-live-to-pi.nu` wrapper/deploy step. Do not run these directly from the development machine.
- `scripts/*-mock-local.nu` commands are local-only mock/fake workflows. They must not SSH to the Pi or touch live Pi state.
- `scripts/*-local.nu` commands run only on the development machine and do not target the Pi. Use this suffix when the script is local but not explicitly a mock.

Run `nu scripts/bootstrap-live-to-pi.nu` first. If SSH key auth is not already configured, bootstrap creates or reuses `PI_SSH_KEY_PATH` (default: `~/.ssh/ipp-print-orchestrator-pi`), opens one normal interactive OpenSSH password login to the Pi, and uses a temporary OpenSSH control connection for first-time setup. If remote `nu` already exists, SSH key setup runs directly in Nushell and no remote bash is run. If remote `nu` is missing, bootstrap runs only the minimal bash needed to install Nushell, then switches to remote Nushell to append the public key to `~/.ssh/authorized_keys`. Empty `PI_SSH_KEY_PATH` values are treated as unset so the default key path is used. Subsequent bootstrap, deploy, systemd install, smoke, watch, and update commands use OpenSSH key auth with `BatchMode=yes` and fail fast if the key is missing.

The scripts do not use `sshpass`, `PI_PASSWORD`, or `PI_SUDO_PASSWORD`. They assume the Pi user can run the required `sudo` commands without storing a password in this repository.

Your local `.env` is the source of truth for the Pi service environment. `.env.example` is only a template for humans; deploy does not read it as runtime configuration. Each deploy filters the service runtime keys from local `.env` and installs them to `/etc/ipp-print-orchestrator.env` on the Pi before restarting services. For example, if local `.env` sets `IPP_ORCH_ENABLE_OTLP=true` with valid `OTEL_*` Axiom endpoint/header values, deploy writes those enabled observability settings over the bootstrap placeholder. Deploy-only keys such as `PI_HOST`, `APP_DIR`, and `PI_SSH_KEY_PATH` are not written to the Pi service env, and `.env` is excluded from the rsync copy.

Directory-valued runtime settings such as `IPP_ORCH_DATA_DIR=data` are relative to the systemd service `WorkingDirectory`. During deploy, `scripts/install-systemd-live-from-pi.nu` renders the installed service unit so `WorkingDirectory` and `ExecStart` point at the configured `APP_DIR`. Use an absolute path for a runtime directory only if you intentionally want it outside `APP_DIR`.

To reinstall only the systemd units from the development machine after the app has already been deployed to the Pi:

```bash
nu scripts/install-systemd-live-to-pi.nu
```

The local wrapper uses the same `PI_HOST`, `APP_DIR`, and `PI_SSH_KEY_PATH` settings as the other Pi scripts, SSHes into the Pi, and runs the target-side `scripts/install-systemd-live-from-pi.nu` from the deployed app directory.

The deploy script:

- runs the local `bun run build`
- builds a bundled service entry for faster Pi cold starts
- rsyncs the repository to the Pi with generated/runtime directories excluded
- validates enabled OTLP/Axiom settings before writing the service environment
- syncs the filtered local service environment to `/etc/ipp-print-orchestrator.env`
- checks the production dependency stamp and only runs `bun install --frozen-lockfile --ignore-scripts --production` on the Pi when dependency manifests changed
- installs systemd units
- restarts the service and heartbeat timer
- verifies `/v1/health`
- prints phase timings for the local build/rsync steps and each remote deployment step

To intentionally update already-installed Pi packages and production dependencies:

```bash
bun run update:live-to-pi
```

The update script upgrades only related apt packages that are already installed, skips missing packages, upgrades Bun only when Bun is present, refreshes production dependencies, and prints `timeit` timings for each update phase.

The deploy install step skips lifecycle scripts on the Pi. This is intentional:

- the root `prepare` hook only patches the local TypeScript install for the Effect editor language service
- that patch is not needed to build or run the service on the Pi
- on low-memory Raspberry Pi targets, the patch step can abort with a Node heap OOM during `bun install`

If a deploy already failed on the Pi with an OOM in `effect-language-service patch`, rerun the install manually and continue:

```bash
ssh pi@print-server.local
cd /home/pi/apps/ipp-print-orchestrator
bun install --frozen-lockfile --ignore-scripts
nu scripts/install-systemd-live-from-pi.nu
sudo systemctl restart ipp-print-orchestrator
sudo systemctl restart ipp-print-orchestrator-heartbeat.timer
```

If `/v1/status` shows `cupsReachable: false` and `printerAttached: false` even though `lpstat -p` works on the Pi, verify the configured queue name:

```bash
grep '^IPP_ORCH_PRINTER_NAME=' /etc/ipp-print-orchestrator.env
lpstat -p
```

If they do not match, update `/etc/ipp-print-orchestrator.env` so `IPP_ORCH_PRINTER_NAME` matches the real CUPS queue exactly, then restart the service:

```bash
sudoedit /etc/ipp-print-orchestrator.env
sudo systemctl restart ipp-print-orchestrator
curl http://127.0.0.1:4310/v1/status
```

## Observability

The app now has a dedicated `apps/agent/src/observability/` module that owns OTLP startup, the Effect-to-OpenTelemetry tracer bridge, and wide-event log export. The rest of the runtime only depends on that module's small public surface.

By default, the app still emits wide-event JSON to stdout/journald through the `Telemetry` service. That means you can already tail live events remotely from your laptop:

```bash
ssh pi@print-server.local 'journalctl -u ipp-print-orchestrator -f --no-pager'
```

If you enable OTLP, the daemon exports:

- Effect spans through an OpenTelemetry tracer bridge
- wide-event logs as structured OTLP log records

The runtime now emits canonical change events for network, CUPS, and printer status transitions. Heartbeat is a periodic liveness event that also carries a sampled status summary for quiet periods with no status transitions.

By default, the daemon uses Linux USB hotplug events for USB printer attach/detach detection and an IPP notification stream for CUPS/printer state changes. The old periodic status observation loop has been removed from the daemon hot path.

The CUPS notification stream now uses the in-repo `packages/ipp/` workspace package for IPP codec, transport, and subscription helpers instead of relying on the stale upstream `ipp` package request path. This is intentional: the upstream serializer dropped `subscription-attributes-tag` on outbound requests, which caused CUPS to reject `Create-Printer-Subscriptions` with `client-error-bad-request` and `status-message="No subscription attributes in request."`

If you see a wide event with `observationReason="cups-stream-disconnect"` and a `printerMessage` like `IPP Create-Printer-Subscriptions request failed: client-error-bad-request (status-message="No subscription attributes in request.")`, the daemon is failing to establish the notification subscription. That symptom should no longer happen with the in-repo serializer path unless the local CUPS server is rejecting the request for some other reason.

For a package-level reference of the local IPP library surface, see `docs/ipp-package.md`.

`network.status.changed` remains a local durable fact, but should not be treated as a guaranteed remote Axiom fact during internet outages until a replay worker exists for the local outbox.

Example Axiom match-monitor query for actionable printer availability changes:

```apl
['ipp-print-logs']
| extend event_name = ['attributes.eventName'],
         hostname = ['attributes.hostname'],
         observation_reason = ['attributes.observationReason'],
         previous_cups_reachable = ['attributes.previousCupsReachable'],
         cups_reachable = ['attributes.cupsReachable'],
         previous_attached = ['attributes.previousPrinterAttached'],
         attached = ['attributes.printerAttached'],
         previous_queue_available = ['attributes.previousPrinterQueueAvailable'],
         queue_available = ['attributes.printerQueueAvailable'],
         previous_printer_state = ['attributes.previousPrinterState'],
         printer_state = ['attributes.printerState']
| where (event_name == "cups.status.changed"
         and isnotnull(previous_cups_reachable)
         and previous_cups_reachable != cups_reachable)
     or (event_name == "printer.status.changed"
         and ((isnotnull(previous_attached) and previous_attached != attached)
              or (isnotnull(previous_queue_available) and previous_queue_available != queue_available)
              or (coalesce(previous_printer_state, "<null>") != coalesce(printer_state, "<null>"))))
| project _time,
          event_name,
          hostname,
          observation_reason,
          previous_cups_reachable,
          cups_reachable,
          previous_attached,
          attached,
          previous_queue_available,
          queue_available,
          previous_printer_state,
          printer_state
```

Use the broader `printer.status.changed` query from `docs/axiom-observability.md`
for diagnostics only; it can match message/reason-only churn that is not
actionable for alerting.

For physical attach/detach-only notifications, replace the `where` clause with:

```apl
| where event_name == "printer.status.changed"
| where isnotnull(previous_attached) and previous_attached != attached
```

Example Axiom-oriented environment:

```bash
IPP_ORCH_ENABLE_OTLP=true
OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator,service.version=dev
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://AXIOM_OTLP_DOMAIN/v1/traces
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://AXIOM_OTLP_DOMAIN/v1/logs
OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer AXIOM_API_TOKEN,x-axiom-dataset=ipp-print-traces
OTEL_EXPORTER_OTLP_LOGS_HEADERS=authorization=Bearer AXIOM_API_TOKEN,x-axiom-dataset=ipp-print-logs
```

Or, if your backend uses a shared OTLP base URL:

```bash
IPP_ORCH_ENABLE_OTLP=true
OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator,service.version=dev
OTEL_EXPORTER_OTLP_ENDPOINT=https://OTLP_COLLECTOR_DOMAIN
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer TOKEN
```

Current scope:

- traces: wired
- logs: wired
- metrics: not wired yet

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
- startup recovery will rehydrate them after restart

`CUPS unavailable`

- submission attempts transition through `WaitingForCups` and `RetryScheduled`
- retries use Effect scheduling and avoid busy loops

`Submission uncertain`

- the job enters `SubmissionUncertain`
- the system will not blindly resubmit until CUPS job repair determines what happened

`Telemetry unavailable`

- printing continues
- durable local state and outbox persistence still happen

`Network offline`

- the app degrades locally without crashing
- local orchestration and disk persistence still work
