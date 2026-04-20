# ipp-print-orchestrator Agent Guide

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect repository is cloned to `.reference/effect/` for reference.
Use it to inspect real implementations, APIs, and usage patterns before inventing architecture or syntax.

## Nushell Script Notes

When editing Nushell helpers in `scripts/`, remember that environment mutations inside a normal `def` do not persist to the caller. If a helper must change caller-visible shell state such as `$env.PATH`, other `$env.`* values, or the caller's working environment for later commands, define it with `def --env` or `export def --env`.

This matters for any dependency setup helper, not just Bun. The current example is `ensure-user-bun-on-path` in `scripts/lib/remote.nu`, which must remain an env-mutating helper so later `bun` commands in the caller can resolve correctly during non-login remote Nushell runs.