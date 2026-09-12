/**
 * A services list as typed: one per line. A single line is split on
 * semicolons if it has any (so a service can contain a comma), otherwise on
 * commas. Bullets are stripped and repeats dropped.
 */
export function parseServices(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const parts = lines.length > 1 ? lines : text.includes(";") ? text.split(";") : text.split(",");
  return [...new Set(parts.map((s) => s.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean))];
}
