// A `Content-Disposition` filename built from user-supplied data (the
// original uploaded filename) - never interpolated into the header raw. The
// quoted-ASCII form is a fallback for clients that don't read `filename*`;
// both are derived the same way so neither can disagree with the other.
export function attachmentContentDisposition(originalName: string): string {
  // Printable ASCII only (0x20-0x7E) - this also strips CR/LF, so neither form
  // below can be used to inject extra header lines or parameters.
  const asciiFallback = originalName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "'")
    .replace(/\\/g, "_");
  const encoded = encodeURIComponent(originalName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
