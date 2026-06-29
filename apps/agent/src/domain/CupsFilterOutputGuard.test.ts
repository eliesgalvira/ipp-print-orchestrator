import { describe, expect, it } from "@effect/vitest"

import {
  countCupsPageLogEntries,
  countGhostscriptProcessedPages,
  decideCupsCopiesGuard,
  decideSplOutputGuard,
  hasSplBlankPageSuppression,
  parseCupsCopies,
} from "./CupsFilterOutputGuard.js"

describe("CUPS filter output guard", () => {
  it("accepts one reported driver page for a one-page PDF under the byte limit", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 207_217,
        filterStderr:
          "DEBUG2: cupsRaster\nPAGE: 1 1\nATTR: job-media-progress=100\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Accepted",
      expectedPages: 1,
      observedPages: 1,
    })
  })

  it("rejects multiple CUPS copies", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "2",
        splBytes: 207_217,
        filterStderr: "PAGE: 1 1\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "invalid-copies",
    })
  })

  it("rejects missing final driver page logs", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 207_217,
        filterStderr: "INFO: Rendering completed\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "missing-page-log",
    })
  })

  it("rejects empty final output even when the driver reports a PAGE line", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 0,
        filterStderr: "PAGE: 1 1\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "empty-output",
      expectedPages: 1,
      observedPages: 1,
    })
  })

  it("rejects final driver page counts that do not match pdfinfo", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 207_217,
        filterStderr: "PAGE: 1 1\nPAGE: 2 1\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "unexpected-page-count",
      expectedPages: 1,
      observedPages: 2,
    })
  })

  it("rejects final output without PAGE logs even when upstream Ghostscript logs are present", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 196_606,
        filterStderr:
          "INFO: cfFilterGhostscript: Processing page 1...\nINFO: cfFilterGhostscript: Processing page 2...\n",
        maxBytesPerPage: 64 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "missing-page-log",
    })
  })

  it("rejects final output above the page byte budget", () => {
    expect(
      decideSplOutputGuard({
        pdfPages: 1,
        copies: "1",
        splBytes: 11,
        filterStderr: "PAGE: 1 1\n",
        maxBytesPerPage: 10,
        maxTotalBytes: 100,
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "oversized-output",
      maxBytes: 10,
    })
  })

  it("counts PAGE lines case-insensitively and ignores progress attributes", () => {
    expect(
      countCupsPageLogEntries(
        "ATTR: job-media-progress=50\npage: 1 1\nPAGE: 2 1\n",
      ),
    ).toBe(2)
  })

  it("counts Ghostscript processing lines from cupsFilter stderr", () => {
    expect(
      countGhostscriptProcessedPages(
        "INFO: cfFilterGhostscript: Processing page 1...\nINFO: cfFilterGhostscript: Processing page 2...\n",
      ),
    ).toBe(2)
  })

  it("counts Ghostscript processing lines without cfFilterGhostscript prefix", () => {
    expect(
      countGhostscriptProcessedPages(
        "INFO: Processing page 1...\nINFO: Processing page 2...\n",
      ),
    ).toBe(2)
  })

  it("detects SPL blank-page suppression in the PJL header", () => {
    expect(hasSplBlankPageSuppression("@PJL SET XIGNOREFF=ON\n")).toBe(true)
    expect(hasSplBlankPageSuppression("@PJL SET XIGNOREFF=OFF\n")).toBe(false)
  })

  it("parses positive integer copy counts", () => {
    expect(parseCupsCopies("1")).toBe(1)
    expect(parseCupsCopies("03")).toBe(3)
    expect(parseCupsCopies("0")).toBeNull()
    expect(parseCupsCopies("not-a-number")).toBeNull()
  })

  it("classifies copy counts before expensive rendering", () => {
    expect(decideCupsCopiesGuard("1")).toEqual({
      _tag: "Accepted",
      copies: 1,
    })
    expect(decideCupsCopiesGuard("2")).toMatchObject({
      _tag: "Rejected",
      reason: "invalid-copies",
    })
  })
})
