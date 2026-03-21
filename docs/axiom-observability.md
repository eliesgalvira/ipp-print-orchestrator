# Axiom Observability Guide

This document describes the current observability model after the instrumentation changes in the app:

- queue depth is now event-driven
- HTTP request analytics are now log-native
- terminal job analytics are now log-native
- heartbeat remains a sampled status snapshot and is not the source of truth for historical queue analysis

## Logging Model

The runtime now has one wide-event publishing seam that owns structured event emission.

Primary datasets:

- `ipp-print-logs`: canonical wide events
- `ipp-print-traces`: request tree, span timing, low-level execution details

The logs dataset is now the authoritative place for:

- job lifecycle facts
- queue mutations
- HTTP request outcomes
- terminal job outcomes

The traces dataset is still the authoritative place for:

- span trees
- CUPS call timing
- route-level traces
- unknown clients hitting your HTTP server

## Event Families

Current wide-event families:

- `print.request.received`
- `print.job.stored`
- `print.job.queued`
- `print.job.submission.attempt`
- `print.job.submitted`
- `print.job.state.changed`
- `print.job.completed`
- `print.job.failed`
- `print.job.outcome`
- `queue.job.enqueued`
- `queue.job.dequeued`
- `http.request.completed`
- `heartbeat`
- `startup.reconciliation.started`
- `startup.reconciliation.completed`

Important fields now available in logs:

- `['attributes.eventName']`
- `['attributes.printId']`
- `['attributes.requestId']`
- `['attributes.currentState']`
- `['attributes.previousState']`
- `['attributes.finalState']`
- `['attributes.retryCount']`
- `['attributes.attemptNumber']`
- `['attributes.errorTag']`
- `['attributes.errorMessage']`
- `['attributes.timeToSubmitMs']`
- `['attributes.timeToTerminalMs']`
- `['attributes.jobDurationMs']`
- `['attributes.queueDepth']`
- `['attributes.route']`
- `['attributes.method']`
- `['attributes.statusCode']`
- `['attributes.durationMs']`
- `['attributes.clientAddress']`
- `['attributes.userAgent']`

Heartbeat-only fields still exist and are still useful for live-ish box status:

- `['attributes.cupsReachable']`
- `['attributes.printerAttached']`
- `['attributes.printerQueueAvailable']`
- `['attributes.printerState']`
- `['attributes.printerReasons']`
- `['attributes.printerMessage']`

## APL Syntax Notes

Your Axiom OTLP datasets flatten dotted attribute names into literal column names. Use bracket-quoted column references:

```apl
['attributes.eventName']
['attributes.queueDepth']
['attributes.http.route']
```

Useful schema checks:

```apl
['ipp-print-logs']
| getschema
```

```apl
['ipp-print-traces']
| getschema
```

## What To Trust

Trust these for historical analysis:

- `queue.job.enqueued`
- `queue.job.dequeued`
- `http.request.completed`
- `print.job.submitted`
- `print.job.outcome`
- `print.job.completed`
- `print.job.failed`
- `print.job.state.changed`

Treat these as sampled status snapshots:

- `heartbeat`

That means:

- use queue events for queue depth history
- use HTTP wide events for route analytics
- use `print.job.outcome` for terminal job analytics
- use heartbeat to answer "what was the machine seeing around that time?"

## Queries Worth Saving

## Queue

Current queue depth:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| project _time, ['attributes.queueDepth'], ['attributes.printId'], ['attributes.eventName']
| order by _time desc
| limit 1
```

Maximum queue depth in a period:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| summarize max_queue_depth = max(['attributes.queueDepth'])
```

Queue depth over time:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| summarize max_queue_depth = max(['attributes.queueDepth']) by bin(_time, 15m)
| order by _time asc
```

Enqueue vs dequeue rate:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| summarize
    enqueued = countif(['attributes.eventName'] == "queue.job.enqueued"),
    dequeued = countif(['attributes.eventName'] == "queue.job.dequeued")
  by bin(_time, 15m)
| order by _time asc
```

Net queue growth by window:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| summarize
    enqueued = countif(['attributes.eventName'] == "queue.job.enqueued"),
    dequeued = countif(['attributes.eventName'] == "queue.job.dequeued")
  by bin(_time, 15m)
| extend queue_delta = enqueued - dequeued
| order by _time asc
```

All queue mutations:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| project _time, ['attributes.eventName'], ['attributes.printId'], ['attributes.queueDepth']
| order by _time desc
```

## Job Outcomes

Jobs completed:

```apl
['ipp-print-logs']
| summarize jobs_completed = countif(['attributes.eventName'] == "print.job.completed")
```

Jobs failed terminally:

```apl
['ipp-print-logs']
| summarize jobs_failed = countif(['attributes.eventName'] == "print.job.failed")
```

Canonical terminal outcomes by final state:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| summarize count() by ['attributes.finalState']
| order by count_ desc
```

Terminal outcomes over time:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| summarize count() by bin(_time, 1h), ['attributes.finalState']
| order by _time asc
```

Average time to terminal by final state:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| summarize avg_time_to_terminal_ms = avg(['attributes.timeToTerminalMs']) by ['attributes.finalState']
| order by avg_time_to_terminal_ms desc
```

Slowest terminal jobs:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.finalState'],
          ['attributes.timeToTerminalMs'],
          ['attributes.attemptNumber'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by ['attributes.timeToTerminalMs'] desc
| limit 100
```

Failures with reasons:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| where ['attributes.finalState'] == "FailedTerminal"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.attemptNumber'],
          ['attributes.errorTag'],
          ['attributes.errorMessage'],
          ['attributes.timeToTerminalMs']
| order by _time desc
```

Outcomes by attempt number:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| summarize count() by ['attributes.attemptNumber'], ['attributes.finalState']
| order by ['attributes.attemptNumber'] asc
```

## Submission

Jobs submitted to CUPS:

```apl
['ipp-print-logs']
| summarize jobs_submitted = countif(['attributes.eventName'] == "print.job.submitted")
```

Submission attempts:

```apl
['ipp-print-logs']
| summarize submission_attempts = countif(['attributes.eventName'] == "print.job.submission.attempt")
```

Average time to submit:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.submitted"
| summarize avg_time_to_submit_ms = avg(['attributes.timeToSubmitMs'])
```

Slowest submissions:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.submitted"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.attemptNumber'],
          ['attributes.timeToSubmitMs'],
          ['attributes.cupsJobId']
| order by ['attributes.timeToSubmitMs'] desc
| limit 100
```

Jobs that entered `SubmissionUncertain`:

```apl
['ipp-print-logs']
| where ['attributes.errorTag'] == "SubmissionUncertain"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.currentState'],
          ['attributes.previousState'],
          ['attributes.attemptNumber'],
          ['attributes.errorMessage']
| order by _time desc
```

Retry-heavy jobs:

```apl
['ipp-print-logs']
| summarize max_retry = max(['attributes.retryCount']) by ['attributes.printId']
| where max_retry > 0
| order by max_retry desc
```

## Job Forensics

Full event timeline for one job:

```apl
['ipp-print-logs']
| where ['attributes.printId'] == "REPLACE_JOB_ID"
| project _time,
          ['attributes.eventName'],
          ['attributes.currentState'],
          ['attributes.previousState'],
          ['attributes.finalState'],
          ['attributes.retryCount'],
          ['attributes.attemptNumber'],
          ['attributes.queueDepth'],
          ['attributes.timeToSubmitMs'],
          ['attributes.timeToTerminalMs'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time asc
```

Full event timeline for one request:

```apl
['ipp-print-logs']
| where ['attributes.requestId'] == "REPLACE_REQUEST_ID"
| project _time,
          ['attributes.printId'],
          ['attributes.eventName'],
          ['attributes.currentState'],
          ['attributes.previousState'],
          ['attributes.finalState'],
          ['attributes.attemptNumber'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time asc
```

Jobs waiting for printer:

```apl
['ipp-print-logs']
| where ['attributes.currentState'] == "WaitingForPrinter"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.previousState'],
          ['attributes.attemptNumber'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time desc
```

Jobs waiting for CUPS:

```apl
['ipp-print-logs']
| where ['attributes.currentState'] == "WaitingForCups"
| project _time,
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.previousState'],
          ['attributes.attemptNumber'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time desc
```

Most common failure tags:

```apl
['ipp-print-logs']
| where isnotnull(['attributes.errorTag'])
| summarize count() by ['attributes.errorTag']
| order by count_ desc
```

Most common failure messages:

```apl
['ipp-print-logs']
| where isnotnull(['attributes.errorMessage'])
| summarize count() by ['attributes.errorMessage']
| order by count_ desc
```

## HTTP

HTTP requests by route:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| summarize requests = count() by ['attributes.method'], ['attributes.route']
| order by requests desc
```

HTTP requests by route and status:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| summarize requests = count() by ['attributes.method'], ['attributes.route'], ['attributes.statusCode']
| order by requests desc
```

Average HTTP duration by route:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| summarize avg_duration_ms = avg(['attributes.durationMs']) by ['attributes.method'], ['attributes.route']
| order by avg_duration_ms desc
```

Slowest HTTP requests:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| project _time,
          ['attributes.method'],
          ['attributes.route'],
          ['attributes.statusCode'],
          ['attributes.durationMs'],
          ['attributes.clientAddress'],
          ['attributes.userAgent'],
          ['attributes.requestId'],
          ['attributes.printId'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by ['attributes.durationMs'] desc
| limit 100
```

Clients hitting `/v1/health`:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| where ['attributes.route'] == "/v1/health"
| summarize requests = count() by ['attributes.clientAddress'], ['attributes.userAgent']
| order by requests desc
```

Clients hitting `/v1/status`:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| where ['attributes.route'] == "/v1/status"
| summarize requests = count() by ['attributes.clientAddress'], ['attributes.userAgent']
| order by requests desc
```

API writes to `/v1/jobs`:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| where ['attributes.route'] == "/v1/jobs"
| project _time,
          ['attributes.method'],
          ['attributes.statusCode'],
          ['attributes.durationMs'],
          ['attributes.clientAddress'],
          ['attributes.userAgent'],
          ['attributes.requestId'],
          ['attributes.printId'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time desc
```

404s and 5xxs from canonical HTTP events:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "http.request.completed"
| where ['attributes.statusCode'] >= 400
| project _time,
          ['attributes.method'],
          ['attributes.route'],
          ['attributes.statusCode'],
          ['attributes.durationMs'],
          ['attributes.clientAddress'],
          ['attributes.userAgent'],
          ['attributes.errorTag'],
          ['attributes.errorMessage']
| order by _time desc
```

## Printer And CUPS

These still depend on heartbeat, so they are sampled.

Heartbeat snapshots where CUPS was down:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "heartbeat"
| where ['attributes.cupsReachable'] == false
| project _time,
          ['attributes.hostname'],
          ['attributes.cupsReachable'],
          ['attributes.printerAttached'],
          ['attributes.printerQueueAvailable'],
          ['attributes.printerState'],
          ['attributes.printerMessage'],
          ['attributes.printerReasons']
| order by _time desc
```

Heartbeat snapshots where printer was detached:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "heartbeat"
| where ['attributes.printerAttached'] == false
| project _time,
          ['attributes.hostname'],
          ['attributes.cupsReachable'],
          ['attributes.printerAttached'],
          ['attributes.printerQueueAvailable'],
          ['attributes.printerState'],
          ['attributes.printerMessage'],
          ['attributes.printerReasons']
| order by _time desc
```

All events related to CUPS being unavailable:

```apl
['ipp-print-logs']
| where (['attributes.eventName'] == "heartbeat" and ['attributes.cupsReachable'] == false)
   or ['attributes.errorTag'] == "CupsUnavailable"
   or ['attributes.currentState'] == "WaitingForCups"
| project _time,
          ['attributes.eventName'],
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.currentState'],
          ['attributes.previousState'],
          ['attributes.errorTag'],
          ['attributes.errorMessage'],
          ['attributes.cupsReachable'],
          ['attributes.printerAttached'],
          ['attributes.printerQueueAvailable']
| order by _time desc
```

All events related to printer unavailable:

```apl
['ipp-print-logs']
| where (['attributes.eventName'] == "heartbeat" and ['attributes.printerAttached'] == false)
   or ['attributes.errorTag'] == "PrinterNotReady"
   or ['attributes.currentState'] == "WaitingForPrinter"
| project _time,
          ['attributes.eventName'],
          ['attributes.printId'],
          ['attributes.requestId'],
          ['attributes.currentState'],
          ['attributes.previousState'],
          ['attributes.errorTag'],
          ['attributes.errorMessage'],
          ['attributes.printerAttached'],
          ['attributes.printerQueueAvailable']
| order by _time desc
```

## Reconciliation

Reconciliation runs:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("startup.reconciliation.started", "startup.reconciliation.completed")
| summarize count() by bin(_time, 1h), ['attributes.eventName']
| order by _time asc
```

Reconciliation completions:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "startup.reconciliation.completed"
| order by _time desc
```

## Data Quality Checks

Jobs with more than one terminal outcome:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] == "print.job.outcome"
| summarize terminal_events = count() by ['attributes.printId']
| where terminal_events > 1
| order by terminal_events desc
```

Jobs submitted but with no terminal outcome:

```apl
['ipp-print-logs']
| summarize
    saw_submitted = countif(['attributes.eventName'] == "print.job.submitted"),
    saw_outcome = countif(['attributes.eventName'] == "print.job.outcome"),
    last_seen = max(_time)
  by ['attributes.printId']
| where saw_submitted > 0 and saw_outcome == 0
| order by last_seen desc
```

Jobs accepted but never queued:

```apl
['ipp-print-logs']
| summarize
    saw_received = countif(['attributes.eventName'] == "print.request.received"),
    saw_queued = countif(['attributes.eventName'] == "print.job.queued"),
    last_seen = max(_time)
  by ['attributes.printId']
| where saw_received > 0 and saw_queued == 0
| order by last_seen desc
```

Jobs with missing dequeue after enqueue:

```apl
['ipp-print-logs']
| where ['attributes.eventName'] in ("queue.job.enqueued", "queue.job.dequeued")
| summarize
    enqueued = countif(['attributes.eventName'] == "queue.job.enqueued"),
    dequeued = countif(['attributes.eventName'] == "queue.job.dequeued"),
    last_seen = max(_time)
  by ['attributes.printId']
| where enqueued > dequeued
| order by last_seen desc
```

## Trace Queries

Traces are still useful when the logs tell you what happened and you want to know how the runtime got there.

Requests by route from traces:

```apl
['ipp-print-traces']
| where name in ("http.server GET", "http.server POST")
| summarize requests = count() by ['attributes.http.route']
| order by requests desc
```

Clients by route from traces:

```apl
['ipp-print-traces']
| where name in ("http.server GET", "http.server POST")
| summarize requests = count() by ['attributes.http.route'], ['attributes.client.address'], ['attributes.user_agent.original']
| order by requests desc
```

Slowest spans by operation:

```apl
['ipp-print-traces']
| summarize calls = count(), avg_duration = avg(duration), errors = countif(error == true) by name
| order by avg_duration desc
```

CUPS spans only:

```apl
['ipp-print-traces']
| where name startswith "Cups"
| summarize calls = count(), avg_duration = avg(duration), errors = countif(error == true) by name
| order by avg_duration desc
```

One full trace:

```apl
['ipp-print-traces']
| where trace_id == "REPLACE_TRACE_ID"
| project _time,
          name,
          parent_span_id,
          span_id,
          duration,
          error,
          ['attributes.http.route'],
          ['attributes.http.response.status_code']
| order by _time asc
```

## Recommended Starting Dashboard

If you only save a few queries first, save these:

1. `print.job.outcome` by `finalState`
2. max queue depth from `queue.job.*`
3. current queue depth from latest `queue.job.*`
4. HTTP requests by route and status from `http.request.completed`
5. slowest submissions from `print.job.submitted`
6. slowest terminal jobs from `print.job.outcome`
7. all `WaitingForCups` / `CupsUnavailable` events
8. all `WaitingForPrinter` / `PrinterNotReady` events
