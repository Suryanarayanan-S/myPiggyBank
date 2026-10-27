/**
 * Masks what could identify a person or an account before text leaves the server for the AI:
 * emails and UPI handles, IBANs (also lower case, glued to a label or cut off), Indian PANs,
 * phone numbers, card numbers and other long digit runs (customer, account and mandate numbers,
 * also glued to letters). Words that name a payee, short numbers, dates and amounts stay.
 */
const MASKS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, '[email]'],
  [/\+\d{1,3}[\d /-]{6,}\d/g, '[phone]'],
  [/[A-Z]{2}\d{2} ?[A-Z0-9]{4}(?: ?\d{1,4})+/gi, '[IBAN]'],
  [/(?<![A-Z])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])/gi, '[PAN]'],
  [/(?<!\d)\d{4}(?:[ -]\d{4}){2,3}(?!\d)/g, '[number]'],
  [/(?<!\d)0\d{2,5}[ /-]\d{5,}(?!\d)/g, '[phone]'],
  [/(?<!\d)\d{6,}(?!\d)/g, '[number]'],
];

export function redact(text: string): string {
  return MASKS.reduce((s, [pattern, mask]) => s.replace(pattern, mask), text);
}
