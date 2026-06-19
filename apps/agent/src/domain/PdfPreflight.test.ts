import { describe, expect, it } from "@effect/vitest"

import { decidePdfPreflight, parsePdfInfoSummary } from "./PdfPreflight.js"

describe("PDF preflight policy", () => {
  it("accepts readable unencrypted PDFs with a page count", () => {
    expect(
      decidePdfPreflight({
        exitCode: 0,
        signal: null,
        stdout: `
Title:           Statement
Pages:           3
Encrypted:       no
        `,
        stderr: "",
      }),
    ).toEqual({
      _tag: "Accepted",
      summary: {
        encrypted: false,
        pages: 3,
      },
    })
  })

  it("rejects encrypted PDFs even when pdfinfo can read metadata", () => {
    expect(
      decidePdfPreflight({
        exitCode: 0,
        signal: null,
        stdout: `
Pages:           1
Encrypted:       yes (print:yes copy:no change:no addNotes:no algorithm:AES)
        `,
        stderr: "",
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "encrypted",
    })
  })

  it("rejects PDFs that pdfinfo cannot open", () => {
    expect(
      decidePdfPreflight({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "Command Line Error: Incorrect password",
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "pdfinfo-failed",
    })
  })

  it("rejects PDFs without a trustworthy page count", () => {
    expect(
      decidePdfPreflight({
        exitCode: 0,
        signal: null,
        stdout: "Encrypted: no",
        stderr: "",
      }),
    ).toMatchObject({
      _tag: "Rejected",
      reason: "missing-page-count",
    })
  })

  it("parses pdfinfo fields case-insensitively", () => {
    expect(
      parsePdfInfoSummary(`
encrypted:       No
pages:           12
      `),
    ).toEqual({
      encrypted: false,
      pages: 12,
    })
  })
})
