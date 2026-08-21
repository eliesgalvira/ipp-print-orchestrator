# ADR 0001: HP Laser MFP 135a CUPS Driver And Print Safety

Date: 2026-05-05

## Status

Accepted.

## Context

The live printer is an HP Laser MFP 135a attached by USB to a Raspberry Pi Zero
2 W print server. Family phones discover the queue over mDNS/IPP and submit
print jobs through Android's print flow. CUPS owns every accepted job and its
lifecycle.

The printer itself was not the root problem: photocopying worked. The failures
were in the CUPS driver/filter path for documents containing images, logos,
filled regions, or scanned PDF content.

Observed failures during diagnosis:

- Generic PCL/PCL XL via Gutenprint could print simple content, but image-heavy
  documents produced corrupted output, including gibberish symbols and noisy
  page data.
- SpliX/Samsung-compatible test queues did not produce usable output for this
  printer.
- HP Unified Linux Driver `rastertospl` with the official 8-bit grayscale PPD
  fixed basic test-page output, but large scanned/image-heavy PDFs remained a
  risk at the default 600x600 render resolution.
- Forcing the PPD to 1-bit grayscale was wrong. It reduced payload size, but
  caused scanned pages to compress horizontally because the raster row layout no
  longer matched what `rastertospl` expects.
- Ad hoc `lp` test commands caused dangerous behavior because they did not
  match Android's IPP shape and could trigger repeated or malformed
  output.
- On 2026-06-19, Android submitted multiple direct IPP `Print-Job` requests for
  PDFs after warning that an encrypted/protected file could not be printed. CUPS
  accepted the jobs, emitted PDF parser warnings for several inputs, and the
  USB printer interface repeatedly detached/reappeared while the printer emitted
  bad pages. The default no-retention CUPS configuration removed the job files
  before forensic inspection.
- On 2026-06-30, Android printed a job successfully but still showed a printer
  error notification. CUPS reported the job as `completed` with
  `job-completed-successfully`, but `Get-Printer-Attributes` exposed stale and
  contradictory metadata:
  `printer-state-message = "Sending data to printer."` while
  `printer-state = idle`, and two `media-default` attributes in the same
  response: `A4` from queue options and `na_letter_8.5x11in` from the HP vendor
  PPD's internal defaults. `ipptool` flagged the response as a duplicate
  attribute failure. The successful job also preserved a benign CUPS filter
  warning in `job-printer-state-message`:
  `ppdFilterLoadPPD: Last filter could not get determined, page logging by the
  PDF filter turned off.` Android/Mopria can surface that kind of status message
  as a user-visible error even when the backend finished and the paper output was
  correct.
- During the same 2026-06-30 investigation, the Pi and local mDNS browse only
  showed the explicit Avahi service as `HP Laser MFP 135a @ print-server` with
  hostname `print-server.local`. No live `print-server-2.local` advertisement
  was observed. The CUPS certificate SAN matched `print-server.local` and the
  current IP addresses, but not `print-server-2.local`; a client using a cached
  or conflict-renamed `print-server-2.local` endpoint would therefore see a TLS
  hostname mismatch. Treat `print-server-2` reports as a discovery/cache/TLS
  identity symptom unless a live Avahi collision is observed.

The 2026-06-30 metadata failure was not primarily a CUPS source-code bug. CUPS
was permissive enough to expose the inconsistent state it was given: a queue
configured for A4 over a vendor PPD whose defaults still said Letter, plus
subfilter stderr that the wrapper forwarded back to CUPS. That behavior is
unpleasant for Android clients, and CUPS arguably could canonicalize or suppress
some of it better, but the actionable root cause is under this repository's
control: our setup and filter boundaries allowed operationally misleading
metadata to leak into the public IPP surface.

## Decision

Use HP's Unified Linux Driver for this printer:

- Install HP ULD package `uld-hp_V1.00.39.12_00.15`.
- Use the matching `HP_Laser_MFP_13x_Series.ppd`.
- Install and use the HP/Samsung SPL CUPS filter `rastertospl`.
- Do not use generic PCL/PCL XL drivers for this printer.
- Do not use SpliX for this printer.

Patch the HP PPD conservatively:

- Keep grayscale raster mode at `cupsBitsPerColor 8`.
- Do not force 1-bit grayscale.
- Replace the standard option's effective hardware resolution from
  `HWResolution[600 600]` to `HWResolution[300 300]`.
- Normalize the HP vendor PPD's default paper declarations to A4 before
  installing either the driver PPD or the queue PPD:
  `*DefaultPageSize`, `*DefaultPageRegion`, `*DefaultImageableArea`, and
  `*DefaultPaperDimension`. The PPD is the only source of the page default.
  Never set queue-level `PageSize`, `PageSize-default`, or `media-default`:
  CUPS publishes queue options alongside the PPD-derived value, producing two
  `media-default` attributes that Android rejects. This recurred on 2026-08-14
  from options persisted in `printers.conf` by an earlier activation, so
  activation resets every persisted queue option before applying its own.
- Perform that normalization in the Nix derivation. Activation copies the
  immutable PPD and does not maintain a second rewrite implementation.
- Gate exposure on the IPP contract. Activation configures the queue disabled
  and unshared, runs the official `ipptool get-printer-attributes.test` against
  `ipp://localhost`, and only then enables, shares, and advertises the queue.
  The same test then runs against the public IPPS endpoint; if it fails, the
  queue is rolled back to the safe state instead of staying exposed.
- Keep the driver's existing `Quality 600dpi` option name for compatibility with
  CUPS defaults, but render that default at 300x300.
- Add a queue-specific `application/pdf` CUPS filter named
  `ipp-pdf-preflight-to-spl`. It preflights the original PDF with `pdfinfo`,
  rejects encrypted/protected or unreadable PDFs, then invokes the existing
  `pdftopdf -> gstoraster -> rastertospl` pipeline for accepted PDFs.
- Stage final SPL/QPDL output to a temporary file before handing bytes to the
  backend. Validate that `rastertospl` reports exactly the expected page count,
  reject multiple-copy jobs, force the known safe PDF options, and cap final
  output size per page.
- Force the HP/Samsung blank-page/form-feed suppression path by setting
  `JCLSkipBlankPages=True` in the CUPS filter options and patching the queue PPD
  default to `*DefaultJCLSkipBlankPages: True`. Verify the staged SPL/QPDL
  header contains `@PJL SET XIGNOREFF=ON` before bytes are accepted.
- Treat the final `rastertospl` `PAGE:` lines as the page-count authority for
  physical output. Ghostscript progress lines such as `Processing page 2...`
  are diagnostic input, not a rejection criterion by themselves, because
  Ghostscript can log an extra progress page while the CUPS raster stream and
  final SPL output still contain exactly one driver-reported page.
- Do not forward raw subfilter stderr to CUPS. The wrapper may use subfilter
  stderr internally for guard decisions and diagnostics, but the public stderr
  stream returned to CUPS must be curated. Pass through only page-accounting
  lines such as `PAGE:` and `ATTR: job-media-progress`; emit wrapper-owned
  `INFO`, `ERROR`, and `STATE` lines for real accepted/rejected decisions. This
  prevents benign implementation warnings from becoming `printer-state-message`
  or `job-printer-state-message` values that Android displays as printer errors.
- Route the queue through the `ipp-orch-usb` backend wrapper instead of the raw
  CUPS `usb` backend. The wrapper stages filter output before touching USB,
  rejects empty filter output immediately, delegates non-empty payloads to the
  real USB backend with the original `usb://` URI, and deauthorizes the HP USB
  device if that backend wedges. Keep the wrapper as a checked-in script at
  `scripts/cups/backend/ipp-orch-usb`, not as generated shell embedded in Nu.
  Install it with root-only execute permission, matching the real CUPS `usb`
  backend, so CUPS runs it with enough privilege to delegate to that backend.

Configure CUPS defensively:

- Disable CUPS' built-in DNS-SD browsing and install an explicit Avahi
  `_ipps._tcp` service for the queue. Do not advertise the unencrypted `_ipp._tcp`
  path to Android.
- When enabling the queue, set a neutral queue reason such as `Ready.` so stale
  transient messages like `Sending data to printer.` are not left attached to an
  idle printer and exposed through IPP.
- `ErrorPolicy=abort-job`
- `JobRetryLimit=0`
- `JobRetryInterval=0`
- `MaxJobs=20`
- `MaxJobsPerPrinter=1`
- `MaxJobTime=300`
- `PreserveJobFiles=86400`
- `PreserveJobHistory=86400`
- `AutoPurgeJobs=Yes`
- `JobKillDelay=5`

Own the TLS identity used by Android and other IPP clients:

- Start Avahi before CUPS setup reads the advertised mDNS hostname.
- Generate a CUPS self-signed server certificate whose SANs include the static
  system hostname, the current Avahi hostname/FQDN, `localhost`, and local IP
  addresses.
- Verify every generated DNS/IP SAN after enabling the queue.
- Provide a `--repair-tls-only` setup path that can refresh the certificate and
  restart CUPS without clearing the spool or reconfiguring the queue.
- Run a small systemd watcher that verifies the served certificate covers every
  current DNS name and IP address, then reruns `--repair-tls-only` when one is
  missing. Extra SANs are harmless and must not trigger repair when an address
  temporarily disappears during a network interruption.

The setup script is responsible for installing the driver, patching the PPD,
configuring the queue, and clearing the spool. By default it leaves CUPS stopped,
disabled, unshared, and rejecting jobs. It only enables and advertises the queue
when run with `--enable-printing`.

The local wrapper must sync the target-side setup script and its Nu library
dependencies to the Pi before executing it. Running a stale script on the Pi can
silently reinstall an old unsafe PPD.

The public IPP surface is treated as part of the product contract with Android,
not as incidental CUPS internals. Any CUPS/PPD/filter state visible through
`Get-Printer-Attributes`, `Get-Job-Attributes`, or DNS-SD TXT records must be
boring, internally consistent, and client-safe. A job can physically print while
the Android UX still reports failure if this metadata is misleading.

CUPS is the sole job ingress, spool, and lifecycle authority. The observer has
no HTTP job routes, local blob store, job repository, retry queue, or mirrored
event outbox. Its health and telemetry failures must not gate CUPS printing.

The local IPP decoder preserves ordered groups and ordered attributes, including
repeated complete attributes. Network responses containing a repeated attribute
within one group fail with a typed error. Queue activation also runs CUPS'
official `get-printer-attributes.test` through `ipptool` against the advertised
IPPS endpoint; a failure leaves activation unsuccessful.

## Consequences

The live queue should render through:

```text
PDF -> pdftopdf -> gstoraster -> CUPS raster, 300x300, 8-bit grayscale -> rastertospl -> guarded SPL/QPDL file -> supervised USB backend -> USB printer
```

For PDF jobs, that pipeline is now enclosed by `ipp-pdf-preflight-to-spl`, so
the HP/Samsung driver never receives PDFs that the local preflight cannot
classify as readable and unencrypted. The filter also refuses to stream final
printer bytes until it has a complete driver output file with a matching final
driver page count, bounded size, and the required SPL/QPDL
`@PJL SET XIGNOREFF=ON` blank-page suppression command.

This reduces payload size for scanned/image-heavy pages while preserving the
raster format expected by `rastertospl`. It also prevents CUPS from retrying a
bad job repeatedly if the backend or printer errors.

On 2026-06-21, a one-page Microsoft Print To PDF document submitted from
Android caused the printer to emit unexpected paper. CUPS showed one `Print-Job`
request and no retry storm. The preserved spool file had `pdfinfo` `Pages: 1`;
`pdftopdf` also produced a one-page normalized PDF; Ghostscript logged
`Processing page 1...` and `Processing page 2...`; `rastertospl` reported only
`PAGE: 1 1`. The old accepted SPL header contained `@PJL SET XIGNOREFF=OFF`.
After the fix, a no-print replay of the same spool file produced one
driver-reported page, `@PJL SET XIGNOREFF=ON`, and an accepted guarded SPL file.
This is why the invariant is expressed as "final driver page count must match
PDF metadata and SPL blank-page suppression must be enabled", rather than
"Ghostscript must not log an extra processed page".

The USB backend wrapper exists because a valid one-page render can still leave
the CUPS USB backend stuck in the device phase. In that state, stopping CUPS may
wait for systemd's service timeout while the printer is physically misbehaving.
The wrapper makes that failure bounded and detaches the HP USB device on timeout.
The timeout must be long enough to cover both printer backpressure and multi-page
USB transfer time; the default is five minutes after an 11-page job showed the
previous 60 second bound could kill a valid SPL stream mid-transfer.

Preserving job files for one day increases local forensic capability after a
printer incident. The tradeoff is that recent documents may remain under the
root-owned CUPS spool for up to 86400 seconds; this is intentional but bounded.

Image quality may be lower than true 600x600 grayscale, but the priority for
this printer is reliable monochrome document output without runaway pages or
garbled SPL streams.

The A4 normalization and stderr-curation rules are defensive compatibility
layers around CUPS. They do not fork or patch CUPS itself. CUPS remains the IPP
scheduler and queue owner, but this repository owns the correctness of the
metadata and filter messages it feeds into CUPS. This keeps the fix small,
deployable, and testable without depending on upstream CUPS behavior changes.

## Operational Rules

Do not run physical print tests casually.

Allowed safe checks:

- `nu scripts/setup-cups-live-to-pi.nu --stop-only`
- `nu scripts/setup-cups-live-to-pi.nu`
- `cupsfilter` conversions redirected to a temporary file
- `lpstat`, PPD inspection, CUPS config inspection, and spool inspection

`nu scripts/setup-cups-live-to-pi.nu --enable-printing` exposes the queue to
clients and must be treated as a live-operation step, not a passive check,
especially when Android may still have a local queued job.

Physical print tests require explicit confirmation of the exact sheet count.
Use one sheet unless the user explicitly authorizes more.

Avoid local `lp` for validation. The working shape is a single IPP `Print-Job`
with the PDF attached to the request, `copies=1`, `print-scaling=none`,
`orientation-requested=portrait`, `sides=one-sided`, and monochrome output. The
guarded CUPS path must accept or reject that shape directly.

## Verification Performed

After applying the accepted setup:

- The live PPD contained `cupsBitsPerColor 8`.
- The live PPD contained `HWResolution[300 300]` for the standard quality path.
- The live PPD contained the `ipp-pdf-preflight-to-spl` PDF filter.
- The live PPD contained `*DefaultJCLSkipBlankPages: True`.
- The queue was idle, enabled, accepting, and shared.
- The CUPS spool was empty before validation.
- A no-print `cupsfilter` conversion using the installed PPD called Ghostscript
  with `-r300x300 -dcupsBitsPerColor=8`.
- `rastertospl` exited cleanly during that no-print conversion.
- `nu scripts/tests.nu` passed locally.
- `nix flake check --print-build-logs` passed locally.
- A no-print replay of the problematic 2026-06-21 Android PDF through the Nix
  runtime filter returned status 0, emitted one final `PAGE: 1 1`, emitted
  `@PJL SET XIGNOREFF=ON`, and logged `Guarded printer output accepted`.

## Rejected Alternatives

Generic PCL/PCL XL driver:

Rejected because image/logo/scanned PDF content produced corrupted output even
though simple text could appear to work.

SpliX/Samsung-compatible queue:

Rejected because it did not produce usable physical output for the HP Laser MFP
135a in this environment.

1-bit grayscale PPD patch:

Rejected because it changes the raster row format in a way this `rastertospl`
path does not handle correctly. The visible failure was horizontal compression
of scanned PDF output.

Ad hoc `lp` physical tests:

Rejected for this printer because they can exercise a different job submission
shape from Android printing and previously caused runaway output.
