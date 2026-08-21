# IPP Print Server

This project exposes one guarded CUPS queue to family devices and observes
whether the printer is ready. CUPS is the only authority for accepted print
jobs and their lifecycle.

## Language

**CUPS queue**:
The logical print destination that CUPS advertises over IPPS and through which
it accepts jobs.
_Avoid_: Printer, physical printer

**Physical printer**:
The hardware device connected to the print server over USB.
_Avoid_: CUPS queue

**USB device identity**:
The normalized USB vendor ID, product ID, and optional serial number that
identify the physical printer.
_Avoid_: Physical USB identity

**USB device state**:
The physical printer's current USB condition: attached, missing, or
deauthorized.
_Avoid_: Printer attachment

**CUPS queue availability**:
Whether CUPS reports that the queue can accept a job without a blocking state or
reason.
_Avoid_: Printer readiness

**Printer readiness**:
Whether the CUPS queue can accept a job and the physical printer is attached,
authorized, and free of a blocking condition.
_Avoid_: CUPS queue availability, public print availability

**Public print availability**:
Whether family devices can discover and reach the advertised IPPS queue.
_Avoid_: Printer readiness

**Public print job**:
A job submitted by a client to the advertised IPPS queue and owned by CUPS until
its terminal outcome.
