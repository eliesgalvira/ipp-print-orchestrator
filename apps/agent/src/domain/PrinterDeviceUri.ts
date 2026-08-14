export interface PhysicalUsbDeviceUri {
  readonly installedUri: string
  readonly physicalUri: string
  readonly serial: string | null
  readonly matchTokens: readonly string[]
}

const normalizeSerial = (value: string | null): string | null => {
  if (value === null) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}

const normalizeMatchTokens = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0)

const physicalUri = (installedUri: string): string | null => {
  if (installedUri.startsWith("usb://")) {
    return installedUri
  }
  if (installedUri.startsWith("ipp-orch-usb://")) {
    return `usb://${installedUri.slice("ipp-orch-usb://".length)}`
  }
  return null
}

export const parsePhysicalUsbDeviceUri = (
  installedUri: string,
): PhysicalUsbDeviceUri | null => {
  const normalizedUri = physicalUri(installedUri)
  if (normalizedUri === null) {
    return null
  }

  try {
    const url = new URL(normalizedUri)
    const manufacturer = decodeURIComponent(url.hostname)
    const product = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    return {
      installedUri,
      physicalUri: normalizedUri,
      serial: normalizeSerial(url.searchParams.get("serial")),
      matchTokens: normalizeMatchTokens(`${manufacturer} ${product}`),
    }
  } catch {
    return null
  }
}

export const isPhysicalUsbDeviceUri = (installedUri: string): boolean =>
  parsePhysicalUsbDeviceUri(installedUri) !== null
