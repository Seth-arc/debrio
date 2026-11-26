import { expect, test } from "vitest";
import {
  FileValidationError,
  fileSha256,
  scanFileBytes,
  validateFileBytes,
} from "../../lib/resource-file";

const bytes = (text: string) => new TextEncoder().encode(text);

test("TXT acceptance checks bytes, UTF-8, controls, name and exact size", async () => {
  const valid = bytes("Synthetic private handout\n");
  expect(await validateFileBytes(valid, "handout.txt", "text/plain")).toEqual({
    sha256: fileSha256(valid),
    size: valid.length,
    mime: "text/plain",
    name: "handout.txt",
  });
  for (const [file, name, mime] of [
    [bytes(""), "x.txt", "text/plain"],
    [new Uint8Array([0xc3, 0x28]), "x.txt", "text/plain"],
    [bytes("bad\u0000"), "x.txt", "text/plain"],
    [bytes("<html>"), "x.html", "text/plain"],
    [bytes("<html>script</html>"), "x.txt", "text/plain"],
    [bytes("%PDF-1.4\nsynthetic"), "x.txt", "text/plain"],
    [bytes("x"), "../x.txt", "text/plain"],
    [bytes("x"), "report\u202efdp.txt", "text/plain"],
    [bytes("x"), "x.txt", "application/pdf"],
  ] as const)
    await expect(validateFileBytes(file, name, mime)).rejects.toBeInstanceOf(
      FileValidationError
    );
  await expect(
    validateFileBytes(new Uint8Array(10485761), "x.txt", "text/plain")
  ).rejects.toBeInstanceOf(FileValidationError);
});

test("PDF policy refuses malformed and active-form payloads", async () => {
  for (const payload of [
    "%PDF-1.4\n%%EOF\nZIP",
    "%PDF-1.4\n/JavaScript\n%%EOF",
    "%PDF-1.4\n/AcroForm\n%%EOF",
    "MZ%PDF-1.4\n%%EOF",
  ])
    await expect(
      validateFileBytes(bytes(payload), "handout.pdf", "application/pdf")
    ).rejects.toBeInstanceOf(FileValidationError);
});

test("a minimal well-formed passive PDF is accepted", async () => {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await expect(
    validateFileBytes(bytes(pdf), "passive.pdf", "application/pdf")
  ).resolves.toMatchObject({ mime: "application/pdf" });
});

test("scanner fails closed without a configured reachable engine", async () => {
  await expect(
    scanFileBytes(bytes("synthetic"), undefined)
  ).rejects.toMatchObject({
    code: "scan_unavailable",
  });
  await expect(
    scanFileBytes(bytes("synthetic"), "127.0.0.1", 1)
  ).rejects.toMatchObject({ code: "scan_unavailable" });
});
