import uz from './uz.js';
const dicts = { uz };
let lang = 'uz';
export function setLang(l) { if (dicts[l]) { lang = l; document.documentElement.lang = l; } }
export function t(key, vars = {}) {
  const s = dicts[lang]?.[key] ?? dicts.uz[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
