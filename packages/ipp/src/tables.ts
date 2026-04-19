export interface IppAttributeSyntax {
  readonly type:
    | "boolean"
    | "charset"
    | "dateTime"
    | "enum"
    | "integer"
    | "keyword"
    | "mimeMediaType"
    | "name"
    | "naturalLanguage"
    | "octetString"
    | "rangeOfInteger"
    | "resolution"
    | "text"
    | "uri"
    | "uriScheme"
  readonly tag?: number
}

const reverseLookup = <T extends Record<string, number>>(table: T) =>
  Object.fromEntries(
    Object.entries(table).map(([name, code]) => [code, name]),
  ) as Record<number, keyof T & string>

const reverseNestedLookup = <T extends Record<string, Record<number, string>>>(
  table: T,
) =>
  Object.fromEntries(
    Object.entries(table).map(([name, values]) => [
      name,
      Object.fromEntries(
        Object.entries(values).map(([code, value]) => [value, Number(code)]),
      ),
    ]),
  ) as Record<string, Record<string, number>>

export const ippVersions = {
  "1.0": 0x0100,
  "1.1": 0x0101,
  "2.0": 0x0200,
  "2.1": 0x0201,
} as const

export const ippVersionsByCode = reverseLookup(ippVersions)

export const ippOperations = {
  "Print-Job": 0x0002,
  "Print-URI": 0x0003,
  "Validate-Job": 0x0004,
  "Create-Job": 0x0005,
  "Send-Document": 0x0006,
  "Send-URI": 0x0007,
  "Cancel-Job": 0x0008,
  "Get-Job-Attributes": 0x0009,
  "Get-Jobs": 0x000a,
  "Get-Printer-Attributes": 0x000b,
  "Pause-Printer": 0x0010,
  "Resume-Printer": 0x0011,
  "Create-Printer-Subscriptions": 0x0016,
  "Create-Job-Subscription": 0x0017,
  "Get-Subscription-Attributes": 0x0018,
  "Get-Subscriptions": 0x0019,
  "Renew-Subscription": 0x001a,
  "Cancel-Subscription": 0x001b,
  "Get-Notifications": 0x001c,
  "Identify-Printer": 0x003c,
} as const

export const ippOperationsByCode = reverseLookup(ippOperations)

export const ippStatusCodes = {
  "successful-ok": 0x0000,
  "successful-ok-ignored-or-substituted-attributes": 0x0001,
  "successful-ok-conflicting-attributes": 0x0002,
  "successful-ok-ignored-subscriptions": 0x0003,
  "successful-ok-ignored-notifications": 0x0004,
  "successful-ok-too-many-events": 0x0005,
  "successful-ok-but-cancel-subscription": 0x0006,
  "successful-ok-events-complete": 0x0007,
  "client-error-bad-request": 0x0400,
  "client-error-forbidden": 0x0401,
  "client-error-not-authenticated": 0x0402,
  "client-error-not-authorized": 0x0403,
  "client-error-not-possible": 0x0404,
  "client-error-timeout": 0x0405,
  "client-error-not-found": 0x0406,
  "client-error-gone": 0x0407,
  "client-error-request-entity-too-large": 0x0408,
  "client-error-request-value-too-long": 0x0409,
  "client-error-document-format-not-supported": 0x040a,
  "client-error-attributes-or-values-not-supported": 0x040b,
  "client-error-uri-scheme-not-supported": 0x040c,
  "client-error-charset-not-supported": 0x040d,
  "client-error-conflicting-attributes": 0x040e,
  "client-error-compression-not-supported": 0x040f,
  "client-error-compression-error": 0x0410,
  "client-error-document-format-error": 0x0411,
  "client-error-document-access-error": 0x0412,
  "client-error-attributes-not-settable": 0x0413,
  "client-error-ignored-all-subscriptions": 0x0414,
  "client-error-too-many-subscriptions": 0x0415,
  "server-error-internal-error": 0x0500,
  "server-error-operation-not-supported": 0x0501,
  "server-error-service-unavailable": 0x0502,
  "server-error-version-not-supported": 0x0503,
  "server-error-device-error": 0x0504,
  "server-error-temporary-error": 0x0505,
  "server-error-not-accepting-jobs": 0x0506,
  "server-error-busy": 0x0507,
  "server-error-job-canceled": 0x0508,
  "server-error-multiple-document-jobs-not-supported": 0x0509,
  "server-error-printer-is-deactivated": 0x050a,
  "server-error-too-many-jobs": 0x050b,
  "server-error-too-many-documents": 0x050c,
} as const

export const ippStatusCodesByCode = reverseLookup(ippStatusCodes)

export const ippTags = {
  "operation-attributes-tag": 0x01,
  "job-attributes-tag": 0x02,
  "end-of-attributes-tag": 0x03,
  "printer-attributes-tag": 0x04,
  "unsupported-attributes-tag": 0x05,
  "subscription-attributes-tag": 0x06,
  "event-notification-attributes-tag": 0x07,
  "resource-attributes-tag": 0x08,
  "document-attributes-tag": 0x09,
  unsupported: 0x10,
  default: 0x11,
  unknown: 0x12,
  "no-value": 0x13,
  "not-settable": 0x15,
  "delete-attribute": 0x16,
  "admin-define": 0x17,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
  extension: 0x7f,
} as const

export const ippTagsByCode = reverseLookup(ippTags)

export const ippEnumValues = {
  finishings: {
    3: "none",
    4: "staple",
    5: "punch",
    6: "cover",
    7: "bind",
    8: "saddle-stitch",
    9: "edge-stitch",
    10: "fold",
  },
  "document-state": {
    3: "pending",
    5: "processing",
    7: "canceled",
    8: "aborted",
    9: "completed",
  },
  "job-state": {
    3: "pending",
    4: "pending-held",
    5: "processing",
    6: "processing-stopped",
    7: "canceled",
    8: "aborted",
    9: "completed",
  },
  "job-printer-state": {
    3: "idle",
    4: "processing",
    5: "stopped",
  },
  "orientation-requested": {
    3: "portrait",
    4: "landscape",
    5: "reverse-landscape",
    6: "reverse-portrait",
  },
  "print-quality": {
    3: "draft",
    4: "normal",
    5: "high",
  },
  "printer-state": {
    3: "idle",
    4: "processing",
    5: "stopped",
  },
} as const satisfies Record<string, Record<number, string>>

export const ippEnumCodes = reverseNestedLookup(ippEnumValues)

export const operationAttributeSyntax = {
  "attributes-charset": { type: "charset" },
  "attributes-natural-language": { type: "naturalLanguage" },
  compression: { type: "keyword" },
  "document-format": { type: "mimeMediaType" },
  "job-name": { type: "name" },
  "printer-uri": { type: "uri" },
  "job-uri": { type: "uri" },
  "job-id": { type: "integer", tag: ippTags.integer },
  "requesting-user-name": { type: "name" },
  "requested-attributes": { type: "keyword" },
  "notify-subscription-id": { type: "integer", tag: ippTags.integer },
  "notify-subscription-ids": { type: "integer", tag: ippTags.integer },
  "notify-sequence-numbers": { type: "integer", tag: ippTags.integer },
  "notify-wait": { type: "boolean", tag: ippTags.boolean },
  "notify-get-interval": { type: "integer", tag: ippTags.integer },
  "status-message": { type: "text" },
} as const satisfies Record<string, IppAttributeSyntax>

export const subscriptionAttributeSyntax = {
  "notify-pull-method": { type: "keyword" },
  "notify-events": { type: "keyword" },
  "notify-lease-duration": { type: "integer", tag: ippTags.integer },
  "notify-subscription-id": { type: "integer", tag: ippTags.integer },
} as const satisfies Record<string, IppAttributeSyntax>

export const jobAttributeSyntax = {
  copies: { type: "integer", tag: ippTags.integer },
  finishings: { type: "enum", tag: ippTags.enum },
  "job-id": { type: "integer", tag: ippTags.integer },
  "job-hold-until-time": { type: "dateTime", tag: ippTags.dateTime },
  "job-media-sheets-completed": { type: "integer", tag: ippTags.integer },
  "job-printer-state": { type: "enum", tag: ippTags.enum },
  "job-printer-state-message": { type: "text" },
  "job-printer-state-reasons": { type: "keyword" },
  "job-state": { type: "enum", tag: ippTags.enum },
  "job-state-reasons": { type: "keyword" },
  "job-uri": { type: "uri" },
  "notify-subscription-id": { type: "integer", tag: ippTags.integer },
  "orientation-requested": { type: "enum", tag: ippTags.enum },
  "print-quality": { type: "enum", tag: ippTags.enum },
  "printer-resolution": { type: "resolution", tag: ippTags.resolution },
  "requested-attributes": { type: "keyword" },
  sides: { type: "keyword" },
} as const satisfies Record<string, IppAttributeSyntax>

export const printerAttributeSyntax = {
  "media-col-database": { type: "octetString" },
  "printer-is-accepting-jobs": { type: "boolean", tag: ippTags.boolean },
  "printer-make-and-model": { type: "text" },
  "printer-message-from-operator": { type: "text" },
  "printer-name": { type: "name" },
  "printer-state": { type: "enum", tag: ippTags.enum },
  "printer-state-message": { type: "text" },
  "printer-state-reasons": { type: "keyword" },
  "queued-job-count": { type: "integer", tag: ippTags.integer },
  "requested-attributes": { type: "keyword" },
} as const satisfies Record<string, IppAttributeSyntax>

export const documentAttributeSyntax = {
  "document-format": { type: "mimeMediaType" },
} as const satisfies Record<string, IppAttributeSyntax>

export const groupAttributeSyntax = {
  "operation-attributes-tag": [operationAttributeSyntax],
  "job-attributes-tag": [jobAttributeSyntax],
  "printer-attributes-tag": [printerAttributeSyntax],
  "unsupported-attributes-tag": [jobAttributeSyntax, printerAttributeSyntax],
  "subscription-attributes-tag": [subscriptionAttributeSyntax],
  "event-notification-attributes-tag": [
    jobAttributeSyntax,
    printerAttributeSyntax,
  ],
  "resource-attributes-tag": [] as const,
  "document-attributes-tag": [documentAttributeSyntax],
} as const

export const orderedRequestGroups = [
  "operation-attributes-tag",
  "job-attributes-tag",
  "printer-attributes-tag",
  "subscription-attributes-tag",
  "document-attributes-tag",
] as const
