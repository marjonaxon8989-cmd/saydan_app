# SAYDAN — kosmetika ingredientlari bo'yicha ma'lumot platformasi

Haqiqiy ishlaydigan veb-ilova: yorliq rasmi/matni → OCR → ingredientlarni tekshirib tuzatish → SAYDAN bazasi bilan moslashtirish → manbali natija. UI: o'zbek (lotin).

> **Muhim:** SAYDAN tibbiy tashxis qo'ymaydi. Ingredient yozuvlari import qilinganda **qoralama** bo'ladi va avtomatik tasdiqlanmaydi. Foiz faqat quruq/yog'li teri uchun, yetarli *tasdiqlangan* baholar bo'lgandagina hisoblanadi; iqlim va homiladorlik hech qachon foizga aylantirilmaydi.

## Ishga tushirish

Internetga chiqarish: DEPLOY.md. Talab: Node.js 22+ (ichki `node:sqlite`), `tesseract` (OCR, ixtiyoriy), Python 3 + `openpyxl` (faqat xlsx import uchun). npm paketlari kerak emas.

```bash
cp .env.example .env        # qiymatlarni to'ldiring
npm run setup               # migratsiya + seed/ingrident.xlsx importi (329 ingredient, qoralama)
npm start                   # http://localhost:3000
npm test                    # 57 ta avtomatik test
```

## Ma'lumotlar bazasini import qilish

```bash
npm run import -- /yo'l/ingrident.xlsx          # yoki Admin panel → Import
npm run import -- fayl.xlsx --map map.json       # ustun nomlarini qo'lda ko'rsatish
```

Kutilgan: 329 ingredient, 83 funksiya, 7 funksiya guruhi, 200 muqobil juftlik, 5 to'qnashuv. Hisobotda kutilgan va haqiqiy sonlar solishtiriladi; mos kelmasa `complete=false`. Import idempotent, xom qatorlar saqlanadi, admin tahrir qilgan yozuv ustidan yozilmaydi.
Asl `ingrident.xlsx` `seed/` papkasida; import u bilan sinab ko'rildi: 329/83/7/200/5 to'liq mos, barcha sarlavhalar moslashdi, hammasi qoralama. Fayldagi "Manba topilmadi — farmatsevt to'ldiradi" to'ldirgichi ma'lumot sifatida hisoblanmaydi.

## Super Admin

Faqat bitta Super Admin bo'ladi va u **faqat server muhit o'zgaruvchisi** orqali belgilanadi:

```bash
SUPER_ADMIN_EMAIL=<sizning email manzilingiz>   # .env yoki hosting sozlamasida; kodga yozilmaydi
npm run admin:status        # holatni tekshirish (email qiymatini ko'rsatmaydi)
npm run admin:rebind -- --confirm   # nazoratli qayta bog'lash
```

Qoidalar: email tasdiqlangan bo'lishi shart; aniq moslik (nuqta/`+` ekvivalenti yo'q); DB darajasida bitta super_admin (UNIQUE indeks + triggerlar); API orqali super_admin berib bo'lmaydi; barcha o'zgarishlar audit logda. Ishlab chiqarishda admin paroli/seed ishlatilmaydi.

## Muhit o'zgaruvchilari
`.env.example` da hammasi izohlangan. Asosiylari: `PORT`, `PUBLIC_URL`, `DATA_DIR`, `SUPER_ADMIN_EMAIL`, `OCR_PROVIDER/TESSERACT_BIN/OCR_LANGS`, `UPLOAD_RETENTION_HOURS` (24), `MAX_UPLOAD_MB`, `BARCODE_PROVIDER`, `MAIL_PROVIDER/SMTP_URL`, `FREE_/PRO_MONTHLY_ANALYSIS_LIMIT`, `FREE_HISTORY_VISIBLE`, `DEMO_MODE`, `PAYMENT_PROVIDER`, `PROFILE_ENCRYPTION_KEY`. Production'da `DEMO_MODE` va sandbox to'lov server tomonidan rad etiladi.

## Arxitektura
- Backend: Node ESM, `node:http`, SQLite (WAL), migratsiyalar `src/migrations`.
- Frontend: vanilla JS SPA (`public/`), hash router, qorong'i yashil/oltin dizayn tizimi, `prefers-reduced-motion`, klaviatura/ARIA.
- Xavfsizlik: scrypt, HttpOnly sessiya cookie, CSRF token, Origin tekshiruvi, CSP, rate limit, magic-byte yuklash tekshiruvi, teri profili AES-256-GCM bilan shifrlanadi, EXIF olib tashlanadi (sharp mavjud bo'lsa).
- Free/Pro cheklovlari **faqat serverda** (`402 pro_required`, natija shakllanishi `shapeForPlan`).

## Maxfiylik va saqlash
Saqlanmagan tahlil rasmlari 24 soatdan keyin o'chiriladi. Foydalanuvchi o'z ma'lumotlarini yuklab olishi va hisobni o'chirishi mumkin. `pages/legal.js` dagi matnlar **qoralama** — yurist ko'rib chiqishi kerak.

## HAQIQIY HOLAT (halol hisobot)

**Bajarilgan va sinalgan:** hisob/sessiya/CSRF; Super Admin qoidalari (14 test); OCR (haqiqiy tesseract bilan test); moslashtirish (aniq/noaniq/topilmagan); scoring; Free/Pro server cheklovlari; tarix limiti; oylik limit; javon (PAO ≠ yaroqlilik); kundalik; taqqoslash; hamjamiyat va moderatsiya; admin panel (rollar, ingredient/baho/tarix, import, marketing, moliya, tizim, audit); retention; sandbox webhook (imzo, replay, idempotentlik).

**Qisman:**
- Admin panel va frontend sahifalari avtomatik UI-testlardan o'tmagan; faqat sintaksis va bosh sahifa/analiz sahifasi headless brauzerda xatosiz ochilishi tekshirilgan. Qo'lda sinab ko'ring.
- i18n: asosiy matnlar `uz.js` da; admin matnlari inline.
- Eslatmalar faqat ilova ichida (email/push/Telegram yuborilmaydi).
- Barkod rasmini dekodlash faqat brauzerda (`BarcodeDetector`); qo'lda kiritish zaxira. Ma'lumot manbai — Open Beauty Facts.
- PDF — brauzer "Chop etish".

**Bloklangan / ulanmagan:**
- Hech bir ingredientda tasdiqlangan baho (assessment) yo'q, shuning uchun foizlar chiqmaydi — farmatsevt Admin panelda manba bilan baholarni tasdiqlagach paydo bo'ladi.
- **Payme / Click / Uzum adapterlari amalga oshirilmagan** (kalitlar yo'q). Faqat sandbox (aniq "SINOV" deb belgilangan, daromadga kirmaydi). Haqiqiy to'lov qabul qilinmaydi.
- Email: Brevo/Resend HTTP API yozilgan va mock bilan sinalgan; haqiqiy kalit bilan sinalmagan.
- Hech qanday AI/LLM ishlatilmagan; ilmiy baholar faqat admin kiritganidan.

**Ongli farqlar:** Next.js/Supabase/Postgres o'rniga Node + SQLite (offline muhit sababli). Node serveri Netlify bepul statik hostingiga mos emas — VPS/konteyner kerak. Shriftlar offline muhitda yuklanmagan (tizim shriftlari).
