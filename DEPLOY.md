# SAYDAN — internetga chiqarish (qadamma-qadam)

Taxminiy vaqt: 40–60 daqiqa. Pul to'lanadigan joylar: hosting (~$7/oy, Render Starter — doimiy disk uchun shart; bepul rejada baza har qayta ishga tushganda o'chib ketadi). Brevo bepul.

## 1. GitHub (5 daqiqa)
1. github.com → New repository → nomi `saydan`, **Private**.
2. `saydan.zip` ni oching, ichidagi fayllarni repoga yuklang ("uploading an existing file"). `.env` faylini YUKLAMANG.

## 2. Email — Brevo (10 daqiqa)
1. brevo.com da hisob oching.
2. Senders & IP → Senders → o'z emailingizni qo'shing va xatdagi havola bilan tasdiqlang. (Bepul reja: kuniga ~300 xat.)
3. SMTP & API → API Keys → yangi kalit yarating va nusxalab oling.

## 3. Render (15 daqiqa)
1. render.com → GitHub bilan kiring → New → **Blueprint** → `saydan` repongizni tanlang (u `render.yaml` ni o'zi o'qiydi).
2. So'ralgan qiymatlar:
   - `PUBLIC_URL` = `https://saydan.onrender.com` (nom band bo'lsa Render boshqa beradi; keyin Environment'dan to'g'rilang)
   - `SUPER_ADMIN_EMAIL` = o'zingizning email manzilingiz
   - `MAIL_FROM` = Brevo'da tasdiqlagan email
   - `BREVO_API_KEY` = 2-qadamdagi kalit
3. Deploy tugagach `https://<nom>.onrender.com` ochiladi. Birinchi ishga tushishda 329 ingredient avtomatik import qilinadi (qoralama).
4. Saytda **Super Admin emailingiz bilan** ro'yxatdan o'ting → pochtangizga kelgan havola bilan tasdiqlang → kiring → "Boshqaruv" paydo bo'ladi.

## 4. O'z domeningiz (ixtiyoriy)
Render → Settings → Custom Domains → domeningizni qo'shing, Render ko'rsatgan DNS yozuvini domen sotuvchisida kiriting. Keyin `PUBLIC_URL` ni yangi manzilga o'zgartiring.

## 5. Ishga tushgandan keyin tekshirish
- Admin → Tizim: Email "configured", OCR "ready", baza OK bo'lishi kerak.
- Boshqa email bilan ro'yxatdan o'tib ko'ring (xat kelishi kerak).
- Yorliq rasmini yuklab OCR ni sinang.
- Admin → Ingredientlar: farmatsevt baholarni manba URL bilan tasdiqlaydi (shundan keyin foizlar chiqadi).

## To'lov
Payme/Click/Uzum hali ulanmagan. Shu holatda "Pro" sotib olish tugmasi "To'lov tizimi hali ulanmagan" deb javob beradi (haqiqiy pul olinmaydi). Merchant kalitlari tayyor bo'lgach adapter yoziladi.

## Muhim eslatmalar
- `DEMO_MODE` va `PAYMENT_PROVIDER=sandbox` productionda server tomonidan rad etiladi.
- Docker bu muhitda sinalmagan: `Dockerfile` standart, lekin birinchi deploy loglarini Render'da kuzating. Xato chiqsa log matnini yuboring.
