import http from 'node:http';
import { cfg, loadDotEnv } from './src/config.mjs';
loadDotEnv();
import { initDb, db } from './src/db.mjs';
import { handleApi, serveStatic, sendJson, SECURITY_HEADERS } from './src/http.mjs';
import { purgeExpired } from './src/uploads.mjs';
import './src/routes/auth.mjs';
import './src/routes/public.mjs';
import './src/routes/analysis.mjs';
import './src/routes/pro.mjs';
import './src/routes/community.mjs';
import './src/routes/admin.mjs';

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
    return serveStatic(req, res, url);
  });
}

export function startServer() {
  const c = cfg();
  if (c.isProd && c.demoMode) { console.error('DEMO_MODE productionda yoqilmasligi kerak.'); process.exit(1); }
  if (c.isProd && c.paymentProvider === 'sandbox') { console.error('PAYMENT_PROVIDER=sandbox productionda mumkin emas.'); process.exit(1); }
  initDb();
  purgeExpired();
  setInterval(() => { try { purgeExpired(); } catch (e) { console.error('purge xato:', e.message); } }, 3600000).unref();
  createServer().listen(c.port, () => {
    console.log(`SAYDAN ishga tushdi: ${c.publicUrl}`);
    console.log(c.superAdminEmail ? 'Super Admin email sozlangan (qiymat ko\'rsatilmaydi).' : "OGOHLANTIRISH: SUPER_ADMIN_EMAIL sozlanmagan — admin paneliga hech kim kira olmaydi.");
    if (c.demoMode) console.log('DEMO_MODE yoqilgan: demo Pro faqat sinov uchun.');
    const n = db().prepare('SELECT COUNT(*) n FROM ingredients').get().n;
    if (!n) console.log("Ingredient bazasi bo'sh: `npm run import -- <ingrident.xlsx>` yoki admin panelidan import qiling.");
  });
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
