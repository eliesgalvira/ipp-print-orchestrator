# ipp-print-orchestrator Agent Guide

## Domain language

CUPS queue observation, USB device state, and printer readiness changes must use
the terms defined in `CONTEXT.md`.

## Printing

Print with `nu scripts/print-live-to-pi.nu file.pdf`, never `lp` or a workstation CUPS queue (ADR-0001). Confirm the exact sheet count with the user before any physical print.

## Nushell Script Notes

When editing Nushell helpers in `scripts/`, remember that environment mutations inside a normal `def` do not persist to the caller. If a helper must change caller-visible shell state such as `$env.PATH`, other `$env.*` values, or the caller's working environment for later commands, define it with `def --env` or `export def --env`.

This matters for any dependency setup helper, not just Bun. The current example is `ensure-user-bun-on-path` in `scripts/lib/remote.nu`, which must remain an env-mutating helper so later `bun` commands in the caller can resolve correctly during non-login remote Nushell runs.
