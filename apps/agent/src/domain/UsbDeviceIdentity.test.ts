import { describe, expect, it } from "@effect/vitest"

import {
  makeUsbDeviceIdentity,
  udevProductMatchesUsbIdentity,
  usbDeviceIdentityMatches,
} from "./UsbDeviceIdentity.js"

describe("UsbDeviceIdentity", () => {
  const target = makeUsbDeviceIdentity({
    vendorId: "03F0",
    productId: "f22a",
    serial: "ABC123",
  })

  it("matches VID, PID, and configured serial exactly", () => {
    expect(
      usbDeviceIdentityMatches(
        target,
        makeUsbDeviceIdentity({
          vendorId: "3f0",
          productId: "F22A",
          serial: "abc123",
        }),
      ),
    ).toBe(true)
    expect(
      usbDeviceIdentityMatches(
        target,
        makeUsbDeviceIdentity({
          vendorId: "3f0",
          productId: "ffff",
          serial: "abc123",
        }),
      ),
    ).toBe(false)
  })

  it("filters udev PRODUCT properties by VID and PID", () => {
    expect(udevProductMatchesUsbIdentity("PRODUCT=3f0/f22a/100", target)).toBe(
      true,
    )
    expect(udevProductMatchesUsbIdentity("PRODUCT=3f0/ffff/100", target)).toBe(
      false,
    )
    expect(udevProductMatchesUsbIdentity("ACTION=add", target)).toBe(false)
  })
})
