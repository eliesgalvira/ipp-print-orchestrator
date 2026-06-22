# Nix Build System Refactor Plan

Date: 2026-06-21

## Purpose

This document tracks the refactor from a mutable Nushell/Bash/Raspberry Pi build
and setup flow to a Nix-centered build, package, and deployment model.

The goal is not to remove Nushell. Nushell remains useful as the operator-facing
shell and as a high-quality adapter for remote Pi operations. The goal is to move
build products, driver artifacts, package dependencies, service definitions, and
machine invariants into typed, cached, inspectable Nix outputs.

The current build interface should become:

```text
nix build
nix flake check
nix develop
nix copy --to ssh://...
```

The current operational interface can remain:

```text
nu scripts/...-live-to-pi.nu
```

But those Nu scripts should become thin adapters over Nix outputs, not the place
where production state is downloaded, patched, installed, and made correct by
convention.

## Architectural Principles

### Encode Operational Lore In Interfaces

The current system has important operational knowledge spread across scripts:

- HP ULD version and URL.
- HP ULD PPD expected lines.
- 600dpi-to-300dpi safety patch.
- The PDF preflight CUPS filter must precede `rastertospl`.
- The CUPS USB backend must stage bytes before touching USB.
- Empty payloads must fail before the printer sees anything.
- CUPS must not retry bad jobs indefinitely.
- The live queue must default to safe/stopped behavior unless explicitly enabled.

These are not incidental implementation details. They are safety invariants.

In the new build system, anything whose violation can cause silent unsafe output,
runaway pages, corrupted printer bytes, or unreproducible deployment state should
be enforced at the narrowest practical interface:

- derivation build checks,
- Nix flake checks,
- NixOS module assertions,
- activation checks,
- and live Pi smoke checks where physical hardware is required.

### Keep Dangerous Machinery Behind Narrow Modules

The HP driver package is a good example of a deep module:

```text
Interface:
  package `hp-uld-hp135a`
  exposes:
    lib/cups/filter/rastertospl
    lib/cups/filter/pstosecps
    share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd

Implementation:
  download HP archive
  select host architecture
  verify expected PPD lines
  patch PPD
  patch/wrap proprietary binaries
  expose store paths
```

Callers should not know the HP URL, tarball shape, PPD patch commands, ELF
interpreter details, or library search paths. Those facts belong inside the
package implementation, with checks that fail early if they stop being true.

The same idea should apply to:

- the agent package,
- the CUPS filter package,
- the NixOS module,
- and deployment activation.

### Keep Transport Out Of Domain Configuration

The live Pi is reached through SSH, but SSH is not part of the domain model.

Domain configuration should say things like:

```nix
services.ippPrintOrchestrator.printer.profile = "hp135a-safe";
services.ippPrintOrchestrator.printer.enablePrinting = false;
services.ippPrintOrchestrator.printer.queueName = "HP135a";
```

Deployment transport should say things like:

```text
PI_HOST=pi@print-server.local
PI_SSH_KEY_PATH=~/.ssh/ipp-print-orchestrator-pi
nix copy --to ssh://pi@print-server.local ...
```

Those should remain separate. A NixOS module should not know about rsync, and an
SSH wrapper should not encode printer safety policy.

### Use Types And Checks Where They Buy Operational Value

Do not encode everything in Nix types merely because Nix can. Types and
assertions are worth their cost when they protect against:

- silent corruption,
- unsafe physical printer behavior,
- unreproducible builds,
- deployment drift,
- missing runtime dependencies,
- incorrect service wiring,
- or runtime behavior that only fails after the Pi has accepted jobs.

Use runtime checks instead when the invariant is genuinely dynamic:

- current USB attachment state,
- current Avahi hostname,
- current CUPS queue status,
- recent logs,
- physical printer readiness.

### Nushell Is An Adapter, Not The Build System

Nushell remains valuable for:

- interactive administration on the Pi,
- structured parsing in diagnostics,
- SSH orchestration,
- smoke tests,
- status/watch commands,
- and operator workflows.

Nushell should not remain responsible for:

- downloading HP driver archives,
- patching PPDs,
- deciding package versions,
- installing production JS dependencies,
- installing systemd units by string replacement,
- or mutating CUPS state without a generated plan/interface.

Systemd services and activation scripts that use Nu should call explicit store
paths and use `nu --no-config-file`.

### Prefer Boring Runtime Defaults

Use systemd. Avoid depending on `network-online.target` unless a unit truly
requires it. The app binds localhost and can start before the broader network is
fully settled. CUPS/Avahi/TLS watcher dependencies should be explicit and
minimal.

Do not set root's shell to Nushell. The Pi operator user can use Nushell as its
interactive shell, but recovery paths should remain boring.

## Current State Before The Refactor

The project currently builds and deploys through a mixture of Bun, Nushell,
OpenSSH, rsync, apt, curl, Bash, and systemd.

Important current build/runtime facts:

- The repo uses Bun workspaces and `bun.lock`.
- `package.json` builds the TypeScript service and CUPS filter with Bun.
- The deployed service runs on Node, not Bun.
- The target Pi setup installs packages with apt.
- Bootstrap installs Bun using the upstream shell installer.
- Bootstrap installs Nushell using an apt repository if needed.
- CUPS setup downloads HP ULD on the Pi.
- CUPS setup patches the HP PPD on the Pi.
- CUPS setup installs proprietary filters and `libscmssc.so` into global paths.
- CUPS setup installs a checked-in POSIX CUPS USB backend wrapper.
- systemd units are checked in but path-substituted during install.
- deploy currently rsyncs source plus local build outputs to the Pi.
- production dependency install runs on the Pi with `bun install --production`.

This works but has poor locality:

- Package versions are not pinned in one build graph.
- Production state is assembled imperatively on the Pi.
- Rebuilding depends on the Pi's package state and network.
- CUPS safety invariants are checked late.
- A stale target-side script can reinstall old unsafe behavior.
- The current scripts are useful adapters but too shallow as modules: callers
  need to know nearly as much as the implementation to reason about safety.

## Completed Slice: Initial Flake And Printer Packages

The first slice added a flake and two concrete packages without changing live
deployment behavior.

Files added:

- `flake.nix`
- `flake.lock`
- `nix/packages/default.nix`
- `nix/packages/hp-uld-hp135a.nix`
- `nix/packages/cups-usb-backend.nix`
- `nix/checks/default.nix`
- `nix/dev-shell.nix`

Files changed:

- `.gitignore` now ignores the standard Nix `result` symlink.

### `hp-uld-hp135a`

The package currently:

- pins HP ULD archive `uld-hp_V1.00.39.12_00.15`;
- pins archive hash `sha256-zrube2El50BmNLucKpiwFHfR4R1mx8kEdGad6ZJ7yR0=`;
- supports `x86_64-linux` and `aarch64-linux`;
- chooses `x86_64/` or `aarch64/` from the upstream archive;
- installs `rastertospl`;
- installs `pstosecps`;
- installs `libscmssc.so`;
- copies `HP_Laser_MFP_13x_Series.ppd`;
- verifies that the original PPD contains expected HP ULD lines;
- injects the `application/pdf` CUPS filter line for `ipp-pdf-preflight-to-spl`;
- replaces the effective standard quality resolution from 600x600 to 300x300;
- verifies the patched PPD contains the safe lines;
- wraps the proprietary filters with store-path `LD_LIBRARY_PATH`;
- uses `autoPatchelfHook` to patch ELF interpreter/runtime references.

This moves the HP driver acquisition and PPD safety transform from live Pi
mutation into a reproducible package build.

### `cups-usb-backend`

The package currently:

- installs `scripts/cups/backend/ipp-orch-usb`;
- patches its shebang into the Nix store;
- wraps it with a store `PATH` containing `coreutils` and `gnused`;
- keeps the script POSIX-compatible because CUPS backends have POSIX shell
  expectations and this path is a recovery-sensitive runtime adapter.

The package deliberately installs the exact backend script from the flake source
instead of unpacking the whole repo.

### Checks

The initial checks:

- build `hp-uld-hp135a`;
- build `cups-usb-backend`;
- check the patched PPD contains the PDF preflight filter;
- check the patched PPD contains the HP raster filter;
- check the patched PPD contains the 300x300 standard quality line;
- fail if the unsafe 600x600 standard quality line survives;
- run `nu --no-config-file scripts/tests.nu` inside Nix.

### Dev Shell

The dev shell currently includes:

- `bun`
- `nodejs-slim`
- `nushell`
- `cups`
- `poppler-utils`
- `ghostscript`
- `openssl`
- `openssh`
- `rsync`
- `git`
- `nixfmt`

The shell is intentionally a developer/operator shell, not a production package.

### Verification Already Performed

Commands that passed locally:

```bash
nix build .#hp-uld-hp135a
nix build .#cups-usb-backend
nix flake check --print-build-logs
nix fmt -- --check flake.nix nix/packages/default.nix nix/packages/hp-uld-hp135a.nix nix/packages/cups-usb-backend.nix nix/checks/default.nix nix/dev-shell.nix
nix develop --command bash -lc 'bun --version && node --version && nu --version | head -n 1 && pdfinfo -v 2>&1 | head -n 1 && gs --version'
```

`nix flake check` ran the Nushell test suite inside Nix and passed.

Dry-runs also resolved for aarch64 package/check outputs:

```bash
nix build --dry-run .#packages.aarch64-linux.hp-uld-hp135a
nix build --dry-run .#packages.aarch64-linux.cups-usb-backend
nix build --dry-run .#checks.aarch64-linux.hp-uld-hp135a-ppd .#checks.aarch64-linux.nu-scripts
```

The aarch64 outputs have not yet been executed on the Pi. That is a later step.

## Important Non-Goals For The First Slice

The first slice intentionally did not:

- package the TypeScript agent;
- package production JS dependencies;
- replace deploy scripts;
- install Nix on the Pi;
- copy closures to the Pi;
- activate a NixOS module;
- change CUPS live state;
- change systemd live state;
- rewrite the CUPS PDF filter in Deno;
- or remove existing Nushell scripts.

These are future slices. Treating them as complete now would be sloppy.

## Completed Slice: JavaScript Runtime Package

### Problem

The current deployment builds locally with Bun, rsyncs source/build outputs, then
runs production dependency installation on the Pi:

```text
bun install --frozen-lockfile --ignore-scripts --production
```

That means production dependency realization still depends on:

- the Pi's Bun install;
- the Pi's network;
- the Pi's memory;
- mutable `node_modules`;
- and current runtime filesystem state.

The service package cannot be considered reproducible until `node_modules` or
the bundled equivalent is a Nix output.

### Implemented Outcome

This slice added a Nix package for the service and CUPS PDF preflight filter:

```text
packages.${system}.ipp-print-orchestrator
packages.${system}.default
```

The package builds from the flake source using Bun inside a Nix derivation. It
does not read host `node_modules`; the Bun install cache is generated from
`bun.lock` through `bun2nix` and consumed by the `bun2nix` setup hook.

Files added:

- `nix/bun.nix`
- `nix/packages/ipp-print-orchestrator.nix`

Files changed:

- `flake.nix`
- `flake.lock`
- `nix/packages/default.nix`
- `nix/checks/default.nix`

The package installs:

```text
$out/bin/ipp-print-orchestrator-agent
$out/share/ipp-print-orchestrator/service/main.js
$out/share/ipp-print-orchestrator/service/*.js
$out/lib/cups/filter/ipp-pdf-preflight-to-spl
$out/libexec/ipp-print-orchestrator/cups-pdf-preflight-filter.js
```

Both Node entrypoint directories include a generated `package.json` with
`{ "type": "module" }`, because Bun emits ESM `.js` files and Node must parse
them as modules.

The CUPS filter wrapper binds runtime tools through explicit store paths:

- `pdfinfo` is added to `PATH` from `poppler-utils`;
- `pdftopdf` is set with `IPP_ORCH_CUPS_PDFTOPDF_FILTER`;
- `gstoraster` is set with `IPP_ORCH_CUPS_GSTORASTER_FILTER`;
- `rastertospl` is set with `IPP_ORCH_CUPS_RASTERTOSPL_FILTER`;
- `XDG_CACHE_HOME` defaults to `/var/cache/ipp-print-orchestrator`.

That preserves the existing TypeScript boundary: the filter already accepts
subfilter paths through environment variables, so Nix can wire the runtime
without changing filter code.

### Dependency Graph Finding

The first implementation uses `bun2nix` over the root `bun.lock`. It is correct
and reproducible, but broader than the runtime package needs. The generated
dependency set includes root dev/test tooling and cross-platform optional
packages, including Biome, Vitest, Effect language service, Rollup optional
binaries, and Esbuild optional binaries.

This is not a functional blocker. It is a cache-size and first-realization
problem. The next optimization should narrow the JS dependency graph without
reintroducing mutable target-side installs. Plausible approaches:

- generate a runtime-specific Bun lock for the agent workspace;
- teach the Nix package to consume a pruned dependency expression;
- split build/test dependency checks from runtime packaging;
- or keep the current broad expression until binary cache behavior is measured
  on the Pi.

Do not solve this by returning dependency installation to the Pi. That would
undo the main architectural improvement.

### Desired Interface

The package interface currently exposes one combined runtime output:

```text
packages.${system}.ipp-print-orchestrator
```

The agent package exposes an executable entrypoint, not a source tree that
requires install-time dependency work:

```text
$out/bin/ipp-print-orchestrator-agent
```

The CUPS filter wrapper is part of the same output:

```text
$out/lib/cups/filter/ipp-pdf-preflight-to-spl
```

### Candidate Implementations

#### Candidate A: Bun Build With Generated Dependency Derivation

Keep the repo's current package manager and build semantics. Generate a Nix
dependency closure from `bun.lock` using external tooling such as `bun2nix`, or
vendor/fetch dependencies through a generated Nix file.

Advantages:

- lowest migration cost;
- matches existing developer workflow;
- `pkgs.bun` is available and cached for x86_64/aarch64;
- avoids changing app runtime semantics while changing build plumbing.

Risks:

- `bun2nix` is external to nixpkgs;
- generated files can be noisy;
- optional/native npm dependency handling must be verified;
- Effect beta packages and OpenTelemetry dependencies must be checked carefully.

Acceptance criteria:

- Nix build does not read host `node_modules`;
- Nix build does not run network after fixed-output fetches are declared;
- output builds from clean checkout;
- output works on x86_64 locally;
- aarch64 closure can be copied to Pi;
- service starts on Pi from store path;
- existing `bun run build` remains available for development until replaced.

#### Candidate B: NPM Lock Import

Move or mirror dependency locking to npm/package-lock and use nixpkgs'
`importNpmLock`.

Advantages:

- uses a nixpkgs-supported path;
- less reliance on third-party Bun-specific tooling.

Risks:

- changes package manager contract;
- risks churn in workspace dependency resolution;
- may fight the existing Bun-based repo;
- not justified until Bun-specific packaging proves weak.

Acceptance criteria would be the same as Candidate A, plus proof that local
developer workflow does not get worse.

#### Candidate C: Bundle Everything With Bun And Minimize Runtime Dependencies

Use Bun to bundle the service and filter so the runtime package mostly needs
Node plus bundled JS files.

Advantages:

- close to current `package.json`;
- simple runtime shape;
- can be packaged as a store output without full `node_modules`.

Risks:

- must prove all runtime imports are actually bundled;
- dynamic imports and Node builtins must be checked;
- OpenTelemetry/Effect platform dependencies may not bundle cleanly;
- source maps and diagnostics need deliberate handling.

Acceptance criteria:

- generated bundle starts without `node_modules`;
- no unresolved runtime package imports;
- health endpoint passes locally;
- service starts on Pi.

### Decision

The implemented slice uses Candidate A and Candidate C together:

- Candidate A supplies the reproducible dependency cache from `bun.lock`.
- Candidate C supplies bundled runtime artifacts so the deployed package does
  not need a mutable `node_modules` directory.

This is pragmatic because the current build already bundles with Bun, while the
raw bundle cannot be considered hermetic unless dependency realization also
happens in Nix.

### Validation Commands

Commands that passed locally:

```bash
nix build .#ipp-print-orchestrator --print-build-logs
nix flake check --print-build-logs
nix build .#packages.aarch64-linux.ipp-print-orchestrator --dry-run
node --check result/share/ipp-print-orchestrator/service/main.js
node --check result/libexec/ipp-print-orchestrator/cups-pdf-preflight-filter.js
```

`nix flake check` also runs:

- package build for `ipp-print-orchestrator`;
- package build for `hp-uld-hp135a`;
- package build for `cups-usb-backend`;
- JS syntax/wrapper existence check;
- HP PPD invariant check;
- Nushell test suite inside Nix.

Manual probing showed that `ipp-print-orchestrator-agent` starts the real agent
instead of printing a version/help message. Do not use that as a cheap smoke
command until the service has a side-effect-free CLI mode or the check supplies
isolated runtime directories and ports.

## Next Slice 2: Package The CUPS PDF Preflight Filter

### Problem

The PPD now references `ipp-pdf-preflight-to-spl`, but the filter implementation
is still built by:

```text
bun build apps/agent/src/cli/cups-pdf-preflight-filter.ts --target=node ...
```

and installed by mutable setup scripts.

The filter is safety-critical because it decides whether bytes reach
`rastertospl` and eventually the physical printer.

### Desired Interface

Expose a package:

```text
packages.${system}.cups-pdf-preflight-filter
```

with:

```text
$out/lib/cups/filter/ipp-pdf-preflight-to-spl
```

The wrapper should use store paths for:

- Node runtime, if Node-based;
- `pdfinfo`;
- `pdftopdf`;
- `gstoraster`;
- `rastertospl`;
- any temporary helper utilities.

### Node-Based Implementation

Default implementation should stay Node-based initially.

Reasoning:

- Current filter is Node code.
- Main project dependencies are Node/Effect-oriented.
- `nodejs-slim` is cached for aarch64.
- Keeping runtime semantics stable reduces risk while moving install/build
  semantics into Nix.

The package should:

- build or copy the filter JS into the store;
- wrap it with `nodejs-slim`;
- set environment variables pointing to store renderer paths;
- avoid `/usr/bin/node`;
- avoid `/usr/bin/pdfinfo`;
- avoid `/usr/lib/cups/filter/...` assumptions.

### Deno Spike

Deno should remain a later hardening spike, not the default path.

Deno may be attractive because `deno compile` can enforce permissions such as:

```text
--allow-run=<pdfinfo>,<pdftopdf>,<gstoraster>,<rastertospl>
--allow-read=<input/temp paths>
--allow-write=<temp/cache paths>
```

But it is not dramatically better by default:

- compiled binaries are large;
- Node compatibility can differ in subtle places;
- the existing filter uses Node APIs;
- changing runtime and build system at the same time increases blast radius.

The Deno spike is acceptable only after the Node-based package exists and tests
can compare behavior.

### Acceptance Criteria

- Filter package builds with Nix.
- Filter wrapper uses only store paths for runtime commands.
- Existing filter tests pass.
- A no-print `cupsfilter` conversion can call the store filter.
- Filter rejects encrypted/protected PDFs.
- Filter rejects empty/invalid input.
- Filter rejects multiple-copy jobs.
- Filter stages final SPL/QPDL bytes before backend handoff.
- No physical print happens during package/check tests.

## Completed Slice: Pi Remote Nix Execution Adapter Skeleton

### Problem

We can dry-run aarch64 closures locally, but we cannot execute ARM binaries on
the development machine. The Pi is available and should be used for real ARM
validation.

The existing remote script interface is useful:

- `PI_HOST`
- `PI_SSH_KEY_PATH`
- `run-remote-nu-source`
- `run-ssh`
- Batch-mode SSH after bootstrap

This should be kept and deepened into a Nix-aware adapter.

### Implemented Interface

Added:

```text
scripts/check-nix-closures-live-to-pi.nu
```

The script is deliberately narrow. It does not deploy the app, configure CUPS,
restart systemd units, install HP files into `/usr`, or print. Its interface is:

```text
nu scripts/check-nix-closures-live-to-pi.nu
nu scripts/check-nix-closures-live-to-pi.nu \
  --runtime-installable .#packages.aarch64-linux.ipp-print-orchestrator \
  --driver-installable .#packages.aarch64-linux.hp-uld-hp135a \
  --backend-installable .#packages.aarch64-linux.cups-usb-backend
```

The default installables are the three concrete store outputs we need before
touching activation:

- `packages.aarch64-linux.ipp-print-orchestrator`
- `packages.aarch64-linux.hp-uld-hp135a`
- `packages.aarch64-linux.cups-usb-backend`

The script performs this sequence:

1. Read `.env`.
2. Resolve `PI_HOST` and `PI_SSH_KEY_PATH` using the existing `remote-target`
   module.
3. Verify local `nix` and `ssh` are available.
4. Verify remote `nix --version` is available before attempting local aarch64
   builds. This avoids spending time building or realizing closures that cannot
   be copied to the Pi.
5. Build each configured aarch64 installable with:

   ```text
   nix build --no-link --print-out-paths <installable>
   ```

6. Copy the realized store paths to the Pi with:

   ```text
   NIX_SSHOPTS=<options from PI_SSH_KEY_PATH> nix copy --to ssh://<PI_HOST> <paths>
   ```

7. Send a remote Nu source through the existing `run-remote-nu-source` adapter
   and run read-only checks against the copied store paths.

### Added Remote Helper

`scripts/lib/remote.nu` now exports:

```text
ssh-options-command-string
```

This is a small adapter for tools like Nix that accept SSH options via a single
environment string instead of an argument vector. It reuses the existing
`ssh-options` implementation, so `PI_SSH_KEY_PATH`, batch mode, connection
timeouts, and future SSH option changes stay local to the SSH module.

This is a better seam than teaching every Nix script how to quote OpenSSH
arguments.

### Security/Operational Decision

The current repo documentation says scripts do not use `sshpass`,
`PI_PASSWORD`, or `PI_SUDO_PASSWORD`. Keep it that way.

The remote adapter should use SSH key auth. If sudo is required on the Pi, it
should rely on the existing operational assumption that the Pi user can run the
required sudo commands without storing a password in this repository.

Do not add password secrets to `.env`.

The implemented script follows this. It uses the same key-based SSH target as
the existing deploy scripts and does not add any password variables.

### Implemented Remote Check Level

#### Level 1: Store Execution

Implemented and safe, no CUPS mutation:

- verify remote `nix --version`;
- verify the agent wrapper exists in the runtime package;
- verify the CUPS PDF preflight wrapper and bundled filter JS exist in the
  runtime package;
- verify the HP ULD PPD exists in the driver package;
- verify the HP raster filter exists in the driver package;
- verify the supervised USB backend exists in the backend package;
- inspect the PPD for the PDF preflight and raster filter directives;
- run `sh -n` against the supervised USB backend;
- execute the PDF preflight wrapper with no CUPS arguments and require the
  expected usage error;
- run `ldd` on the HP raster filter when `ldd` is available on the Pi.

For proprietary filters that do not have a safe `--help`, prefer:

- `ldd`;
- `patchelf --print-needed`;
- `readelf`;
- or a controlled no-input invocation that is known not to touch USB.

Do not call a CUPS backend in job mode unless the expected behavior is proven.

The implemented script does not call the CUPS backend in job mode. It only runs
`sh -n` on the backend wrapper.

#### Level 2: No-Print CUPS Pipeline

Safe if it writes only to a temporary output file:

- `cupsfilter` with the store PPD;
- store PDF preflight filter;
- store HP `rastertospl`;
- output redirected to temporary file;
- no USB backend;
- no queue enablement;
- no Avahi advertisement changes.

This validates the rendering/filter pipeline without printing.

Not implemented yet. This should be the next live validation step after Nix is
installed on the Pi and Level 1 passes. It will need a small fixed sample PDF,
`cupsfilter` or direct filter pipeline invocation, and an output path under a
temporary directory. It must not target the USB backend.

#### Level 3: Live CUPS Configuration

Mutates CUPS but should not print:

- install/update queue;
- install Avahi service;
- generate TLS cert;
- inspect `printers.conf`;
- ensure queue is stopped/rejecting unless explicitly enabled.

This should be gated behind explicit script flags.

#### Level 4: Physical Print

Requires explicit confirmation of sheet count.

Rules from ADR 0001 still apply:

- do not run physical print tests casually;
- use one sheet unless explicitly authorized otherwise;
- avoid ad hoc `lp` tests;
- prefer orchestrator-shaped IPP `Print-Job`.

### Acceptance Criteria

- Local command exists and validates local/remote prerequisites.
- Remote SSH key resolution uses existing `.env` conventions.
- Remote command fails before build/copy if `nix` is missing on the Pi.
- Remote command is ready to copy Nix closures once the Pi has Nix installed.
- Remote command can inspect the store PPD once closures are copied.
- Remote command can execute a harmless store wrapper once closures are copied.
- No secrets are added to `.env`.
- No physical print happens unless explicitly requested.

### Live Probe Result

The Pi is reachable with the configured SSH key:

```text
PI_HOST=pi@print-server.local
PI_SSH_KEY_PATH exists locally
```

The live preflight currently fails because the Pi does not have Nix on its
`PATH`:

```text
bash: line 1: nix: command not found
```

That blocks actual `nix copy --to ssh://pi@print-server.local ...` and ARM store
execution. This is a real operational dependency, not a build-system design
blocker.

### Next Required Action For This Slice

Install Nix on the Pi, preferably as a multi-user daemon install, then rerun:

```text
nu scripts/check-nix-closures-live-to-pi.nu
```

Once remote `nix --version` works, the script should proceed to local aarch64
realization and closure copy. If the development machine still cannot realize
aarch64 outputs locally, the next design decision is whether to:

- configure the Pi as a remote aarch64 builder;
- build on the Pi from the repository source;
- or add another trusted aarch64 Linux builder/cache.

The preferred direction is a remote aarch64 builder or CI/cache path, because it
keeps the build graph Nix-owned and avoids returning to mutable installs on the
Pi.

## Next Slice 4: Add A Transitional Activation Adapter

### Problem

The Pi is not yet NixOS. A NixOS module is the desired end state, but we may need
a transitional mode that uses Nix packages on Raspberry Pi OS or another
non-NixOS host.

The transitional activation adapter should reduce mutable setup without
pretending the whole machine is declarative.

### Desired Interface

Add a package or app:

```text
apps.${system}.activate-pi-transitional
```

or a Nu local script:

```text
scripts/activate-nix-live-to-pi.nu
```

The adapter should:

- build/copy store packages;
- install symlinks from store paths into CUPS directories only where required by
  non-NixOS CUPS;
- install systemd units from generated files;
- write `/etc/ipp-print-orchestrator.env` from filtered local `.env`;
- restart or reload only affected units;
- preserve safe defaults.

### Engineering Constraint

Keep this adapter honest: it is an adapter for a mutable host, not the final
architecture.

It should be small and boring. Every substantial piece of logic should move into
one of:

- a Nix package,
- a generated config file,
- a NixOS module option,
- or a check.

### Acceptance Criteria

- No HP driver download on Pi.
- No PPD patching on Pi.
- No Bun install on Pi for packaged runtime path.
- Systemd units refer to store paths.
- CUPS filter/backend symlinks point to store outputs.
- Re-running activation is idempotent.
- Activation leaves printing disabled unless explicitly requested.

## Next Slice 5: Add NixOS Module

### Problem

The target architecture should not remain a collection of imperative install
steps. A NixOS module provides the right seam for describing system state:

- packages;
- users;
- systemd units;
- CUPS queue;
- Avahi advertisement;
- TLS watcher;
- environment;
- assertions;
- safe defaults.

### Desired Interface

Expose:

```text
nixosModules.ipp-print-orchestrator
```

Example shape:

```nix
{
  services.ippPrintOrchestrator = {
    enable = true;

    package = inputs.self.packages.${pkgs.system}.agent-service;

    user = "pi";
    group = "pi";

    dataDir = "/var/lib/ipp-print-orchestrator";

    bind = {
      host = "127.0.0.1";
      port = 4310;
    };

    printer = {
      profile = "hp135a-safe";
      queueName = "HP135a";
      enablePrinting = false;
      advertise = false;
      preserveJobFilesSeconds = 86400;
      maxJobTimeSeconds = 300;
      usbBackendTimeoutSeconds = 300;
    };

    observability = {
      enableOtlp = false;
      endpoint = null;
      headersFile = null;
    };
  };
}
```

Do not freeze this exact option schema until implementation begins, but preserve
the intent:

- small interface;
- safe defaults;
- domain terms rather than transport terms;
- assertions for safety invariants.

### Module Responsibilities

The module should own:

- service user/group, if desired;
- runtime directories;
- systemd service for the agent;
- systemd heartbeat timer/service;
- systemd TLS watcher service, if still needed;
- CUPS package/config integration;
- queue definition;
- Avahi service generation;
- environment file or systemd environment;
- dependency ordering;
- hardening options.

The module should not own:

- SSH hostnames;
- deployment key paths;
- rsync behavior;
- local developer `.env`;
- physical print confirmation flow.

### Assertions

The module should fail evaluation when unsafe or incoherent state is requested:

- HP profile requires `hp-uld-hp135a` package.
- HP profile requires PDF preflight filter.
- `enablePrinting = true` should require an explicit `advertise = true` or a
  similarly clear opt-in if clients are expected to discover the queue.
- `_ipp._tcp` advertisement should not be generated for this printer profile.
- queue retry policy must remain disabled/abort-job for `hp135a-safe`.
- `printer.queueName` must be non-empty and sane for CUPS.
- observability enabled requires endpoint/header configuration.

### Systemd Reasoning

Use systemd because it is the right runtime manager here.

Avoid `network-online.target` by default. Prefer:

- app service after local filesystem and maybe CUPS if the app probes CUPS at
  startup;
- Avahi/TLS watcher after Avahi/CUPS only if it actively reads those services;
- restart policies with bounded behavior;
- explicit hardening.

Candidate hardening for the app:

- `NoNewPrivileges=true`
- `PrivateTmp=true`
- `ProtectSystem=strict` if writable dirs are declared
- `ReadWritePaths` for data/spool paths as needed
- `RestrictAddressFamilies` if practical
- `SystemCallFilter` only after testing

Do not add hardening that breaks CUPS/USB interactions without tests.

### Acceptance Criteria

- A NixOS VM or eval test can instantiate the module.
- Generated unit files reference store paths.
- Generated Avahi service advertises only the intended secure service.
- Module assertions catch unsafe config.
- Existing Pi scripts can still operate during transition.

### Slice 5 Verification Result

The flake now exposes:

```text
nixosModules.ipp-print-orchestrator
```

Implemented module surface:

1. `services.ippPrintOrchestrator.enable`
2. explicit `package`, `hpDriverPackage`, and `cupsUsbBackendPackage` inputs
3. service user/group and runtime/cache directory options
4. HTTP bind host/port options
5. HP 135a safety-profile options for queue name, live printing, advertisement,
   CUPS job preservation, max job time, and supervised USB backend timeout
6. service timing options for heartbeat and reconciliation
7. OTLP logs/traces endpoint and header options
8. generated systemd service and heartbeat timer using store paths

The module deliberately does not replace the transitional non-NixOS Pi deploy
path yet. It is the declarative target interface for a future NixOS Pi or image,
while `scripts/deploy-live-to-pi.nu` remains the proven live deployment path on
the current Raspberry Pi OS host.

Assertions now fail evaluation for unsafe or incoherent state:

1. service enabled without an explicit package
2. `hp135a-safe` without the HP ULD driver package
3. `hp135a-safe` without the supervised USB backend package
4. live printing without explicit advertisement opt-in
5. enabled OTLP without logs/traces endpoints and headers

Verified locally:

```text
nu scripts/tests.nu
nix build .#checks.x86_64-linux.nixos-module --print-build-logs
nix flake check --print-build-logs
```

The `nixos-module` check instantiates the module through Nixpkgs'
`nixos/lib/eval-config.nix`, checks that `ExecStart` uses the packaged store
wrapper, checks that heartbeat uses store `curl`, and proves the printing and
OTLP assertion failures are rejected.

## Next Slice 6: Replace Deployment Flow

### Problem

Current deployment uses:

```text
bun run build
rsync repo to Pi
bun install --production on Pi
install systemd units from checked-in files
restart services
```

This should become:

```text
nix build
nix copy
activate
smoke
```

### Desired Interface

Potential command:

```text
nu scripts/deploy-nix-live-to-pi.nu
```

The script should:

1. Build target outputs for `aarch64-linux`.
2. Copy closures to the Pi.
3. Run transitional activation or NixOS switch depending on target mode.
4. Run smoke checks.
5. Print exact store paths deployed.

### Deployment Modes

#### Transitional Non-NixOS Mode

Used while the Pi remains mutable.

This mode:

- copies closures;
- installs symlinks/unit files;
- reloads systemd;
- avoids apt and Bun installs;
- keeps root-owned paths explicit.

#### NixOS Mode

Used when the Pi is NixOS.

This mode:

- builds a system closure;
- copies it to Pi;
- activates it with `nixos-rebuild --target-host` or equivalent;
- does not manually install units.

### Acceptance Criteria

- `deploy-nix-live-to-pi` does not call `bun install` on Pi.
- `deploy-nix-live-to-pi` does not download HP ULD on Pi.
- `deploy-nix-live-to-pi` prints exact package/system paths.
- Rollback path is documented.
- Smoke checks run after activation.
- Existing deploy remains available until Nix deploy is proven.

### Slice 6 Verification Result

The transitional non-NixOS closure deploy is now active through
`scripts/deploy-live-to-pi.nu`.

Verified on the live Pi:

1. `scripts/deploy-live-to-pi.nu` builds the aarch64 runtime, HP ULD driver, and
   supervised USB backend closures.
2. The closures copy to the Pi store.
3. `scripts/check-nix-closures-live-to-pi.nu` verifies the copied store paths on
   the Pi before service activation.
4. `scripts/deploy-live-from-pi.nu` no longer calls `bun install` or reads
   `node_modules`.
5. `scripts/install-systemd-live-from-pi.nu --runtime-path <store-path>` renders
   `ipp-print-orchestrator.service` with `ExecStart=<store>/bin/ipp-print-orchestrator-agent`.
6. `systemctl cat ipp-print-orchestrator.service` confirmed that the active
   service runs from `/nix/store`.
7. `scripts/smoke-test-live-to-pi.nu` passed after aligning
   `IPP_ORCH_PRINTER_NAME` with the real CUPS queue `HP135a`.

This keeps the mutable Pi as a deployment target, not a build machine. The repo
directory on the Pi remains useful for operator scripts, CUPS setup helpers, and
state-relative service working directory behavior. The service executable itself
now comes from an immutable Nix output.

## Next Slice 7: Retire Mutable Script Responsibilities

After Nix packages/modules are proven, remove or shrink old mutable behavior.

Do this gradually:

1. Mark old bootstrap/setup/deploy scripts as legacy in README.
2. Replace HP driver install path with Nix package usage.
3. Replace CUPS backend install path with Nix package usage.
4. Replace systemd string replacement with generated unit files.
5. Replace Pi `bun install` with Nix package deployment. Done for app deploy;
   remaining Bun usage belongs only to legacy/manual update helpers until those
   are retired.
6. Keep diagnostic/watch/smoke Nu scripts.
7. Delete dead install/update code only after equivalent Nix path has live Pi
   verification.

Never delete a live recovery script before the replacement has been exercised on
the Pi.

### Slice 7 Verification Result

The active CUPS setup path now consumes copied Nix closures instead of rebuilding
or downloading printer artifacts on the Pi.

Implemented behavior:

1. `scripts/setup-cups-live-to-pi.nu --enable-printing` builds, copies, and
   verifies the same runtime, HP ULD driver, and supervised USB backend closures
   used by deploy.
2. `scripts/setup-cups-live-from-pi.nu` requires `--runtime-path`,
   `--driver-path`, and `--backend-path` for full setup.
3. The Pi-side CUPS setup no longer downloads HP ULD, extracts HP archives,
   patches PPDs, installs `/opt/smfp-common`, or builds/syncs a local CUPS
   filter bundle.
4. `/usr/lib/cups/filter/ipp-pdf-preflight-to-spl` is a symlink to the copied
   runtime closure.
5. `/usr/lib/cups/filter/rastertospl` and `/usr/lib/cups/filter/pstosecps` are
   symlinks to the copied HP ULD driver closure.
6. `/usr/lib/cups/backend/ipp-orch-usb` is a root-owned launcher with CUPS
   root-backend permissions that execs the copied backend closure.
7. `/usr/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd` is copied from the Nix
   HP ULD package and verified to contain the PDF preflight filter, raster
   filter, 8-bit grayscale mode, and safe 300x300 standard-quality line.

Verified on the live Pi:

```text
nu scripts/setup-cups-live-to-pi.nu --enable-printing
nu scripts/smoke-test-live-to-pi.nu
```

The smoke check passed with CUPS reachable, printer attached, queue available,
and queue state idle. No test page was printed.

## Cache Strategy

### Current Builder Decision

The live Pi must not be used as the aarch64 builder for the JavaScript runtime
package.

The measured failure mode was precise:

- the Pi has roughly 416 MiB of RAM and 415 MiB of swap;
- the initial root `bun.lock` build tried to realize a broad development graph;
- the narrowed runtime lock still realizes about 100 JavaScript packages;
- `@opentelemetry/sdk-node` remains part of the required runtime graph and pulls
  broad OpenTelemetry SDK machinery;
- the build became swap-bound on the Pi even with `--max-jobs 1 --cores 1`;
- no OOM occurred, but progress was too slow and resource pressure was too high
  for this to be an acceptable deployment path.

Do not make OpenTelemetry optional to solve this. Observability is part of the
service contract. The correct build-system fix is to build the aarch64 closures
on either a suitable aarch64 builder or local QEMU/binfmt emulation, cache or
copy those closures, and use the Pi only as a target that substitutes/verifies
store paths.

The current adapter split is:

```text
nu scripts/build-nix-closures-live-to-pi.nu
  when AARCH64_BUILDER_HOST=local:
    builds aarch64 package outputs locally through QEMU/binfmt
  otherwise:
    stages source on AARCH64_BUILDER_HOST
    builds aarch64 package outputs there
    copies closures builder -> local store
  copies closures local store -> Pi
  invokes the Pi verifier

nu scripts/check-nix-closures-live-to-pi.nu
  requires explicit /nix/store paths
  verifies those paths already exist on the Pi
  performs read-only executable, PPD, filter, backend, and linker checks
```

Required `.env` keys for the builder path:

```text
PI_HOST=pi@print-server.local
PI_SSH_KEY_PATH=~/.ssh/ipp-print-orchestrator-pi
AARCH64_BUILDER_HOST=local
AARCH64_BUILDER_SSH_KEY_PATH=...
```

`AARCH64_BUILDER_HOST=local` requires `qemu-aarch64` registration through
`binfmt_misc` and `aarch64-linux` in Nix `extra-platforms`. An SSH builder host
must be distinct from `PI_HOST`. The script rejects the Pi target as the builder
to keep this invariant explicit.

A new helper is available to normalize a fresh machine setup:

```bash
nu scripts/prepare-aarch64-builder.nu
```

Run it once after setting `.env` and before the first `AARCH64_BUILDER_HOST=local` build.

### Public Cache

Most base packages should come from `cache.nixos.org`:

- Bun;
- Deno, if used;
- `nodejs-slim`;
- CUPS;
- Poppler;
- Ghostscript;
- Nushell;
- OpenSSL;
- OpenSSH;
- rsync.

### Private/Project Cache

Project-specific outputs should eventually be cached:

- agent package;
- CUPS filter package;
- HP ULD package, if license permits redistribution through the chosen cache;
- generated NixOS system closures;
- checks that are expensive but deterministic.

Before caching HP ULD publicly, verify the license. Until then, prefer local
copying or a private cache with access controls.

### CI Cache Goals

CI should eventually run:

```bash
nix flake check
nix build .#packages.aarch64-linux.ipp-print-orchestrator
nix build .#packages.aarch64-linux.hp-uld-hp135a
nix build .#packages.aarch64-linux.cups-usb-backend
```

If CI cannot execute aarch64 code, it can still build/copy/check closures. The
Pi-specific execution checks remain a separate live hardware workflow.

## Testing Strategy

### Local Deterministic Tests

Run on every developer machine and CI:

- Nix formatting.
- Flake evaluation.
- Package builds.
- PPD invariant checks.
- Nushell tests.
- TypeScript typecheck once JS packaging is integrated.
- Unit tests.
- Filter fixture tests.

### Local No-Hardware Integration Tests

Run without physical printer:

- CUPS filter conversion to temporary files.
- IPP codec/client tests.
- systemd unit generation tests.
- Avahi XML generation tests.
- NixOS module eval tests.

### Remote Pi Tests

Run on ARM and live OS:

- closure copy;
- store binary execution;
- dynamic linker checks;
- no-print filter pipeline;
- CUPS queue config inspection;
- service start/health;
- TLS identity repair/check;
- Avahi advertisement check.

### Physical Printer Tests

Manual, explicit, rare:

- one known-safe PDF;
- explicit sheet count;
- exact submission path recorded;
- spool/log inspection afterward.

## Documentation Updates Required

As slices land, update:

- `README.md` build/deploy sections;
- `docs/adr-0001-hp135a-cups-driver-and-safety.md` if safety decisions change;
- this plan document;
- any new ADRs for irreversible decisions.

Candidate ADRs:

- Use Nix flakes as the project build interface.
- Keep Nushell as operator adapter, not build system.
- Keep Node for initial CUPS filter packaging; defer Deno to hardening spike.
- Transitional non-NixOS activation versus immediate NixOS migration.

## Open Questions

### Should The Pi Become NixOS?

Strong long-term yes, because the target state is system-level:

- CUPS;
- Avahi;
- systemd;
- users/groups;
- printer driver;
- TLS cert generation;
- queue policy.

Nix on Raspberry Pi OS improves package deployment but does not fully solve
system configuration drift. NixOS solves more of the actual problem.

Short-term, a transitional Nix-on-existing-OS path is still useful because it
reduces risk and lets us validate packages on the current live Pi.

### Which JS Packaging Strategy Wins?

Unknown until tested.

Do not decide by preference. Decide by whether the output:

- builds without ambient state;
- runs without unresolved imports;
- cross-builds or builds for aarch64;
- copies to the Pi cleanly;
- starts and passes health checks;
- does not make developer workflow worse.

### Is Deno Worth It For The CUPS Filter?

Not yet.

Deno's permission model is attractive for a safety-critical filter, but it is a
runtime migration. Keep it as a spike after the Node-based Nix package exists.

### Should Cab/Cull Ideas Influence This Repo?

Only at the level of principles:

- graph-shaped build outputs;
- typed configuration;
- explicit contexts;
- inspectable derivations;
- deep modules with narrow interfaces.

Do not introduce Cab or experimental tooling into this production path.

## Definition Of Done For The Refactor

The build-system refactor is done when:

- `nix flake check` is the authoritative local verification command;
- the agent service is a Nix package;
- the CUPS filter is a Nix package;
- HP ULD driver/PPD comes only from a pinned Nix derivation;
- deploy copies Nix closures instead of rsyncing build products and installing
  dependencies on the Pi;
- systemd units reference store paths;
- CUPS setup no longer downloads or patches driver artifacts on the Pi;
- live Pi no-print checks pass from store paths;
- one explicit physical printer validation passes;
- old mutable install paths are removed or clearly marked legacy;
- README documents the new path.

## Immediate Next Action

The previous immediate action is complete:

```bash
nu scripts/prepare-aarch64-builder.nu
nu scripts/build-nix-closures-live-to-pi.nu
nu scripts/deploy-live-to-pi.nu
nu scripts/smoke-test-live-to-pi.nu
```

Verified acceptance criteria:

1. The builder realizes `.#packages.aarch64-linux.ipp-print-orchestrator`.
2. The builder realizes `.#packages.aarch64-linux.hp-uld-hp135a`.
3. The builder realizes `.#packages.aarch64-linux.cups-usb-backend`.
4. The resulting closures copy to the local store.
5. The resulting closures copy to the Pi store.
6. The Pi verifier passes using only explicit store paths.
7. No package build runs on the live Pi.
8. Deploy activates the copied runtime path through systemd.
9. Live smoke passes against the real CUPS queue and attached printer.

The next concrete step is cache work and, separately, enabling real telemetry
export by setting the production OTLP/Axiom configuration in local `.env` before
deploy. The build-system refactor can now build, copy, deploy, and verify
store-backed service/CUPS artifacts on the live Pi without using the Pi as the
builder.

## Completed Follow-Up: HP 135a PDF Guard Incident

Date: 2026-06-21

After the Nix-backed CUPS setup was live, a one-page Android-submitted PDF
caused the printer to emit unexpected paper. The preserved CUPS spool and logs
showed one IPP `Print-Job`, no CUPS retry storm, `pdfinfo` `Pages: 1`, and a
final `rastertospl` `PAGE: 1 1`. Ghostscript still logged
`Processing page 2...`.

The first hardening pass rejected that Ghostscript progress line. That stopped
unsafe output but overblocked the same document. The corrected invariant is:

- final `rastertospl` `PAGE:` lines are the physical page-count authority;
- the final driver page count must match `pdfinfo`;
- final SPL/QPDL output must contain `@PJL SET XIGNOREFF=ON`;
- HP PPD defaults must include `*DefaultJCLSkipBlankPages: True`;
- Ghostscript `Processing page N...` lines are diagnostics unless the final
  driver output also violates a safety invariant.

Implemented code changes:

- `CupsFilterOutputGuard` keeps final driver page-count checks and SPL
  blank-page suppression detection.
- `cups-pdf-preflight-filter` stages SPL/QPDL, reads the header, rejects missing
  `XIGNOREFF=ON`, and then applies the final page-count/size guard.
- `hp-uld-hp135a` patches the PPD default from
  `*DefaultJCLSkipBlankPages: False` to `True`.
- `hp-uld-hp135a-ppd` fails the flake check if the unsafe PPD default survives.

Verification:

- focused guard tests passed;
- `nu scripts/tests.nu` passed;
- `nix flake check --print-build-logs` passed;
- the problematic preserved spool file replayed through the Nix runtime filter
  with status 0, one final `PAGE: 1 1`, `@PJL SET XIGNOREFF=ON`, and
  `Guarded printer output accepted`;
- the live Pi was deployed with runtime
  `/nix/store/sjyrin4vvbr684jw6ji2b33qh5zdhkcm-ipp-print-orchestrator-0.1.0`;
- CUPS was reconfigured from copied store paths, no test page was printed, the
  queue was idle/enabled/accepting, the app health endpoint returned OK, and the
  HP USB device was visible.

## Completed Follow-Up: First-Print Latency

Date: 2026-06-21

After the first successful phone prints, the first one-page PDF felt slow enough
to investigate with the preserved CUPS jobs instead of guessing. The replay loop
was no-paper: copy the preserved `/var/spool/cups/d*` input on the Pi, run the
same Nix-store CUPS filter chain, and write the generated SPL/QPDL to `/tmp`.

Observed live CUPS windows:

- Job 8 was a 986,713 byte PDF from the phone. CUPS started the filter/backend
  at `2026-06-21 22:19:41 +0100` and marked it complete at `22:20:08`, so the
  server-side filter/backend window was about 27 seconds.
- Job 9 was a 233,016 byte PDF. CUPS started the filter/backend at `22:20:16`
  and marked it complete at `22:20:29`, so the server-side window was about
  13 seconds.

Measured bottlenecks:

- Before fixing fontconfig cache state, the larger PDF replay took about
  10.8 seconds through the full preflight filter and Ghostscript emitted
  44 `Fontconfig error: No writable cache directories` messages.
- Splitting the pipeline showed the expensive conversion child was `gstoraster`.
  For the larger PDF it took about 6.1 seconds with fontconfig errors, while
  `pdftopdf` was about 0.6 seconds and `rastertospl` was about 1.6 seconds.
- The Pi had no `/var/cache/fontconfig`, which is one of the cache directories
  Ghostscript reported. Creating it as `root:lp` with setgid group-write
  permissions removed the fontconfig errors and reduced the larger PDF's raster
  stage to about 2.4-3.2 seconds in no-print replays.
- With exact deployed filter options and writable fontconfig cache, the child
  conversion stages measured about 4.1 seconds total for the larger PDF and
  about 2.0 seconds total for the smaller PDF.
- The bundled Node filter import/validation path costs about 1 second on the Pi;
  plain Node startup costs about 0.2 seconds. That is visible but not the main
  first-print delay.

The setup script now creates both the app cache directory and
`/var/cache/fontconfig` for the CUPS `lp` execution path. The remaining live
delay is mostly outside pure PDF conversion: CUPS/backend/USB/printer
consumption accounted for roughly 8-16 seconds in the two observed jobs, with
some client upload/spooling time visible before the filter starts.
