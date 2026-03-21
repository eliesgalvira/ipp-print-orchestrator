import { Effect, Schema } from "effect"

export const encodeJson = <S extends Schema.Top>(schema: S) => {
  const jsonSchema = Schema.fromJsonString(schema)
  return (value: S["Type"]) => Schema.encodeEffect(jsonSchema)(value)
}

export const decodeJson = <S extends Schema.Top>(schema: S) => {
  const jsonSchema = Schema.fromJsonString(schema)
  return (json: string) => Schema.decodeUnknownEffect(jsonSchema)(json)
}

export const encodeJsonLines = <S extends Schema.Top>(
  schema: S,
  values: ReadonlyArray<S["Type"]>,
) =>
  Effect.forEach(values, encodeJson(schema)).pipe(
    Effect.map((lines) => lines.join("\n") + (lines.length > 0 ? "\n" : "")),
  )

export const decodeJsonLines = <S extends Schema.Top>(
  schema: S,
  content: string,
) =>
  Effect.forEach(
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    decodeJson(schema),
  )
