// Header labels and spreadsheet column names can be in any script (including
// Kannada). Field keys are stored in Supabase text columns and used as JSON
// object keys, so Unicode is safe — only punctuation/whitespace needs folding.
// Using the ASCII-only /[a-z0-9]/ ranges here would turn a Kannada label into an
// empty key and stop the header being saved or matched on upload.

const LETTER_NUMBER_MARK = /[\p{L}\p{N}\p{M}]/u
const NON_LETTER_NUMBER_MARK = /[^\p{L}\p{N}\p{M}]+/gu

export function normalizeHeader(value: string): string {
  return Array.from(value.normalize('NFC').toLocaleLowerCase())
    .filter((character) => LETTER_NUMBER_MARK.test(character))
    .join('')
}

export function fieldKeyFromLabel(label: string, maxLength = 80): string {
  const cleaned = label
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(NON_LETTER_NUMBER_MARK, '_')
    .replace(/^_+|_+$/g, '')
  return Array.from(cleaned).slice(0, maxLength).join('')
}
