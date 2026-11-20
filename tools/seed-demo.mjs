// Faqat DEMO_MODE=1 da va ingredient bazasi bo'sh bo'lganda: 5 ta DEMO yozuv (ilmiy tasdiqlanmagan; baholarsiz).
import { loadDotEnv } from '../src/config.mjs';
loadDotEnv();
import { initDb, db, tx } from '../src/db.mjs';
import { normInci, inciVariants } from '../src/util.mjs';

if (process.env.DEMO_MODE !== '1' || process.env.NODE_ENV === 'production') { console.error('Rad etildi: seed:demo faqat DEMO_MODE=1 va production bo\'lmagan muhitda ishlaydi.'); process.exit(2); }
initDb();
if (db().prepare('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 0').get().n > 0) { console.error("Haqiqiy ingredientlar mavjud — demo yozuvlar qo'shilmadi (nom to'qnashuvining oldini olish uchun)."); process.exit(2); }
// Umumiy, keng ma'lum CosIng funksiya nomlari xolos; skin/homiladorlik/iqlim bo'yicha HECH QANDAY da'vo yo'q.
const DEMO = [
  ['Aqua', 'Suv', 'SOLVENT', "Erituvchi vazifasini bajaradi."],
  ['Glycerin', 'Glitserin', 'HUMECTANT; SKIN CONDITIONING', 'Namlovchi sifatida tasniflanadi.'],
  ['Cetearyl Alcohol', 'Setearil spirt', 'EMOLLIENT; EMULSION STABILISING', "Yumshatuvchi va emulsiya barqarorlashtiruvchi sifatida tasniflanadi."],
  ['Sodium Hyaluronate', 'Natriy gialuronat', 'HUMECTANT; SKIN CONDITIONING', 'Namlovchi sifatida tasniflanadi.'],
  ['Niacinamide', 'Niatsinamid', 'SKIN CONDITIONING', 'Teri holatini yaxshilovchi vosita sifatida tasniflanadi.'],
];
tx((d) => {
  for (const [inci, uz, fn, desc] of DEMO) {
    const key = 'demo-' + normInci(inci);
    if (d.prepare('SELECT 1 FROM ingredients WHERE key = ?').get(key)) continue;
    const id = Number(d.prepare("INSERT INTO ingredients(key, inci, inci_norm, uz_name, cosing_functions, function_uz, description_uz, review_status, status, is_demo) VALUES (?,?,?,?,?,?,?,'DEMO — ilmiy tasdiqlanmagan','draft',1)")
      .run(key, inci, normInci(inci), uz.replace('ув', 'uv'), fn, desc, 'DEMO yozuv: faqat dastur imkoniyatlarini ko\'rsatish uchun. Ilmiy jihatdan tasdiqlanmagan.').lastInsertRowid);
    inciVariants(inci).forEach((v) => d.prepare('INSERT OR IGNORE INTO ingredient_aliases(ingredient_id, alias_norm, kind) VALUES (?,?,?)').run(id, v, 'inci'));
    inciVariants(uz).forEach((v) => d.prepare('INSERT OR IGNORE INTO ingredient_aliases(ingredient_id, alias_norm, kind) VALUES (?,?,?)').run(id, v, 'uz'));
  }
});
console.log("5 ta DEMO ingredient qo'shildi (is_demo=1). Haqiqiy import qilinganda ular avtomatik o'chiriladi.");
