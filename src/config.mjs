// Sozlamalar: har chaqiruvda process.env dan o'qiladi (testlarda o'zgartirish mumkin).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let envLoaded = false;
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (envLoaded) return;
  envLoaded = true;
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const flt = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const flag = (v) => v === '1' || v === 'true';

export function cfg() {
  const e = process.env;
  const dataDir = path.resolve(ROOT, e.DATA_DIR || './data');
  return {
    isProd: e.NODE_ENV === 'production',
    port: int(e.PORT, 3000),
    publicUrl: e.PUBLIC_URL || `http://localhost:${int(e.PORT, 3000)}`,
    dataDir,
    uploadDir: path.join(dataDir, 'uploads'),
    dbPath: e.DB_PATH || path.join(dataDir, 'saydan.db'),
    superAdminEmail: (e.SUPER_ADMIN_EMAIL || '').trim().toLowerCase(),
    sessionTtlHours: int(e.SESSION_TTL_HOURS, 336),
    ocrProvider: e.OCR_PROVIDER || 'tesseract',
    tesseractBin: e.TESSERACT_BIN || 'tesseract',
    ocrLangs: e.OCR_LANGS || 'eng+rus',
    uploadRetentionHours: int(e.UPLOAD_RETENTION_HOURS, 24),
    maxUploadBytes: int(e.MAX_UPLOAD_MB, 6) * 1024 * 1024,
    barcodeProvider: e.BARCODE_PROVIDER || 'openbeautyfacts',
    barcodeUserAgent: e.BARCODE_USER_AGENT || 'SAYDAN/0.1',
    mailProvider: e.MAIL_PROVIDER || 'console',
    mailFrom: e.MAIL_FROM || '',
    mailFromName: e.MAIL_FROM_NAME || 'SAYDAN',
    brevoApiKey: e.BREVO_API_KEY || '',
    resendApiKey: e.RESEND_API_KEY || '',
    freeMonthlyLimit: int(e.FREE_MONTHLY_ANALYSIS_LIMIT, 10),
    proMonthlyLimit: int(e.PRO_MONTHLY_ANALYSIS_LIMIT, 200),
    freeHistoryVisible: int(e.FREE_HISTORY_VISIBLE, 5),
    scoreMinCoverage: flt(e.SCORE_MIN_COVERAGE, 0.6),
    scoreMinAssessed: int(e.SCORE_MIN_ASSESSED, 3),
    demoMode: flag(e.DEMO_MODE),
    paymentProvider: e.PAYMENT_PROVIDER || 'none',
    paymentSandboxSecret: e.PAYMENT_SANDBOX_SECRET || '',
    referralRewardEnabled: flag(e.REFERRAL_REWARD_ENABLED),
    profileKey: e.PROFILE_ENCRYPTION_KEY || '',
  };
}
