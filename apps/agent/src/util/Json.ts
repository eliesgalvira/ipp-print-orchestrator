import { Effect, Schema } from "effect"

export const encodeJson = <A, I, R>(schema: Schema.Schema<A, I, R>) => {
  const jsonSchema = Schema.parseJson(schema)
  return (value: A) => Schema.encode(jsonSchema)(value)
}

export const decodeJson = <A, I, R>(schema: Schema.Schema<A, I, R>) => {
  const jsonSchema = Schema.parseJson(schema)
  return (json: string) => Schema.decodeUnknown(jsonSchema)(json)
}

export const encodeJsonLines = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  values: readonly A[],
) =>
  Effect.forEach(values, encodeJson(schema)).pipe(
    Effect.map((lines) => lines.join("\n") + (lines.length > 0 ? "\n" : "")),
  )

export const decodeJsonLines = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  content: string,
) =>
  Effect.forEach(
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    decodeJson(schema),
  )
