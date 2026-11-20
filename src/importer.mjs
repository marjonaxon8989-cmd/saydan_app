// ingrident.xlsx importeri. Takrorlanadigan (idempotent), qator darajasida xatolarni hisobot qiladi,
// hech qachon ingredientni avtomatik "tasdiqlangan" qilmaydi.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, tx } from './db.mjs';
import { normInci, inciVariants } from './util.mjs';
import { audit } from './audit.mjs';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools');

export const EXPECTED = { Ingredientlar: 329, Funksiyalar: 83, Funksiyalar_birga: 7, Muqobillar: 200, "To'qnashuvlar": 5 };
export const SHEET_ALIASES = {
  ingredients: ['Ingredientlar'], functions: ['Funksiyalar'], groups: ['Funksiyalar_birga'],
  alternatives: ['Muqobillar'], conflicts: ["To'qnashuvlar", 'Toqnashuvlar', "To‘qnashuvlar", 'To`qnashuvlar'],
  readme: ['README'],
};

const normHeader = (h) => String(h ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’‘`ʻʼ]/g, '').replace(/\s+/g, ' ').trim();

// Maydon -> sarlavha namunalari (ustuvorlik tartibida; har sarlavha faqat bitta maydonga biriktiriladi).
// Haqiqiy fayl sarlavhalari tekshirilgunga qadar bu taxminiy: hisobotdagi header_mapping ni ko'rib chiqing yoki --map bilan aniq ko'rsating.
const FIELD_PATTERNS = {
  ingredients: [
    ['inci', /inci/], ['pharmacist_comment', /(farmatsevt|pharmac).*(izoh|comment|sharh)/], ['pharmacist_approved', /(farmatsevt|pharmac).*(tasdiq|approv)/],
    ['pubchem_en', /^pubchem|pubchem.*(asl|original|en\b)/], ['function_uz', /^vazifasi oddiy|(oddiy|sodda|simple).*(tilda|funk)/],
    ['cosing_functions', /cosing.*(funk|function)|^funk.*cosing/], ['description_uz', /^nima ekanligi|^(tavsif|tarif|description|ingredient tavsifi)/],
    ['detailed_explanation', /^eng asosiysi|batafsil|detailed|manbali tushuntirish/], ['safety_general', /^mos ekanligi|(umumiy.*xavfsiz|general.*safe|xavfsizlik)/],
    ['pregnancy_info', /homilad|pregnan/], ['oily_info', /yogli|oily/], ['dry_info', /quruq|dry/], ['sensitive_info', /sezuvchan|sezgir|sensitive/],
    ['eu_restrictions', /(eu|yevro|evro).*(cheklov|restrict|maks|max|konsentr)/], ['eu_allergen', /allergen/], ['sccs', /sccs/], ['cir', /^cir|cir.*(report|hisobot)/],
    ['cas', /^cas|cas\s*(raqam|number|no)/], ['synonyms', /sinonim|synonym|kimyoviy nom|chemical name/], ['uz_name', /^ozbekcha nomi|(ozbek|uzb|uz).*(nom|name|tarjima)/],
    ['source_urls', /manba|source|url|havola|link/], ['review_status', /^holat|^status|review|tekshiruv/],
    ['record_no', /^(no|n|#|raqam|tartib|record|id)\b|^\u2116/],
  ],
  functions: [
    ['name_en', /cosing|english|inglizcha|^funksiya$|^function$|^funksiya nomi/], ['name_uz', /ozbek|uzbek|^uz\b/],
    ['definition_uz', /ta.?rif|definition|izoh|tushun/], ['ingredient_count', /soni|count|number|miqdor/], ['examples', /misol|example/], ['source', /manba|source|url|havola/],
  ],
  groups: [
    ['name', /guruh|group|^nom|name/], ['pharmacist_comment', /(farmatsevt|pharmac).*(izoh|comment|sharh)/], ['pharmacist_approved', /(farmatsevt|pharmac).*(tasdiq|approv)/],
    ['description', /qanday birga|tavsif|description|tushun/], ['examples', /misol|example/], ['sources', /manba|source|url|havola/], ['review_status', /holat|status|review|tekshiruv/],
  ],
  alternatives: [
    ['main_inci', /(asosiy|main).*inci|^inci.*(asosiy|main)/], ['main_uz', /(asosiy|main).*(ozbek|uz|nom)/], ['main_tag', /(asosiy|main).*(teg|tag|tur|type)/],
    ['alt_inci', /(muqobil|alternativ).*inci|^inci.*(muqobil|alternativ)/], ['alt_uz', /(muqobil|alternativ).*(ozbek|uz|nom)/], ['alt_tag', /(muqobil|alternativ).*(teg|tag|tur|type)/],
    ['shared_functions', /umumiy.*funk|shared|common/], ['similarity', /oxshash|similar|ball|score|foiz/], ['differences', /farq|difference/], ['sources', /manba|source|url|havola/],
    ['pharmacist_comment', /(farmatsevt|pharmac).*(izoh|comment|sharh)/], ['pharmacist_approved', /(farmatsevt|pharmac).*(tasdiq|approv)/], ['review_status', /holat|status|review|tekshiruv/],
  ],
  conflicts: [
    ['interaction_type', /tur|type|kategor/], ['description', /tavsif|description|izoh|tushun|sabab/], ['sources', /manba|source|url|havola/],
    ['pharmacist_comment', /(farmatsevt|pharmac).*(izoh|comment|sharh)/], ['pharmacist_approved', /(farmatsevt|pharmac).*(tasdiq|approv)/], ['review_status', /holat|status|review|tekshiruv/],
  ],
};

export function mapHeaders(kind, headers, override = null) {
  const mapping = {};
  const used = new Set();
  const normed = headers.map(normHeader);
  if (override) {
    for (const [field, header] of Object.entries(override)) {
      const idx = headers.findIndex((h) => h === header);
      if (idx >= 0) { mapping[field] = headers[idx]; used.add(idx); }
    }
  }
  for (const [field, re] of FIELD_PATTERNS[kind]) {
    if (mapping[field]) continue;
    const idx = normed.findIndex((h, i) => !used.has(i) && re.test(h));
    if (idx >= 0) { mapping[field] = headers[idx]; used.add(idx); }
  }
  if (kind === 'conflicts') {
    const cols = normed.map((h, i) => [h, i]).filter(([h, i]) => !used.has(i) && /inci|modda|ingredient/.test(h));
    if (cols[0] && !mapping.ingredient_a) { mapping.ingredient_a = headers[cols[0][1]]; used.add(cols[0][1]); }
    if (cols[1] && !mapping.ingredient_b) { mapping.ingredient_b = headers[cols[1][1]]; used.add(cols[1][1]); }
  }
  const unmapped = headers.filter((_, i) => !used.has(i));
  return { mapping, unmapped };
}

const val = (row, mapping, f) => (mapping[f] ? String(row.cells[mapping[f]] ?? '').trim() : '');
const yes = (s) => /^(y|yes|ha|1|true|\+)$/i.test(String(s).trim());
const num = (s) => { const n = parseFloat(String(s).replace(',', '.').replace('%', '')); return Number.isFinite(n) ? n : null; };
const hasUrl = (s) => /https?:\/\//i.test(String(s ?? ''));

export function xlsxToJson(xlsxPath) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'saydan-imp-')), 'wb.json');
  try {
    execFileSync('python3', ['-I', path.join(TOOLS, 'xlsx_to_json.py'), xlsxPath, out], { timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error("XLSX o'qib bo'lmadi (python3 + openpyxl kerak): " + String(e.stderr || e.message).slice(0, 300));
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function findSheet(wb, names) {
  for (const n of names) if (wb.sheets[n]) return { name: n, sheet: wb.sheets[n] };
  const lower = Object.keys(wb.sheets).find((k) => names.some((n) => normHeader(k) === normHeader(n)));
  return lower ? { name: lower, sheet: wb.sheets[lower] } : null;
}

export function importWorkbook(wb, { actor = null, fileName = null, mappingOverride = {} } = {}) {
  const report = { file: fileName, at: new Date().toISOString(), sheets: {}, validation: {}, complete: false, errors: [] };

  // ---- Ingredientlar ----
  const ing = findSheet(wb, SHEET_ALIASES.ingredients);
  const R = (k, extra) => (report.sheets[k] = { expected: EXPECTED[k] ?? null, found_sheet: !!extra?.found, source_rows: 0, imported_new: 0, updated: 0, unchanged_skipped_modified: 0, errors: [], header_mapping: {}, unmapped_headers: [], ...extra });

  const stats = { urlsSource: 0, urlsDb: 0 };
  tx((d) => {
    if (!ing) { R('Ingredientlar', { found: false }); report.errors.push({ sheet: 'Ingredientlar', row: null, reason: 'varaq topilmadi' }); }
    else {
      const rep = R('Ingredientlar', { found: true });
      const { mapping, unmapped } = mapHeaders('ingredients', ing.sheet.headers, mappingOverride.ingredients);
      rep.header_mapping = mapping; rep.unmapped_headers = unmapped;
      if (!mapping.inci) {
        const reason = `INCI ustuni topilmadi. Sarlavhalar: ${ing.sheet.headers.join(' | ')}. --map bilan ko'rsating.`;
        rep.errors.push({ sheet: ing.name, row: null, reason }); report.errors.push({ sheet: ing.name, row: null, reason });
      } else {
        d.prepare('DELETE FROM ingredients WHERE is_demo = 1').run();   // demo yozuvlar haqiqiy bazani almashtirganda olib tashlanadi
        const seenKeys = new Map();
        const upsert = d.prepare(`INSERT INTO ingredients (key, record_no, inci, inci_norm, uz_name, synonyms, cas, cosing_functions, function_uz, description_uz, pubchem_en, detailed_explanation,
          safety_general, pregnancy_info, oily_info, dry_info, sensitive_info, eu_restrictions, eu_allergen, sccs, cir, source_urls, review_status, pharmacist_approved, pharmacist_comment, status, raw_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)
          ON CONFLICT(key) DO UPDATE SET record_no=excluded.record_no, inci=excluded.inci, uz_name=excluded.uz_name, synonyms=excluded.synonyms, cas=excluded.cas, cosing_functions=excluded.cosing_functions,
          function_uz=excluded.function_uz, description_uz=excluded.description_uz, pubchem_en=excluded.pubchem_en, detailed_explanation=excluded.detailed_explanation, safety_general=excluded.safety_general,
          pregnancy_info=excluded.pregnancy_info, oily_info=excluded.oily_info, dry_info=excluded.dry_info, sensitive_info=excluded.sensitive_info, eu_restrictions=excluded.eu_restrictions,
          eu_allergen=excluded.eu_allergen, sccs=excluded.sccs, cir=excluded.cir, source_urls=excluded.source_urls, review_status=excluded.review_status,
          pharmacist_approved=excluded.pharmacist_approved, pharmacist_comment=excluded.pharmacist_comment, raw_json=excluded.raw_json, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
        for (const row of ing.sheet.rows) {
          const inci = val(row, mapping, 'inci');
          if (!inci) { if (Object.values(row.cells).some(Boolean)) rep.errors.push({ sheet: ing.name, row: row.row, reason: 'INCI nomi bo\'sh' }); continue; }
          rep.source_rows++;
          const key = normInci(inci);
          if (!key) { rep.errors.push({ sheet: ing.name, row: row.row, reason: 'INCI normallashtirishdan keyin bo\'sh' }); continue; }
          if (seenKeys.has(key)) { rep.errors.push({ sheet: ing.name, row: row.row, reason: `takroriy INCI kaliti (${seenKeys.get(key)}-qator bilan bir xil); birlashtirilmadi` }); continue; }
          seenKeys.set(key, row.row);
          const f = (k) => val(row, mapping, k) || null;
          const existing = d.prepare('SELECT id FROM ingredients WHERE key = ?').get(key);
          if (existing) {
            const manual = d.prepare("SELECT 1 FROM ingredient_history WHERE ingredient_id = ? AND change_type != 'import' LIMIT 1").get(existing.id);
            if (manual) { rep.unchanged_skipped_modified++; stats.urlsDb += hasUrl(f('source_urls')) ? 1 : 0; if (hasUrl(f('source_urls'))) stats.urlsSource++; continue; }
          }
          const raw = JSON.stringify({ sheet: ing.name, row: row.row, cells: row.cells });
          upsert.run(key, f('record_no'), inci, key, f('uz_name'), f('synonyms'), f('cas'), f('cosing_functions'), f('function_uz'), f('description_uz'), f('pubchem_en'), f('detailed_explanation'),
            f('safety_general'), f('pregnancy_info'), f('oily_info'), f('dry_info'), f('sensitive_info'), f('eu_restrictions'), f('eu_allergen'), f('sccs'), f('cir'), f('source_urls'), f('review_status'),
            yes(val(row, mapping, 'pharmacist_approved')) ? 1 : 0, f('pharmacist_comment'), raw);
          const id = d.prepare('SELECT id FROM ingredients WHERE key = ?').get(key).id;
          if (existing) rep.updated++; else rep.imported_new++;
          d.prepare("INSERT INTO ingredient_history(ingredient_id, changed_by, change_type, after_json) VALUES (?,?,?,?)").run(id, actor, 'import', JSON.stringify({ file: fileName, row: row.row }));
          if (hasUrl(f('source_urls'))) stats.urlsSource++;
          // alias'lar: qayta import'da to'liq qayta quriladi
          d.prepare('DELETE FROM ingredient_aliases WHERE ingredient_id = ?').run(id);
          const addAlias = (norm, kind) => { if (norm) d.prepare('INSERT OR IGNORE INTO ingredient_aliases(ingredient_id, alias_norm, kind) VALUES (?,?,?)').run(id, norm, kind); };
          inciVariants(inci).forEach((v) => addAlias(v, 'inci'));
          if (f('uz_name')) inciVariants(f('uz_name')).forEach((v) => addAlias(v, 'uz'));
          for (const s of String(f('synonyms') || '').split(/[,;\n|]+/)) inciVariants(s).forEach((v) => addAlias(v, 'synonym'));
          for (const c of String(f('cas') || '').split(/[,;\s]+/)) if (/^\d{2,7}-\d{2}-\d$/.test(c)) addAlias(c, 'cas');
        }
        const dbRows = d.prepare('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 0').get().n;
        rep.in_database_now = dbRows;
      }
    }

    // ---- Funksiyalar ----
    const fn = findSheet(wb, SHEET_ALIASES.functions);
    if (!fn) { R('Funksiyalar', { found: false }); report.errors.push({ sheet: 'Funksiyalar', row: null, reason: 'varaq topilmadi' }); }
    else {
      const rep = R('Funksiyalar', { found: true });
      const { mapping, unmapped } = mapHeaders('functions', fn.sheet.headers, mappingOverride.functions);
      rep.header_mapping = mapping; rep.unmapped_headers = unmapped;
      if (!mapping.name_en) rep.errors.push({ sheet: fn.name, row: null, reason: 'CosIng (inglizcha) nom ustuni topilmadi' });
      else for (const row of fn.sheet.rows) {
        const nameEn = val(row, mapping, 'name_en');
        if (!nameEn) continue;
        rep.source_rows++;
        const key = normInci(nameEn);
        const had = d.prepare('SELECT id FROM functions WHERE key = ?').get(key);
        d.prepare(`INSERT INTO functions(key, name_en, name_uz, definition_uz, ingredient_count, examples, source, raw_json) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET name_en=excluded.name_en, name_uz=excluded.name_uz, definition_uz=excluded.definition_uz, ingredient_count=excluded.ingredient_count, examples=excluded.examples, source=excluded.source, raw_json=excluded.raw_json`)
          .run(key, nameEn, val(row, mapping, 'name_uz') || null, val(row, mapping, 'definition_uz') || null, num(val(row, mapping, 'ingredient_count')), val(row, mapping, 'examples') || null, val(row, mapping, 'source') || null, JSON.stringify({ sheet: fn.name, row: row.row, cells: row.cells }));
        had ? rep.updated++ : rep.imported_new++;
      }
    }

    // ---- Funksiyalar_birga ----
    const gr = findSheet(wb, SHEET_ALIASES.groups);
    if (!gr) { R('Funksiyalar_birga', { found: false }); report.errors.push({ sheet: 'Funksiyalar_birga', row: null, reason: 'varaq topilmadi' }); }
    else {
      const rep = R('Funksiyalar_birga', { found: true });
      const { mapping, unmapped } = mapHeaders('groups', gr.sheet.headers, mappingOverride.groups);
      rep.header_mapping = mapping; rep.unmapped_headers = unmapped;
      if (!mapping.name) rep.errors.push({ sheet: gr.name, row: null, reason: 'guruh nomi ustuni topilmadi' });
      else for (const row of gr.sheet.rows) {
        const name = val(row, mapping, 'name');
        if (!name) continue;
        rep.source_rows++;
        const key = normInci(name);
        const had = d.prepare('SELECT id FROM function_groups WHERE key = ?').get(key);
        d.prepare(`INSERT INTO function_groups(key, name, description, examples, sources, review_status, pharmacist_approved, pharmacist_comment, raw_json) VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET name=excluded.name, description=excluded.description, examples=excluded.examples, sources=excluded.sources, review_status=excluded.review_status, pharmacist_approved=excluded.pharmacist_approved, pharmacist_comment=excluded.pharmacist_comment, raw_json=excluded.raw_json`)
          .run(key, name, val(row, mapping, 'description') || null, val(row, mapping, 'examples') || null, val(row, mapping, 'sources') || null, val(row, mapping, 'review_status') || null, yes(val(row, mapping, 'pharmacist_approved')) ? 1 : 0, val(row, mapping, 'pharmacist_comment') || null, JSON.stringify({ sheet: gr.name, row: row.row, cells: row.cells }));
        had ? rep.updated++ : rep.imported_new++;
      }
    }

    // ---- Muqobillar ----
    const idByNorm = (s) => {
      const r = d.prepare("SELECT ingredient_id FROM ingredient_aliases WHERE alias_norm = ? AND kind = 'inci'").all(normInci(s));
      const ids = [...new Set(r.map((x) => x.ingredient_id))];
      return ids.length === 1 ? ids[0] : null;
    };
    const al = findSheet(wb, SHEET_ALIASES.alternatives);
    if (!al) { R('Muqobillar', { found: false }); report.errors.push({ sheet: 'Muqobillar', row: null, reason: 'varaq topilmadi' }); }
    else {
      const rep = R('Muqobillar', { found: true, linked_main: 0, linked_alt: 0 });
      const { mapping, unmapped } = mapHeaders('alternatives', al.sheet.headers, mappingOverride.alternatives);
      rep.header_mapping = mapping; rep.unmapped_headers = unmapped;
      if (!mapping.main_inci || !mapping.alt_inci) rep.errors.push({ sheet: al.name, row: null, reason: 'asosiy/muqobil INCI ustunlari topilmadi' });
      else for (const row of al.sheet.rows) {
        const mi = val(row, mapping, 'main_inci'), ai = val(row, mapping, 'alt_inci');
        if (!mi || !ai) { if (Object.values(row.cells).some(Boolean)) rep.errors.push({ sheet: al.name, row: row.row, reason: 'asosiy yoki muqobil INCI bo\'sh' }); continue; }
        rep.source_rows++;
        const key = normInci(mi) + '|' + normInci(ai);
        const mid = idByNorm(mi), aid = idByNorm(ai);
        if (mid) rep.linked_main++; if (aid) rep.linked_alt++;
        const had = d.prepare('SELECT id FROM alternatives WHERE key = ?').get(key);
        d.prepare(`INSERT INTO alternatives(key, main_inci, main_uz, main_tag, alt_inci, alt_uz, alt_tag, shared_functions, similarity, differences, sources, review_status, pharmacist_approved, pharmacist_comment, main_ingredient_id, alt_ingredient_id, raw_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET main_inci=excluded.main_inci, main_uz=excluded.main_uz, main_tag=excluded.main_tag, alt_inci=excluded.alt_inci, alt_uz=excluded.alt_uz, alt_tag=excluded.alt_tag, shared_functions=excluded.shared_functions,
          similarity=excluded.similarity, differences=excluded.differences, sources=excluded.sources, review_status=excluded.review_status, pharmacist_approved=excluded.pharmacist_approved, pharmacist_comment=excluded.pharmacist_comment,
          main_ingredient_id=excluded.main_ingredient_id, alt_ingredient_id=excluded.alt_ingredient_id, raw_json=excluded.raw_json`)
          .run(key, mi, val(row, mapping, 'main_uz') || null, val(row, mapping, 'main_tag') || null, ai, val(row, mapping, 'alt_uz') || null, val(row, mapping, 'alt_tag') || null, val(row, mapping, 'shared_functions') || null,
            num(val(row, mapping, 'similarity')), val(row, mapping, 'differences') || null, val(row, mapping, 'sources') || null, val(row, mapping, 'review_status') || null,
            yes(val(row, mapping, 'pharmacist_approved')) ? 1 : 0, val(row, mapping, 'pharmacist_comment') || null, mid, aid, JSON.stringify({ sheet: al.name, row: row.row, cells: row.cells }));
        had ? rep.updated++ : rep.imported_new++;
      }
    }

    // ---- To'qnashuvlar ----
    const cf = findSheet(wb, SHEET_ALIASES.conflicts);
    if (!cf) { R("To'qnashuvlar", { found: false }); report.errors.push({ sheet: "To'qnashuvlar", row: null, reason: 'varaq topilmadi' }); }
    else {
      const rep = R("To'qnashuvlar", { found: true });
      const { mapping, unmapped } = mapHeaders('conflicts', cf.sheet.headers, mappingOverride.conflicts);
      rep.header_mapping = mapping; rep.unmapped_headers = unmapped;
      if (!mapping.ingredient_a || !mapping.ingredient_b) rep.errors.push({ sheet: cf.name, row: null, reason: 'ikkita ingredient ustuni topilmadi' });
      else for (const row of cf.sheet.rows) {
        const a = val(row, mapping, 'ingredient_a'), b = val(row, mapping, 'ingredient_b');
        if (!a || !b) continue;
        rep.source_rows++;
        const key = [normInci(a), normInci(b)].sort().join('|') + '|' + normInci(val(row, mapping, 'interaction_type'));
        const had = d.prepare('SELECT id FROM conflicts WHERE key = ?').get(key);
        d.prepare(`INSERT INTO conflicts(key, ingredient_a, ingredient_b, interaction_type, description, sources, review_status, pharmacist_approved, pharmacist_comment, a_ingredient_id, b_ingredient_id, raw_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET ingredient_a=excluded.ingredient_a, ingredient_b=excluded.ingredient_b, interaction_type=excluded.interaction_type, description=excluded.description, sources=excluded.sources,
          review_status=excluded.review_status, pharmacist_approved=excluded.pharmacist_approved, pharmacist_comment=excluded.pharmacist_comment, a_ingredient_id=excluded.a_ingredient_id, b_ingredient_id=excluded.b_ingredient_id, raw_json=excluded.raw_json`)
          .run(key, a, b, val(row, mapping, 'interaction_type') || null, val(row, mapping, 'description') || null, val(row, mapping, 'sources') || null, val(row, mapping, 'review_status') || null,
            yes(val(row, mapping, 'pharmacist_approved')) ? 1 : 0, val(row, mapping, 'pharmacist_comment') || null, idByNorm(a), idByNorm(b), JSON.stringify({ sheet: cf.name, row: row.row, cells: row.cells }));
        had ? rep.updated++ : rep.imported_new++;
      }
    }
  });

  // ---- Tekshiruv ----
  const rep = report.sheets;
  const count = (t, where = '') => db().prepare(`SELECT COUNT(*) n FROM ${t} ${where}`).get().n;
  report.validation = {
    ingredients_in_db: count('ingredients', 'WHERE is_demo = 0'), functions_in_db: count('functions'), groups_in_db: count('function_groups'),
    alternatives_in_db: count('alternatives'), conflicts_in_db: count('conflicts'),
    ingredients_not_draft: count('ingredients', "WHERE is_demo = 0 AND status != 'draft'"),
    ingredients_pharmacist_approved_flag: count('ingredients', 'WHERE is_demo = 0 AND pharmacist_approved = 1'),
    source_rows_with_urls: stats.urlsSource,
    ingredients_with_urls_in_db: count('ingredients', "WHERE is_demo = 0 AND source_urls LIKE '%http%'"),
    alternatives_main_linked: count('alternatives', 'WHERE main_ingredient_id IS NOT NULL'), alternatives_alt_linked: count('alternatives', 'WHERE alt_ingredient_id IS NOT NULL'),
  };
  const checks = [];
  const exp = (sheet, dbCount, label) => { if (rep[sheet]?.expected != null) checks.push({ check: label, expected: rep[sheet].expected, source_rows: rep[sheet].source_rows, in_database: dbCount, ok: rep[sheet].source_rows === rep[sheet].expected && dbCount >= rep[sheet].expected && !rep[sheet].errors.length }); };
  exp('Ingredientlar', report.validation.ingredients_in_db, 'ingredientlar');
  exp('Funksiyalar', report.validation.functions_in_db, 'funksiyalar');
  exp('Funksiyalar_birga', report.validation.groups_in_db, 'birlashgan funksiya guruhlari');
  exp('Muqobillar', report.validation.alternatives_in_db, 'muqobil juftliklar');
  exp("To'qnashuvlar", report.validation.conflicts_in_db, "to'qnashuv yozuvlari");
  report.validation.checks = checks;
  report.complete = checks.length === 5 && checks.every((c) => c.ok) && report.errors.length === 0 && Object.values(rep).every((s) => !s.errors?.length);
  report.note = report.complete
    ? 'Kutilgan sonlar bilan to\'liq mos keldi.'
    : "TO'LIQ EMAS: kutilgan sonlar yoki ustun moslashuvi mos kelmadi. Xatolar va header_mapping ni tekshiring; to'liq tasdiqlanmaguncha import tugagan hisoblanmaydi.";
  db().prepare('INSERT INTO import_runs(file_name, actor, ok, report_json) VALUES (?,?,?,?)').run(fileName, actor, report.complete ? 1 : 0, JSON.stringify(report));
  audit(actor, 'ingredient_import', fileName, { complete: report.complete, ingredients: report.validation.ingredients_in_db });
  return report;
}

export function importXlsxFile(xlsxPath, opts = {}) {
  if (!fs.existsSync(xlsxPath)) throw new Error(`Fayl topilmadi: ${xlsxPath}. Asl ingrident.xlsx kerak; import bajarilmadi.`);
  return importWorkbook(xlsxToJson(xlsxPath), { fileName: path.basename(xlsxPath), ...opts });
}
