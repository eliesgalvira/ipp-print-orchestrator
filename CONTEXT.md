# IPP Print Orchestrator

This context describes a local-first print orchestrator that accepts print jobs, keeps durable local state, and coordinates CUPS, printer readiness, and recovery.

## Language

**Job lifecycle**:
The durable journey of a print job from intake through storage, queueing, CUPS submission, recovery, and terminal outcome.
_Avoid_: Job workflow, print pipeline, lifecycle service
