export type IppScalarValue =
  | string
  | number
  | boolean
  | null
  | readonly [number, number]
  | readonly [number, number, "dpi" | "dpcm"]
  | Date
  | IppCollection

export type IppAttributeValue = IppScalarValue | readonly IppAttributeValue[]

export interface IppAttribute {
  readonly name: string
  readonly value: IppAttributeValue
}

export interface IppCollection {
  readonly members: readonly IppAttribute[]
}

export interface IppAttributeGroup {
  readonly tag: string
  readonly attributes: readonly IppAttribute[]
}

export interface IppMessage {
  readonly version: string
  readonly operation?: string
  readonly statusCode?: string
  readonly id: number
  readonly groups: readonly IppAttributeGroup[]
  readonly data?: Buffer
}

export interface IppAttributeMap {
  readonly [name: string]: IppAttributeValue
}

export interface IppRequestMessage {
  readonly data?: Buffer
  readonly "operation-attributes-tag"?: IppAttributeMap
  readonly "job-attributes-tag"?: IppAttributeMap
  readonly "printer-attributes-tag"?: IppAttributeMap
  readonly "subscription-attributes-tag"?: IppAttributeMap
  readonly "document-attributes-tag"?: IppAttributeMap
}

export interface IppResponseMessage {
  readonly data?: Buffer
  readonly "operation-attributes-tag"?: IppAttributeMap
  readonly "job-attributes-tag"?: IppAttributeMap
  readonly "printer-attributes-tag"?: IppAttributeMap
  readonly "unsupported-attributes-tag"?: IppAttributeMap
  readonly "subscription-attributes-tag"?: IppAttributeMap
  readonly "event-notification-attributes-tag"?: IppAttributeMap
  readonly "resource-attributes-tag"?: IppAttributeMap
  readonly "document-attributes-tag"?: IppAttributeMap
}

export const attributeGroups = (
  message: IppMessage,
  tag: string,
): readonly IppAttributeGroup[] =>
  message.groups.filter((group) => group.tag === tag)

export const attributeValues = (
  group: IppAttributeGroup,
  name: string,
): readonly IppAttributeValue[] =>
  group.attributes
    .filter((attribute) => attribute.name === name)
    .map((attribute) => attribute.value)

export interface SerializeIppRequestOptions {
  readonly operation: string
  readonly printerUri: string
  readonly message?: IppRequestMessage | null
  readonly version?: string
  readonly requestId?: number
  readonly language?: string
  readonly charset?: string
}

export interface SerializeIppResponseOptions {
  readonly statusCode: string
  readonly message?: IppResponseMessage | null
  readonly version?: string
  readonly requestId?: number
}

export type SerializeIppMessageOptions =
  | ({
      readonly operation: string
      readonly statusCode?: never
      readonly version?: string
      readonly requestId?: number
      readonly message?: IppRequestMessage | null
    } & Record<never, never>)
  | ({
      readonly statusCode: string
      readonly operation?: never
      readonly version?: string
      readonly requestId?: number
      readonly message?: IppResponseMessage | null
    } & Record<never, never>)

export interface IppExecuteRequest {
  readonly endpoint: string
  readonly printerUri: string
  readonly operation: string
  readonly message?: IppRequestMessage | null
  readonly version?: string
  readonly language?: string
  readonly charset?: string
}

export interface IppPrinterOptions {
  readonly endpoint: string
  readonly uri: string
  readonly version?: string
  readonly language?: string
  readonly charset?: string
}
