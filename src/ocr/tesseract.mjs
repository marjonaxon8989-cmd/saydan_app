// Tesseract CLI adapteri. Shell ishlatilmaydi (execFile), fayl yo'li serverda yaratilgan.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from '../config.mjs';
const run = promisify(execFile);

export async function status() {
  try {
    const { stdout, stderr } = await run(cfg().tesseractBin, ['--version'], { timeout: 5000 });
    const v = (stdout || stderr).split('\n')[0];
    return { available: true, provider: 'tesseract', detail: v.trim() };
  } catch {
    return { available: false, provider: 'tesseract', detail: 'tesseract topilmadi' };
  }
}

export async function recognize(filePath, { signal } = {}) {
  const c = cfg();
  try {
    const { stdout } = await run(c.tesseractBin, [filePath, 'stdout', '-l', c.ocrLangs, '--psm', '6', 'tsv'],
      { timeout: 60000, maxBuffer: 16 * 1024 * 1024, signal });
    const lines = new Map();
    const words = [];
    for (const row of stdout.split('\n').slice(1)) {
      const f = row.split('\t');
      if (f.length < 12 || f[0] !== '5') continue;
      const conf = parseFloat(f[10]);
      const text = f.slice(11).join('\t').trim();
      if (!text) continue;
      const k = `${f[2]}-${f[3]}-${f[4]}`;
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k).push(text);
      words.push({ text, conf: Number.isFinite(conf) ? conf : 0 });
    }
    const text = [...lines.values()].map((w) => w.join(' ')).join('\n').trim();
    const mean = words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : 0;
    if (!text) return { ok: false, error: 'no_text' };
    return { ok: true, text, words, meanConfidence: Math.round(mean * 10) / 10 };
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: false, error: 'provider_unavailable' };
    if (e?.killed) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'ocr_failed' };
  }
}
