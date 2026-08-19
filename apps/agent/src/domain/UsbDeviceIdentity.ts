export interface UsbDeviceIdentity {
  readonly vendorId: string
  readonly productId: string
  readonly serial: string | null
}

const normalizeHexId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^0+(?=[0-9a-f])/, "")

const normalizeSerial = (value: string | null): string | null => {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized.length === 0 ? null : normalized
}

export const makeUsbDeviceIdentity = (input: {
  readonly vendorId: string
  readonly productId: string
  readonly serial?: string | null
}): UsbDeviceIdentity => ({
  vendorId: normalizeHexId(input.vendorId),
  productId: normalizeHexId(input.productId),
  serial: normalizeSerial(input.serial ?? null),
})

export const usbDeviceIdentityMatches = (
  target: UsbDeviceIdentity,
  candidate: UsbDeviceIdentity,
): boolean =>
  target.vendorId === candidate.vendorId &&
  target.productId === candidate.productId &&
  (target.serial === null || target.serial === candidate.serial)

export const udevProductMatchesUsbIdentity = (
  line: string,
  identity: UsbDeviceIdentity,
): boolean => {
  const separator = line.indexOf("=")
  if (separator < 0 || line.slice(0, separator) !== "PRODUCT") {
    return false
  }

  const [vendorId, productId] = line.slice(separator + 1).split("/")
  if (vendorId === undefined || productId === undefined) {
    return false
  }

  const eventIdentity = makeUsbDeviceIdentity({ vendorId, productId })
  return (
    eventIdentity.vendorId === identity.vendorId &&
    eventIdentity.productId === identity.productId
  )
}
