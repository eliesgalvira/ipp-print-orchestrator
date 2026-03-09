import { Schema } from "effect"

export const encodeJson = (value: unknown): string => JSON.stringify(value, null, 2)

export const decodeJson = <A, I>(
  schema: Schema.Schema<A, I>,
  json: string,
): A => Schema.decodeUnknownSync(schema)(JSON.parse(json))
