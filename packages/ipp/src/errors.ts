import { Schema } from "effect"

export class IppSerializationError extends Schema.TaggedErrorClass<IppSerializationError>()(
  "IppSerializationError",
  {
    message: Schema.String,
  },
) {}

export class IppTransportError extends Schema.TaggedErrorClass<IppTransportError>()(
  "IppTransportError",
  {
    message: Schema.String,
  },
) {}

export class IppParseError extends Schema.TaggedErrorClass<IppParseError>()(
  "IppParseError",
  {
    message: Schema.String,
  },
) {}

export class IppDuplicateAttributeError extends Schema.TaggedErrorClass<IppDuplicateAttributeError>()(
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
