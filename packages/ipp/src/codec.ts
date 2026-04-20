import { Match } from "effect"

import { IppParseError, IppSerializationError } from "./errors.js"
import type {
  IppAttributeGroup,
  IppAttributeValue,
  IppCollection,
  IppMessage,
  IppRequestMessage,
  IppResponseMessage,
  SerializeIppMessageOptions,
  SerializeIppRequestOptions,
  SerializeIppResponseOptions,
} from "./model.js"
import {
  groupAttributeSyntax,
  type IppAttributeSyntax,
  ippEnumCodes,
  ippEnumValues,
  ippOperations,
  ippOperationsByCode,
  ippStatusCodes,
  ippStatusCodesByCode,
  ippTags,
  ippTagsByCode,
  ippVersions,
  ippVersionsByCode,
  orderedRequestGroups,
} from "./tables.js"

const LANGUAGE_SEPARATOR = "\u001e"

const specialOperationAttributesOrder = new Map([
  ["attributes-charset", 1],
  ["attributes-natural-language", 2],
  ["printer-uri", 3],
  ["job-id", 4],
  ["job-uri", 5],
])

const orderedOperationAttributes = (
  keys: readonly string[],
): readonly string[] =>
  [...keys].sort(
    (left, right) =>
      (specialOperationAttributesOrder.get(left) ?? 10) -
      (specialOperationAttributesOrder.get(right) ?? 10),
  )

class BufferWriter {
  private readonly chunks: Buffer[] = []

  writeUInt8(value: number): void {
    const chunk = Buffer.allocUnsafe(1)
    chunk.writeUInt8(value)
    this.chunks.push(chunk)
  }

  writeUInt16BE(value: number): void {
    const chunk = Buffer.allocUnsafe(2)
    chunk.writeUInt16BE(value)
    this.chunks.push(chunk)
  }

  writeInt32BE(value: number): void {
    const chunk = Buffer.allocUnsafe(4)
    chunk.writeInt32BE(value)
    this.chunks.push(chunk)
  }

  writeString(value: string, encoding: BufferEncoding = "utf8"): void {
    const chunk = Buffer.from(value, encoding)
    this.writeUInt16BE(chunk.length)
    this.chunks.push(chunk)
  }

  writeRaw(buffer: Buffer): void {
    this.chunks.push(buffer)
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

class BufferCursor {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  get position(): number {
    return this.offset
  }

  get length(): number {
    return this.buffer.length
  }

  peekUInt8(): number {
    this.ensureAvailable(1)
    return this.buffer.readUInt8(this.offset)
  }

  byteAt(offset: number): number | undefined {
    return this.buffer[this.offset + offset]
  }

  readUInt8(): number {
    this.ensureAvailable(1)
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  readUInt16BE(): number {
    this.ensureAvailable(2)
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readInt32BE(): number {
    this.ensureAvailable(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readBuffer(length: number): Buffer {
    this.ensureAvailable(length)
    const value = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readString(length: number, encoding: BufferEncoding = "utf8"): string {
    if (length === 0) {
      return ""
    }
    return this.readBuffer(length).toString(encoding)
  }

  rest(): Buffer {
    return this.buffer.subarray(this.offset)
  }

  private ensureAvailable(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new Error("Unexpected end of IPP payload")
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeRequestMessage = (
  options: SerializeIppRequestOptions,
): Required<Pick<SerializeIppRequestOptions, "operation" | "printerUri">> & {
  readonly version: string
  readonly requestId: number
  readonly language: string
  readonly charset: string
  readonly message: IppRequestMessage | null
} => ({
  operation: options.operation,
  printerUri: options.printerUri,
  version: options.version ?? "2.0",
  requestId: options.requestId ?? Math.floor(Math.random() * 100_000_000),
  language: options.language ?? "en",
  charset: options.charset ?? "utf-8",
  message: options.message ?? null,
})

const requireVersionCode = (version: string): number => {
  const code = ippVersions[version as keyof typeof ippVersions]
  if (code === undefined) {
    throw new IppSerializationError({
      message: `Unsupported IPP version: ${version}`,
    })
  }
  return code
}

const requireOperationCode = (operation: string): number => {
  const code = ippOperations[operation as keyof typeof ippOperations]
  if (code === undefined) {
    throw new IppSerializationError({
      message: `Unsupported IPP operation: ${operation}`,
    })
  }
  return code
}

const requireStatusCode = (statusCode: string): number => {
  const code = ippStatusCodes[statusCode as keyof typeof ippStatusCodes]
  if (code === undefined) {
    throw new IppSerializationError({
      message: `Unsupported IPP status code: ${statusCode}`,
    })
  }
  return code
}

const resolveAttributeSyntax = (
  groupName: keyof typeof groupAttributeSyntax,
  name: string,
): IppAttributeSyntax => {
  const groups = groupAttributeSyntax[groupName] as readonly Record<
    string,
    IppAttributeSyntax
  >[]
  const syntax = groups.find((group) => group[name] !== undefined)?.[name]

  if (syntax === undefined) {
    throw new IppSerializationError({
      message: `Unknown IPP attribute for ${groupName}: ${name}`,
    })
  }

  return syntax
}

const resolveValueTag = (
  syntax: IppAttributeSyntax,
  value: unknown,
): number => {
  if (syntax.tag !== undefined) {
    return syntax.tag
  }

  return Match.value(syntax.type).pipe(
    Match.when("name", () =>
      typeof value === "string" && value.includes(LANGUAGE_SEPARATOR)
        ? ippTags.nameWithLanguage
        : ippTags.nameWithoutLanguage,
    ),
    Match.when("text", () =>
      typeof value === "string" && value.includes(LANGUAGE_SEPARATOR)
        ? ippTags.textWithLanguage
        : ippTags.textWithoutLanguage,
    ),
    Match.when("keyword", () => ippTags.keyword),
    Match.when("uri", () => ippTags.uri),
    Match.when("uriScheme", () => ippTags.uriScheme),
    Match.when("charset", () => ippTags.charset),
    Match.when("naturalLanguage", () => ippTags.naturalLanguage),
    Match.when("mimeMediaType", () => ippTags.mimeMediaType),
    Match.when("octetString", () => ippTags.octetString),
    Match.when("rangeOfInteger", () => ippTags.rangeOfInteger),
    Match.when("resolution", () => ippTags.resolution),
    Match.when("dateTime", () => ippTags.dateTime),
    Match.when("integer", () => ippTags.integer),
    Match.when("boolean", () => ippTags.boolean),
    Match.when("enum", () => ippTags.enum),
    Match.exhaustive,
  )
}

const writeInteger = (writer: BufferWriter, value: number): void => {
  if (!Number.isInteger(value)) {
    throw new IppSerializationError({
      message: `Expected integer IPP value, received ${String(value)}`,
    })
  }

  writer.writeUInt16BE(4)
  writer.writeInt32BE(value)
}

const resolveEnumCode = (name: string, value: unknown): number => {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const code = (ippEnumCodes as Record<string, Record<string, number>>)[
      name
    ]?.[value]
    if (code !== undefined) {
      return code
    }
  }

  throw new IppSerializationError({
    message: `Expected known enum value for ${name}, received ${String(value)}`,
  })
}

const writeRangeOfInteger = (writer: BufferWriter, value: unknown): void => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((item) => typeof item === "number" && Number.isInteger(item))
  ) {
    throw new IppSerializationError({
      message: `Expected [number, number] IPP range value, received ${String(value)}`,
    })
  }

  writer.writeUInt16BE(8)
  writer.writeInt32BE(value[0])
  writer.writeInt32BE(value[1])
}

const writeResolution = (writer: BufferWriter, value: unknown): void => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    typeof value[0] !== "number" ||
    !Number.isInteger(value[0]) ||
    typeof value[1] !== "number" ||
    !Number.isInteger(value[1]) ||
    (value[2] !== "dpi" && value[2] !== "dpcm")
  ) {
    throw new IppSerializationError({
      message: `Expected [x, y, "dpi" | "dpcm"] IPP resolution, received ${String(value)}`,
    })
  }

  writer.writeUInt16BE(9)
  writer.writeInt32BE(value[0])
  writer.writeInt32BE(value[1])
  writer.writeUInt8(value[2] === "dpi" ? 0x03 : 0x04)
}

const writeDateTime = (writer: BufferWriter, value: unknown): void => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new IppSerializationError({
      message: `Expected Date IPP value, received ${String(value)}`,
    })
  }

  const timezoneOffset = value.getTimezoneOffset()
  const sign = timezoneOffset > 0 ? "-" : "+"
  const absoluteOffset = Math.abs(timezoneOffset)
  writer.writeUInt16BE(11)
  writer.writeUInt16BE(value.getFullYear())
  writer.writeUInt8(value.getMonth() + 1)
  writer.writeUInt8(value.getDate())
  writer.writeUInt8(value.getHours())
  writer.writeUInt8(value.getMinutes())
  writer.writeUInt8(value.getSeconds())
  writer.writeUInt8(Math.floor(value.getMilliseconds() / 100))
  writer.writeRaw(Buffer.from(sign, "ascii"))
  writer.writeUInt8(Math.floor(absoluteOffset / 60))
  writer.writeUInt8(absoluteOffset % 60)
}

const writeStringValue = (
  writer: BufferWriter,
  value: unknown,
  encoding: BufferEncoding,
  typeName: string,
): void => {
  if (typeof value !== "string") {
    throw new IppSerializationError({
      message: `Expected ${typeName} IPP value, received ${String(value)}`,
    })
  }

  writer.writeString(value, encoding)
}

const writeLanguageQualifiedString = (
  writer: BufferWriter,
  value: unknown,
  typeName: string,
): void => {
  if (typeof value !== "string") {
    throw new IppSerializationError({
      message: `Expected ${typeName} IPP value, received ${String(value)}`,
    })
  }

  const separator = value.indexOf(LANGUAGE_SEPARATOR)
  if (separator < 0) {
    throw new IppSerializationError({
      message: `Expected language-qualified ${typeName} IPP value`,
    })
  }

  const language = Buffer.from(value.slice(0, separator), "utf8")
  const text = Buffer.from(value.slice(separator + 1), "utf8")
  writer.writeUInt16BE(language.length)
  writer.writeRaw(language)
  writer.writeUInt16BE(text.length)
  writer.writeRaw(text)
}

const writeValue = (
  writer: BufferWriter,
  name: string,
  syntax: IppAttributeSyntax,
  value: unknown,
): void => {
  const tag = resolveValueTag(syntax, value)

  Match.value(tag).pipe(
    Match.when(ippTags.integer, () => {
      if (typeof value !== "number") {
        throw new IppSerializationError({
          message: `Expected numeric IPP value for ${syntax.type}`,
        })
      }
      writeInteger(writer, value)
    }),
    Match.when(ippTags.enum, () => {
      writeInteger(writer, resolveEnumCode(name, value))
    }),
    Match.when(ippTags.boolean, () => {
      if (typeof value !== "boolean") {
        throw new IppSerializationError({
          message: `Expected boolean IPP value, received ${String(value)}`,
        })
      }
      writer.writeUInt16BE(1)
      writer.writeUInt8(value ? 1 : 0)
    }),
    Match.when(
      Match.is(
        ippTags.keyword,
        ippTags.uri,
        ippTags.uriScheme,
        ippTags.charset,
        ippTags.naturalLanguage,
        ippTags.mimeMediaType,
      ),
      () => {
        writeStringValue(writer, value, "ascii", syntax.type)
      },
    ),
    Match.when(
      Match.is(
        ippTags.nameWithoutLanguage,
        ippTags.textWithoutLanguage,
        ippTags.octetString,
        ippTags.memberAttrName,
      ),
      () => {
        writeStringValue(writer, value, "utf8", syntax.type)
      },
    ),
    Match.when(
      Match.is(ippTags.nameWithLanguage, ippTags.textWithLanguage),
      () => {
        writeLanguageQualifiedString(writer, value, syntax.type)
      },
    ),
    Match.when(ippTags.rangeOfInteger, () => {
      writeRangeOfInteger(writer, value)
    }),
    Match.when(ippTags.resolution, () => {
      writeResolution(writer, value)
    }),
    Match.when(ippTags.dateTime, () => {
      writeDateTime(writer, value)
    }),
    Match.orElse(() => {
      throw new IppSerializationError({
        message: `Unsupported IPP tag ${tag} for ${syntax.type}`,
      })
    }),
  )
}

const writeAttribute = (
  writer: BufferWriter,
  groupName: keyof typeof groupAttributeSyntax,
  name: string,
  rawValue: unknown,
): void => {
  const syntax = resolveAttributeSyntax(groupName, name)
  const values =
    Array.isArray(rawValue) &&
    syntax.type !== "rangeOfInteger" &&
    syntax.type !== "resolution"
      ? rawValue
      : [rawValue]

  values.forEach((value, index) => {
    writer.writeUInt8(resolveValueTag(syntax, value))
    if (index === 0) {
      writer.writeString(name)
    } else {
      writer.writeUInt16BE(0)
    }
    writeValue(writer, name, syntax, value)
  })
}

const writeAttributeGroups = (
  writer: BufferWriter,
  message: IppRequestMessage | IppResponseMessage,
) => {
  for (const groupName of orderedRequestGroups) {
    const attrs = message[groupName]
    if (!isRecord(attrs)) {
      continue
    }

    const keys =
      groupName === "operation-attributes-tag"
        ? orderedOperationAttributes(Object.keys(attrs))
        : Object.keys(attrs)

    writer.writeUInt8(ippTags[groupName])
    for (const key of keys) {
      writeAttribute(writer, groupName, key, attrs[key])
    }
  }

  writer.writeUInt8(ippTags["end-of-attributes-tag"])
  if (message.data !== undefined) {
    writer.writeRaw(message.data)
  }
}

export const serializeIppMessage = (
  options: SerializeIppMessageOptions,
): Buffer => {
  const writer = new BufferWriter()
  const version = options.version ?? "2.0"
  const requestId = options.requestId ?? Math.floor(Math.random() * 100_000_000)

  writer.writeUInt16BE(requireVersionCode(version))

  if ("operation" in options) {
    writer.writeUInt16BE(requireOperationCode(options.operation))
  } else {
    writer.writeUInt16BE(requireStatusCode(options.statusCode))
  }
  writer.writeInt32BE(requestId)
  writeAttributeGroups(writer, options.message ?? {})
  return writer.finish()
}

export const serializeIppRequest = (
  options: SerializeIppRequestOptions,
): Buffer => {
  const request = normalizeRequestMessage(options)
  const operationAttributesTag = {
    "attributes-charset": request.charset,
    "attributes-natural-language": request.language,
    "printer-uri": request.printerUri,
    ...(request.message?.["operation-attributes-tag"] ?? {}),
  } satisfies IppAttributeGroup

  return serializeIppMessage({
    operation: request.operation,
    requestId: request.requestId,
    version: request.version,
    message: {
      ...(request.message ?? {}),
      "operation-attributes-tag": operationAttributesTag,
    },
  })
}

export const serializeIppResponse = (
  options: SerializeIppResponseOptions,
): Buffer =>
  serializeIppMessage({
    statusCode: options.statusCode,
    ...(options.requestId === undefined
      ? {}
      : { requestId: options.requestId }),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.message === undefined ? {} : { message: options.message }),
  })

const hasAdditionalValue = (cursor: BufferCursor): boolean => {
  if (cursor.position + 2 >= cursor.length) {
    return false
  }

  const current = cursor.peekUInt8()
  return (
    current !== ippTags.memberAttrName &&
    current !== ippTags.endCollection &&
    current !== ippTags["end-of-attributes-tag"] &&
    cursor.byteAt(1) === 0x00 &&
    cursor.byteAt(2) === 0x00
  )
}

const decodeEnum = (name: string, value: number): number | string =>
  (ippEnumValues as Record<string, Record<number, string>>)[name]?.[value] ??
  value

const readDateTime = (cursor: BufferCursor): Date => {
  const year = cursor.readUInt16BE()
  const month = cursor.readUInt8() - 1
  const day = cursor.readUInt8()
  const hours = cursor.readUInt8()
  const minutes = cursor.readUInt8()
  const seconds = cursor.readUInt8()
  const deciseconds = cursor.readUInt8()
  const sign = cursor.readString(1, "ascii")
  const tzHours = cursor.readUInt8()
  const tzMinutes = cursor.readUInt8()
  const millis = deciseconds * 100
  const utc = Date.UTC(year, month, day, hours, minutes, seconds, millis)
  const offsetMinutes = tzHours * 60 + tzMinutes
  const signedOffset = sign === "-" ? -offsetMinutes : offsetMinutes
  return new Date(utc - signedOffset * 60_000)
}

const readCollection = (cursor: BufferCursor): IppCollection => {
  const collection: Record<string, IppAttributeValue> = {}

  while (cursor.readUInt8() !== ippTags.endCollection) {
    cursor.readUInt16BE()
    const name = readValue(cursor, ippTags.memberAttrName, "member-name")
    if (typeof name !== "string") {
      throw new Error("IPP collection member name must be a string")
    }

    const valueTag = cursor.readUInt8()
    cursor.readUInt16BE()
    collection[name] = readValues(cursor, valueTag, name)
  }

  cursor.readUInt16BE()
  const length = cursor.readUInt16BE()
  if (length > 0) {
    cursor.readBuffer(length)
  }

  return collection
}

const readValue = (
  cursor: BufferCursor,
  tag: number,
  name: string,
): IppAttributeValue => {
  const length = cursor.readUInt16BE()

  return Match.value(tag).pipe(
    Match.when(ippTags.integer, () => cursor.readInt32BE()),
    Match.when(ippTags.enum, () => decodeEnum(name, cursor.readInt32BE())),
    Match.when(ippTags.boolean, () => cursor.readUInt8() !== 0),
    Match.when(
      ippTags.rangeOfInteger,
      () => [cursor.readInt32BE(), cursor.readInt32BE()] as const,
    ),
    Match.when(
      ippTags.resolution,
      () =>
        [
          cursor.readInt32BE(),
          cursor.readInt32BE(),
          cursor.readUInt8() === 0x03 ? "dpi" : "dpcm",
        ] as const,
    ),
    Match.when(ippTags.dateTime, () => readDateTime(cursor)),
    Match.when(
      Match.is(ippTags.textWithLanguage, ippTags.nameWithLanguage),
      () => {
        const language = cursor.readString(cursor.readUInt16BE())
        const text = cursor.readString(cursor.readUInt16BE())
        return `${language}${LANGUAGE_SEPARATOR}${text}`
      },
    ),
    Match.when(
      Match.is(
        ippTags.nameWithoutLanguage,
        ippTags.textWithoutLanguage,
        ippTags.octetString,
        ippTags.memberAttrName,
      ),
      () => cursor.readString(length),
    ),
    Match.when(
      Match.is(
        ippTags.keyword,
        ippTags.uri,
        ippTags.uriScheme,
        ippTags.charset,
        ippTags.naturalLanguage,
        ippTags.mimeMediaType,
      ),
      () => cursor.readString(length, "ascii"),
    ),
    Match.when(ippTags.begCollection, () => {
      if (length > 0) {
        cursor.readBuffer(length)
      }
      return readCollection(cursor)
    }),
    Match.when(ippTags["no-value"], () => {
      if (length > 0) {
        cursor.readBuffer(length)
      }
      return null
    }),
    Match.orElse(() => cursor.readString(length)),
  )
}

const readValues = (
  cursor: BufferCursor,
  tag: number,
  name: string,
): IppAttributeValue => {
  const value = readValue(cursor, tag, name)
  if (!hasAdditionalValue(cursor)) {
    return value
  }

  const values: IppAttributeValue[] = [value]
  while (hasAdditionalValue(cursor)) {
    const nextTag = cursor.readUInt8()
    cursor.readUInt16BE()
    values.push(readValue(cursor, nextTag, name))
  }
  return values
}

const appendGroup = (
  message: Record<string, unknown>,
  groupName: string,
  group: IppAttributeGroup,
) => {
  const existing = message[groupName]
  if (existing === undefined) {
    message[groupName] = group
    return
  }

  if (Array.isArray(existing)) {
    message[groupName] = [...existing, group]
    return
  }

  message[groupName] = [existing, group]
}

export const parseIppMessage = (buffer: Buffer): IppMessage => {
  try {
    const cursor = new BufferCursor(buffer)
    const major = cursor.readUInt8()
    const minor = cursor.readUInt8()
    const versionCode = (major << 8) | minor
    const message: Record<string, unknown> = {
      version: ippVersionsByCode[versionCode] ?? `${major}.${minor}`,
    }

    const code = cursor.readUInt16BE()
    const operation = ippOperationsByCode[code]
    const statusCode = ippStatusCodesByCode[code]
    if (operation !== undefined) {
      message.operation = operation
    }
    if (statusCode !== undefined) {
      message.statusCode = statusCode
    }
    message.id = cursor.readInt32BE()

    while (cursor.position < cursor.length) {
      const groupTag = cursor.readUInt8()
      if (groupTag === ippTags["end-of-attributes-tag"]) {
        if (cursor.position < cursor.length) {
          message.data = cursor.rest()
        }
        break
      }

      const groupName = ippTagsByCode[groupTag] ?? `unknown-group-${groupTag}`
      const group: Record<string, IppAttributeValue> = {}
      appendGroup(message, groupName, group)

      while (cursor.position < cursor.length && cursor.peekUInt8() >= 0x0f) {
        const valueTag = cursor.readUInt8()
        const name = cursor.readString(cursor.readUInt16BE())
        group[name] = readValues(cursor, valueTag, name)
      }
    }

    return message as IppMessage
  } catch (error) {
    throw new IppParseError({
      message: String(error),
    })
  }
}
