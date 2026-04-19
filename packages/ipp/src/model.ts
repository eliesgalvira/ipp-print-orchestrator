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

export interface IppCollection {
  readonly [name: string]: IppAttributeValue
}

export interface IppAttributeGroup {
  readonly [name: string]: IppAttributeValue
}

export interface IppMessage {
  readonly version?: string
  readonly operation?: string
  readonly statusCode?: string
  readonly id?: number
  readonly data?: Buffer
  readonly "operation-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "job-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "printer-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "unsupported-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "subscription-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "event-notification-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "resource-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "document-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly [groupName: string]: unknown
}

export interface IppRequestMessage {
  readonly data?: Buffer
  readonly "operation-attributes-tag"?: IppAttributeGroup
  readonly "job-attributes-tag"?: IppAttributeGroup
  readonly "printer-attributes-tag"?: IppAttributeGroup
  readonly "subscription-attributes-tag"?: IppAttributeGroup
  readonly "document-attributes-tag"?: IppAttributeGroup
}

export interface IppResponseMessage {
  readonly data?: Buffer
  readonly "operation-attributes-tag"?: IppAttributeGroup
  readonly "job-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "printer-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "unsupported-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "subscription-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "event-notification-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "resource-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
  readonly "document-attributes-tag"?:
    | IppAttributeGroup
    | readonly IppAttributeGroup[]
}

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
