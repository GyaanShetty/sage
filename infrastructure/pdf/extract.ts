/**
 * Text out of a PDF.
 *
 * Extracted here rather than inline at each call site because of one ordering
 * trap: pdfjs reaches for DOMMatrix while its module is still evaluating, so
 * the browser-global stubs must be installed *before* the import, not after.
 * Getting that wrong throws on import, which reads like a broken file rather
 * than a broken environment.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { installPdfGlobals } = await import("./node-globals");
  installPdfGlobals();

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } finally {
    // The parser holds a worker; leaving it open leaks across invocations.
    await parser.destroy?.().catch?.(() => undefined);
  }
}
