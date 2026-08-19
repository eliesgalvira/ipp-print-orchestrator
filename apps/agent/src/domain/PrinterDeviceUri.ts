export const isPhysicalUsbDeviceUri = (installedUri: string): boolean =>
  installedUri.startsWith("usb://") ||
  installedUri.startsWith("ipp-orch-usb://")
