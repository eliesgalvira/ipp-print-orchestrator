# ADR 0001: HP Laser MFP 135a CUPS Driver And Print Safety

Date: 2026-05-05

## Status

Accepted.

## Context

The live printer is an HP Laser MFP 135a attached by USB to a Raspberry Pi Zero
2 W print server. Family phones discover the queue over mDNS/IPP and submit
print jobs through Android's print flow. The orchestrator also submits PDF jobs
to the same CUPS queue.

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
  match the phone/orchestrator IPP shape and could trigger repeated or malformed
  output.
- On 2026-06-19, Android submitted multiple direct IPP `Print-Job` requests for
  PDFs after warning that an encrypted/protected file could not be printed. CUPS
  accepted the jobs, emitted PDF parser warnings for several inputs, and the
  USB printer interface repeatedly detached/reappeared while the printer emitted
  bad pages. The default no-retention CUPS configuration removed the job files
  before forensic inspection.

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
- Keep the driver's existing `Quality 600dpi` option name for compatibility with
  CUPS defaults, but render that default at 300x300.
- Add a queue-specific `application/pdf` CUPS filter named
  `ipp-pdf-preflight-to-spl`. It preflights the original PDF with `pdfinfo`,
  rejects encrypted/protected or unreadable PDFs, then invokes the existing
  `pdftopdf -> gstoraster -> rastertospl` pipeline for accepted PDFs.

Configure CUPS defensively:

- `ErrorPolicy=stop-printer`
- `JobRetryLimit=0`
- `JobRetryInterval=0`
- `MaxJobs=20`
- `MaxJobsPerPrinter=1`
- `MaxJobTime=300`
- `PreserveJobFiles=86400`
- `PreserveJobHistory=86400`
- `AutoPurgeJobs=Yes`
- `JobKillDelay=5`

The setup script is responsible for installing the driver, patching the PPD,
configuring the queue, and clearing the spool. By default it leaves CUPS stopped,
disabled, unshared, and rejecting jobs. It only enables and advertises the queue
when run with `--enable-printing`.

The local wrapper must sync the target-side setup script and its Nu library
dependencies to the Pi before executing it. Running a stale script on the Pi can
silently reinstall an old unsafe PPD.

## Consequences

The live queue should render through:

```text
PDF -> pdftopdf -> gstoraster -> CUPS raster, 300x300, 8-bit grayscale -> rastertospl -> SPL/QPDL -> USB printer
```

For PDF jobs, that pipeline is now enclosed by `ipp-pdf-preflight-to-spl`, so
the HP/Samsung driver never receives PDFs that the local preflight cannot
classify as readable and unencrypted.

This reduces payload size for scanned/image-heavy pages while preserving the
raster format expected by `rastertospl`. It also prevents CUPS from retrying a
bad job repeatedly if the backend or printer errors.

Preserving job files for one day increases local forensic capability after a
printer incident. The tradeoff is that recent documents may remain under the
root-owned CUPS spool for up to 86400 seconds; this is intentional but bounded.

Image quality may be lower than true 600x600 grayscale, but the priority for
this printer is reliable monochrome document output without runaway pages or
garbled SPL streams.

## Operational Rules

Do not run physical print tests casually.

Allowed safe checks:

- `nu scripts/setup-cups-live-to-pi.nu --stop-only`
- `nu scripts/setup-cups-live-to-pi.nu`
- `nu scripts/setup-cups-live-to-pi.nu --enable-printing`
- `cupsfilter` conversions redirected to a temporary file
- `lpstat`, PPD inspection, CUPS config inspection, and spool inspection

Physical print tests require explicit confirmation of the exact sheet count.
Use one sheet unless the user explicitly authorizes more.

Avoid local `lp` for validation. The working shape is a single IPP `Print-Job`
with the PDF attached to the request, `copies=1`, `print-scaling=none`,
`orientation-requested=portrait`, `sides=one-sided`, and monochrome output. The
orchestrator path follows this shape directly.

## Verification Performed

After applying the accepted setup:

- The live PPD contained `cupsBitsPerColor 8`.
- The live PPD contained `HWResolution[300 300]` for the standard quality path.
- The live PPD contained the `ipp-pdf-preflight-to-spl` PDF filter.
- The queue was idle, enabled, accepting, and shared.
- The CUPS spool was empty before validation.
- A no-print `cupsfilter` conversion using the installed PPD called Ghostscript
  with `-r300x300 -dcupsBitsPerColor=8`.
- `rastertospl` exited cleanly during that no-print conversion.
- `nu scripts/tests.nu` passed locally.

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
shape from Android/orchestrator printing and previously caused runaway output.
