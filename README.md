# ipp-print-orchestrator

This repository runs a guarded CUPS print server for an HP Laser MFP 135a on a
Raspberry Pi. Phones submit jobs directly to the advertised IPPS queue. CUPS is
the only job ingress, spool, and lifecycle authority.

The Effect agent does three things:

- observes CUPS, the configured device URI, and Linux USB state;
- exposes local health and status endpoints;
- emits bounded process logs and optional OTLP telemetry.

The CUPS filter and USB backend enforce print safety before bytes reach the
printer. The agent does not accept or persist print jobs.

## Repository layout

```text
apps/agent/       Effect service and CUPS PDF filter
packages/ipp/     Lossless IPP codec, client, and subscription helpers
nix/              flake-parts modules (*.mod.nix): packages, checks, dev shell, formatter
scripts/          Local and live-Pi operational adapters
systemd/          Pi systemd units rendered against the copied Nix runtime closure
docs/             Accepted printer and safety decision
```

## Protocol invariants

- Parsed IPP groups and attributes remain ordered arrays. Repeated complete
  attributes are preserved and rejected at the network boundary; they are never
  flattened into a JavaScript object.
- Outgoing request attributes use maps because this process constructs them and
  uniqueness is intrinsic at that boundary.
- `usb://` and the installed `ipp-orch-usb://` wrapper URI identify the same
  physical USB device.
- The Nix HP ULD package is the only source of the installed PPD. Its four paper
  defaults are A4.
- Enabling a shared queue requires the official CUPS
  `get-printer-attributes.test` to pass against its public IPPS endpoint.

## Setup and checks

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run lint
nix flake check
```

Run the agent locally:

```bash
bun --filter @ipp/agent dev
```

The local smoke test starts the agent and checks both public endpoints:

```bash
nu scripts/smoke-test-local.nu
```

## HTTP surface

- `GET /v1/health`
- `GET /v1/status`

There is deliberately no job API. Use the IPPS queue for printing.

## Configuration

Runtime entrypoints read the process environment first and then the repository
`.env`. The Pi service also reads `/etc/ipp-print-orchestrator.env`.

- `IPP_ORCH_PRINTER_NAME`
- `IPP_ORCH_BIND_HOST`
- `IPP_ORCH_BIND_PORT`
- `IPP_ORCH_USB_SYSFS_ROOT`
- `IPP_ORCH_USB_VENDOR_ID`
- `IPP_ORCH_USB_PRODUCT_ID`
- `IPP_ORCH_USB_SERIAL`
- `IPP_ORCH_HEARTBEAT_INTERVAL_MS`
- `IPP_ORCH_LOG_PRETTY`
- `IPP_ORCH_ENABLE_OTLP`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_HEADERS`
- `OTEL_RESOURCE_ATTRIBUTES`

The CUPS PDF filter has separate resource guards such as
`IPP_ORCH_CUPS_TMP_DIR_MIN_FREE_BYTES`. See the filter source and
[ADR 0001](docs/adr-0001-hp135a-cups-driver-and-safety.md) for its safety
contract.

## Pi operations

The supported development-machine entrypoints are:

```bash
nu scripts/bootstrap-live-to-pi.nu
nu scripts/deploy-live-to-pi.nu
nu scripts/smoke-test-live-to-pi.nu
nu scripts/check-observability-live-to-pi.nu
nu scripts/diagnose-usb-hotplug-live-to-pi.nu
```

Target and SSH settings belong in the ignored local `.env`:

```dotenv
PI_HOST=pi@print-server.local
PI_SSH_KEY_PATH=~/.ssh/ipp-print-orchestrator-pi
APP_DIR=/home/pi/apps/ipp-print-orchestrator
AARCH64_BUILDER_HOST=local
```

Scripts ending in `-live-to-pi.nu` run from the development machine. Their
`-live-from-pi.nu` counterparts are target-side implementations invoked through
SSH. The Pi runs Raspberry Pi OS; the flake builds the runtime, driver, and
backend closures that are copied to its Nix store.

## CUPS safety

The HP 135a is a Samsung-derived SPL printer. Do not replace the matching HP ULD
driver with generic PCL/PCL XL or SpliX. The packaged PPD keeps 8-bit grayscale,
renders the standard option at 300x300, skips blank form feeds, and defaults all
paper declarations to A4.

The `ipp-pdf-preflight-to-spl` filter rejects encrypted or unreadable PDFs,
multiple copies, inconsistent page counts, unsafe SPL headers, oversized output,
and insufficient temporary space. It stages complete SPL/QPDL output before the
`ipp-orch-usb` backend touches USB. The backend rejects empty input and times out
a wedged real USB backend.

Safe queue configuration leaves CUPS stopped, unshared, and rejecting jobs:

```bash
nu scripts/setup-cups-live-to-pi.nu
```

Enable printing only with the printer cleared and paper intentionally loaded:

```bash
nu scripts/setup-cups-live-to-pi.nu --enable-printing
```

That command enables the queue only after TLS identity checks and the official
IPPS attribute conformance test pass. It does not print a test page.

Emergency stop:

```bash
nu scripts/setup-cups-live-to-pi.nu --stop-only
```

Printer-side Auto Power Off, Deep Sleep, Eco, or equivalent modes must be
disabled. Otherwise the USB device can disappear while the configured CUPS queue
still exists.

## Observability

Events are written once through structured process logging and optional OTLP.
There is no local append-only event mirror. When OTLP is unavailable, remote
telemetry can be missing; printer operation and status observation continue.

The live observability check reads `AXIOM_QUERY_URL`, `AXIOM_QUERY_TOKEN`,
`AXIOM_LOGS_DATASET`, and `AXIOM_TRACES_DATASET` from the target env file. It
queries both datasets for the trace ID returned by the status request it just
made.
