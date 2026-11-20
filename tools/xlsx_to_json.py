#!/usr/bin/env python3
"""ingrident.xlsx -> JSON (har bir varaq: sarlavhalar + qatorlar, asl qator raqami bilan).
Hech narsa filtrlanmaydi/qisqartirilmaydi. Gipermurojaatlar (hyperlink) URL sifatida qo'shiladi.
Ishlatish: python3 -I xlsx_to_json.py <fayl.xlsx> <chiqish.json>"""
import json, sys
import openpyxl

def cell_text(c):
    v = c.value
    if v is None:
        s = ''
    elif isinstance(v, float) and v.is_integer():
        s = str(int(v))
    else:
        s = str(v).strip()
    link = getattr(c.hyperlink, 'target', None) if c.hyperlink else None
    if link and link not in s:
        s = (s + ' ' + link).strip()
    return s

def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)  # formulalar o'rniga saqlangan qiymatlar
    out = {'sheets': {}}
    for ws in wb.worksheets:
        rows = [(r[0].row, [cell_text(c) for c in r]) for r in ws.iter_rows()]
        rows = [(n, vals) for n, vals in rows if any(vals)]
        if not rows:
            out['sheets'][ws.title] = {'headers': [], 'rows': [], 'header_row': None, 'raw_lines': []}
            continue
        # sarlavha qatori: kamida 3 ta to'ldirilgan katak bo'lgan birinchi qator
        hdr_idx = next((i for i, (_, v) in enumerate(rows) if sum(1 for x in v if x) >= 3), 0)
        hdr_row, headers = rows[hdr_idx]
        headers = [h or f'col_{i+1}' for i, h in enumerate(headers)]
        data = []
        for n, vals in rows[hdr_idx + 1:]:
            data.append({'row': n, 'cells': {headers[i]: (vals[i] if i < len(vals) else '') for i in range(len(headers))}})
        out['sheets'][ws.title] = {
            'headers': headers, 'header_row': hdr_row, 'rows': data,
            'raw_lines': [' | '.join(x for x in v if x) for _, v in rows[:200]],
        }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Ishlatish: xlsx_to_json.py <fayl.xlsx> <chiqish.json>')
    main(sys.argv[1], sys.argv[2])
