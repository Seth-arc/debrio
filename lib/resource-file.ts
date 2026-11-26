import { createHash } from "node:crypto";
import { connect } from "node:net";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_PDF_PAGES = 2000;
export const FILE_BUCKET_STAGING = "debrio-file-quarantine";
export const FILE_BUCKET_READY = "debrio-file-ready";

export class FileValidationError extends Error {
  readonly code: "invalid_file" | "scan_unavailable" | "malware_detected";
  constructor(code: "invalid_file" | "scan_unavailable" | "malware_detected") {
    super(code);
    this.code = code;
  }
}

export function fileSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateFileName(name: string, mime: string) {
  if (
    name.length < 1 ||
    name.length > 120 ||
    /[/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name) ||
    !(
      (mime === "application/pdf" && name.endsWith(".pdf")) ||
      (mime === "text/plain" && name.endsWith(".txt"))
    )
  )
    throw new FileValidationError("invalid_file");
  return name;
}

export async function validateFileBytes(
  bytes: Uint8Array,
  name: string,
  mime: string
) {
  validateFileName(name, mime);
  if (!bytes.length || bytes.length > FILE_MAX_BYTES)
    throw new FileValidationError("invalid_file");
  if (mime === "text/plain") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new FileValidationError("invalid_file");
    }
    if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
      throw new FileValidationError("invalid_file");
    if (/^\s*(?:<!doctype\s+html|<html\b|<svg\b|<\?xml\b)/iu.test(text))
      throw new FileValidationError("invalid_file");
    if (/^\s*(?:%PDF-|MZ|PK\u0003\u0004|\x7fELF)/u.test(text))
      throw new FileValidationError("invalid_file");
  } else {
    const source = Buffer.from(bytes);
    const raw = source.toString("latin1");
    if (
      !raw.startsWith("%PDF-") ||
      !/%%EOF[\r\n \t]*$/u.test(raw) ||
      /\/(?:JS|JavaScript|AA|OpenAction|Launch|EmbeddedFiles|AcroForm|XFA|RichMedia|Filespec)(?![A-Za-z])/iu.test(
        raw
      ) ||
      /\/(?:Encrypt|Collection)(?![A-Za-z])/iu.test(raw)
    )
      throw new FileValidationError("invalid_file");
    let task: ReturnType<typeof getDocument> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      task = getDocument({
        data: Uint8Array.from(source),
        disableAutoFetch: true,
        stopAtErrors: true,
        useSystemFonts: false,
      });
      await Promise.race([
        (async () => {
          const pdf = await task!.promise;
          if (!pdf.numPages || pdf.numPages > FILE_MAX_PDF_PAGES)
            throw Error("page_count");
          if (
            (await pdf.getJSActions()) ||
            (await pdf.getAttachments()) ||
            (await pdf.getFieldObjects())
          )
            throw Error("active_pdf");
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            if (await page.getJSActions()) throw Error("active_pdf");
            for (const annotation of await page.getAnnotations()) {
              if (
                annotation.jsAction ||
                annotation.action === "Launch" ||
                annotation.attachment ||
                /^javascript:/iu.test(annotation.unsafeUrl ?? "")
              )
                throw Error("active_pdf");
            }
          }
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(Error("pdf_timeout")), 30000);
        }),
      ]);
    } catch {
      throw new FileValidationError("invalid_file");
    } finally {
      clearTimeout(timeout);
      void task?.destroy().catch(() => undefined);
    }
  }
  return { sha256: fileSha256(bytes), size: bytes.byteLength, mime, name };
}

async function clamdCommand(
  host: string,
  port: number,
  command: Buffer,
  payload?: Uint8Array
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let response = "";
    const timer = setTimeout(
      () => socket.destroy(Error("scan_timeout")),
      30000
    );
    socket.on("connect", () => {
      socket.write(command);
      if (payload) {
        for (let offset = 0; offset < payload.length; offset += 65536) {
          const chunk = payload.subarray(offset, offset + 65536);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      }
    });
    socket.on("data", (data: Buffer) => {
      response += data.toString("utf8");
      if (response.length > 512) socket.destroy(Error("scan_response_limit"));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(response.replace(/\u0000+$/u, "").trim());
    });
  });
}

export async function scanFileBytes(
  bytes: Uint8Array,
  host = process.env.CLAMAV_HOST,
  port = Number(process.env.CLAMAV_PORT ?? 3310)
) {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new FileValidationError("scan_unavailable");
  try {
    const version = await clamdCommand(host, port, Buffer.from("zVERSION\0"));
    const match = /^ClamAV ([\w.]+)\/\d+\/(.+)$/u.exec(version);
    const signaturesAt = match && new Date(`${match[2]} UTC`);
    if (
      !match ||
      !signaturesAt ||
      !Number.isFinite(signaturesAt.valueOf()) ||
      signaturesAt.valueOf() > Date.now() ||
      Date.now() - signaturesAt.valueOf() > 24 * 60 * 60 * 1000
    )
      throw Error("stale_signatures");
    const verdict = await clamdCommand(
      host,
      port,
      Buffer.from("zINSTREAM\0"),
      bytes
    );
    if (/ FOUND$/u.test(verdict))
      throw new FileValidationError("malware_detected");
    if (verdict !== "stream: OK") throw Error("scan_failed");
    return {
      scanner: `ClamAV ${match[1]}`,
      signaturesAt: signaturesAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError("scan_unavailable");
  }
}
