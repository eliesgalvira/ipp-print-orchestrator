# IPP Print Server

This project exposes one guarded CUPS queue to family devices and observes its
availability. CUPS is the only authority for accepted print jobs and their
lifecycle.

## Language

**Public print job**: A job submitted by a client to the advertised IPPS queue
and owned by CUPS until its terminal outcome.

**Printer readiness**: Whether CUPS can accept work and the physical printer is
present, authorized, and free of a blocking condition.

**Physical USB identity**: The underlying USB printer represented by either a
direct device URI or an installed supervised-backend URI.
