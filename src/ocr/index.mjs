// OCR provayder adapteri: boshqa provayderga (masalan bulutli OCR) almashtirish uchun bitta joy.
import { cfg } from '../config.mjs';
import * as tesseract from './tesseract.mjs';

const providers = { tesseract };
export function provider() {
  return providers[cfg().ocrProvider] || null;
}
export async function ocrStatus() {
  const p = provider();
  if (!p) return { available: false, provider: cfg().ocrProvider, detail: 'noma\'lum OCR provayder' };
  return p.status();
}
export async function recognize(filePath, opts) {
  const p = provider();
  if (!p) return { ok: false, error: 'provider_unavailable' };
  return p.recognize(filePath, opts);
}
