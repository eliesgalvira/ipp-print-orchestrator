# IPP Package Reference

`packages/ipp/` is the local Effect-first replacement for the narrow slice of the old upstream `ipp` package that this project actually needs.

It is intentionally not a full compatibility clone. The package owns reusable IPP protocol concerns:

- binary codec
- HTTP transport
- typed request/response models
- protocol tables
- subscription request/response helpers

The app layer still owns daemon-specific policy such as reconnect behavior, status observation, and when to reconcile jobs.

## Public Surface

The package exports everything from:

- `client.ts`
- `codec.ts`
- `errors.ts`
- `model.ts`
- `subscriptions.ts`
- `tables.ts`

## `client.ts`

### `IppClient`

Effect service for executing an IPP request and receiving a parsed `IppMessage`.

Service shape:

```ts
readonly execute: (
  request: IppExecuteRequest,
) => Effect.Effect<IppMessage, IppClientError>
```

Use this when you want the calling layer to depend on an injectable IPP client instead of direct Node HTTP.

### `NodeIppClientLive`

Live `Layer` that implements `IppClient` with Node HTTP/HTTPS transport.

This layer:

- serializes the outgoing IPP request
- posts it as `application/ipp`
- parses the binary response back into `IppMessage`

### `execute(request)`

Convenience helper that reads `IppClient` from the environment and delegates to the service.

Use this in Effect code that already depends on the service.

### `requestIpp(request)`

Direct Effect helper that performs a one-off IPP request without going through the `IppClient` service tag.

Use this when you want the same typed transport behavior but do not need dependency injection.

### `makePrinter(options)`

Small wrapper that binds `endpoint`, `uri`, and optional protocol defaults into an object with:

```ts
execute(operation, message?)
```

This is the closest replacement for the old `ipp.Printer(...)` shape, but it returns Effect-based operations instead of callback-style APIs.

## `codec.ts`

### `parseIppMessage(buffer)`

Parses a binary IPP payload into an `IppMessage`.

Supported value decoding includes:

- strings and language-qualified strings
- integers and booleans
- enums
- resolutions
- ranges of integers
- datetimes
- collections
- repeated attribute values

### `serializeIppRequest(options)`

Builds a binary IPP request buffer.

It automatically injects the required operation attributes:

- `attributes-charset`
- `attributes-natural-language`
- `printer-uri`

It also preserves `subscription-attributes-tag`, which is the core regression this local package was introduced to fix.

### `serializeIppResponse(options)`

Builds a binary IPP response buffer from a status code and attribute groups.

This is primarily useful for:

- tests
- local fixtures
- request/response roundtrip verification

### `serializeIppMessage(options)`

Lower-level serializer that can emit either a request or a response, depending on whether the caller provides:

- `operation`, or
- `statusCode`

Most callers should prefer `serializeIppRequest()` or `serializeIppResponse()`.

## `errors.ts`

### `IppSerializationError`

Raised when a request or response cannot be encoded from the provided values.

### `IppTransportError`

Raised when the HTTP exchange fails before a valid IPP response is received.

### `IppParseError`

Raised when a binary IPP payload cannot be decoded into a valid `IppMessage`.

### `IppClientError`

Union of the three error types above.

## `model.ts`

Core shared types for the package.

Important exported types:

- `IppAttributeValue`
- `IppAttributeGroup`
- `IppCollection`
- `IppMessage`
- `IppRequestMessage`
- `IppResponseMessage`
- `SerializeIppRequestOptions`
- `SerializeIppResponseOptions`
- `SerializeIppMessageOptions`
- `IppExecuteRequest`
- `IppPrinterOptions`

Use these types when building requests or annotating helper functions that transform parsed IPP messages.

## `subscriptions.ts`

Pure helpers for IPP subscription-related request and response handling.

These are protocol helpers, not daemon orchestration logic.

### Request builders

#### `createPrinterSubscriptionRequest(printerUri, requestingUserName, subscriptionAttributes)`

Builds a `Create-Printer-Subscriptions` message body with:

- `operation-attributes-tag`
- `subscription-attributes-tag`

#### `cancelSubscriptionRequest(printerUri, requestingUserName, subscriptionId)`

Builds a `Cancel-Subscription` message body.

#### `getNotificationsRequest(printerUri, requestingUserName, subscriptionId, nextSequenceNumber)`

Builds a `Get-Notifications` request in event-wait mode with:

- `notify-subscription-ids`
- `notify-sequence-numbers`
- `notify-wait`

### Response helpers

#### `extractSubscriptionId(response)`

Extracts `notify-subscription-id` from a subscription response.

Throws if the response does not contain a valid positive integer subscription ID.

#### `notificationRecords(response)`

Normalizes `event-notification-attributes-tag` to a readonly array, whether the response contains:

- a single notification record, or
- repeated notification records

#### `maxNotificationSequenceNumber(notifications)`

Returns the highest valid `notify-sequence-number` present in a notification list.

#### `notificationIncludesEvent(notifications, eventNames)`

Generic predicate for checking whether any notification record contains a subscribed event in the given set.

This is intentionally generic so app code can decide which events matter for its own policy.

#### `extractNotifyGetIntervalSeconds(response)`

Extracts `notify-get-interval` from `operation-attributes-tag` when present.

Returns `null` when the interval is missing or invalid.

## `tables.ts`

Exports the small protocol registry that the package currently relies on:

- IPP versions
- operation codes
- status codes
- tags
- enum values
- enum reverse lookup codes
- attribute syntax by group

Important exports:

- `ippVersions`
- `ippOperations`
- `ippStatusCodes`
- `ippTags`
- `ippEnumValues`
- `ippEnumCodes`
- `groupAttributeSyntax`

This file should stay intentionally scoped to the protocol surface the repo actually uses. Expand it when a real use case appears, not to mirror the entire historical upstream package.

## Current Boundary

Use `packages/ipp/` for:

- encoding and decoding IPP
- posting and parsing IPP requests
- reusable subscription protocol helpers

Keep app-specific behavior outside the package, for example:

- reconnect schedules
- status observation policy
- job repair decisions
- daemon-specific event interpretation
