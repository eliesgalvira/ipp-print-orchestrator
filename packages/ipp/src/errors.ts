import { Schema } from "effect"

export class IppSerializationError extends Schema.TaggedError<IppSerializationError>()(
  "IppSerializationError",
  {
    message: Schema.String,
  },
) {}

export class IppTransportError extends Schema.TaggedError<IppTransportError>()(
  "IppTransportError",
  {
    message: Schema.String,
  },
) {}

export class IppParseError extends Schema.TaggedError<IppParseError>()(
  "IppParseError",
  {
    message: Schema.String,
  },
) {}

export class IppDuplicateAttributeError extends Schema.TaggedError<IppDuplicateAttributeError>()(
  "IppDuplicateAttributeError",
  {
    group: Schema.String,
    name: Schema.String,
    occurrences: Schema.Number,
  },
) {}

export type IppClientError =
  | IppSerializationError
  | IppTransportError
  | IppParseError
  | IppDuplicateAttributeError
