/**
 * Handling for untrusted display strings (token names/symbols, explorer labels,
 * revert reasons). React escapes HTML, but spoofing is still possible with
 * bidirectional overrides, zero-width characters and very long strings.
 */

// Bidi controls, zero-width/invisible formatting characters, and other C0/C1 controls.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿­]/g;

export interface CleanText {
  text: string;
  /** True when characters were removed or the value was truncated. */
  altered: boolean;
  reasons: string[];
}

export function cleanUntrusted(value: unknown, maxLength = 64): CleanText | null {
  if (typeof value !== 'string') return null;
  const reasons: string[] = [];
  let text = value.normalize('NFC');
  const stripped = text.replace(INVISIBLE, '');
  if (stripped !== text) reasons.push('removed invisible or direction-control characters');
  text = stripped.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) {
    text = text.slice(0, maxLength - 1) + '…';
    reasons.push(`truncated to ${maxLength} characters`);
  }
  if (!text) return null;
  return { text, altered: reasons.length > 0, reasons };
}

export function cleanText(value: unknown, maxLength = 64): string | null {
  return cleanUntrusted(value, maxLength)?.text ?? null;
}
