/**
 * Numbers are compared in E.164 (+441223912555). Signal sends what the carrier
 * reported; people type numbers the way they read them ("01223 912555",
 * "+44 (0)1223 912555"). A national number starting with 0 is read as UK —
 * anything else needs its country code.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.replace(/\(0\)/g, "").trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0") && digits.length === 11) digits = `44${digits.slice(1)}`;
    else if (!(digits.startsWith("44") && digits.length === 12)) return null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/**
 * A stored number the way it's read in the UK: "07863 750472", "020 7946 0000",
 * "0300 123 4567". Anything that isn't a UK number stays as stored.
 */
export function formatPhone(e164: string): string {
  if (!/^\+44\d{10}$/.test(e164)) return e164;
  const national = `0${e164.slice(3)}`;
  if (national.startsWith("02")) return `${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
  if (/^0[3589]/.test(national)) return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}

/** Splits a list (one per line, or comma/semicolon-separated) into good and bad numbers. */
export function parsePhoneList(text: string): { numbers: string[]; invalid: string[] } {
  const numbers = new Set<string>();
  const invalid: string[] = [];
  for (const entry of text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const phone = normalizePhone(entry);
    if (phone) numbers.add(phone);
    else invalid.push(entry);
  }
  return { numbers: [...numbers], invalid };
}
