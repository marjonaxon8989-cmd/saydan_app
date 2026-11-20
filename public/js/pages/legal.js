import { html } from '../core.js';

export default async function legal({ path }) {
  const draft = html`<div class="notice warn"><span>⚠</span><span><b>Qoralama matn.</b> Bu hujjat loyiha texnik amalga oshirilishini aks ettiradi va ishga tushirishdan oldin yurist tomonidan ko'rib chiqilishi, kompaniya rekvizitlari bilan to'ldirilishi kerak.</span></div>`;
  if (path === '/terms') return { html: html`<div class="wrap section" style="max-width:800px"><h1>Foydalanish shartlari</h1>${draft}
    <h3 style="margin-top:1.5rem">1. Xizmat maqsadi</h3><p>SAYDAN kosmetika mahsulotlari tarkibidagi ingredientlar haqida ma'lumot beradi. Xizmat tibbiy tashxis qo'ymaydi, davolashni tavsiya etmaydi va mahsulotning umumiy sifati yoki mutlaq xavfsizligi haqida kafolat bermaydi.</p>
    <h3>2. Ma'lumot holati</h3><p>Ingredient yozuvlari qoralama holatida bo'lishi mumkin va farmatsevt tekshiruvidan o'tmagan bo'lishi mumkin. Har bir yozuvning holati va manbasi ko'rsatiladi. Foiz ko'rsatkichlari tibbiy o'lchov emas.</p>
    <h3>3. Foydalanuvchi mas'uliyati</h3><p>Yakuniy qaror uchun vrach yoki farmatsevt bilan maslahatlashing. Homiladorlik va sog'liq bilan bog'liq savollarda albatta mutaxassisga murojaat qiling.</p>
    <h3>4. Hamjamiyat</h3><p>Sharhlar haqiqiy tajribaga asoslanishi kerak. Spam, haqorat va yolg'on ma'lumot taqiqlanadi; moderatorlar kontentni yashirishi va hisobni cheklashi mumkin.</p>
    <h3>5. Obuna</h3><p>Pro obunaning narxi, muddati va yangilanish shartlari to'lov oldidan aniq ko'rsatiladi. Avtomatik yangilanishni hisob sahifasida bekor qilish mumkin.</p></div>` };
  return { html: html`<div class="wrap section" style="max-width:800px"><h1>Maxfiylik siyosati</h1>${draft}
    <h3 style="margin-top:1.5rem">Qanday ma'lumot yig'iladi</h3><ul><li>Email, nik va parol (parol faqat bir tomonlama kriptografik xesh sifatida saqlanadi).</li><li>Siz yuklagan yorliq rasmlari va OCR matni.</li><li>Siz saqlashni tanlagan tahlillar, javon, kundalik va sharhlar.</li><li>Pro foydalanuvchi ixtiyoriy kiritgan teri profili — shifrlangan holda saqlanadi.</li><li>Marketing uchun shaxsiy ma'lumotsiz hodisalar (UTM manba, sahifa ko'rishlar).</li></ul>
    <h3>Rasmlarni saqlash muddati</h3><p>Tahlilni saqlamasangiz, yuklangan rasm sozlangan muddatdan keyin (standart: 24 soat) avtomatik o'chiriladi. Tahlilni saqlasangiz ham rasm faqat alohida tanlovingiz bilan saqlanadi. Rasmlar metama'lumotlardan (EXIF, jumladan joylashuv) tozalanadi.</p>
    <h3>Sizning huquqlaringiz</h3><p>Hisob sahifasidan barcha ma'lumotlaringizni yuklab olishingiz va hisobni to'liq o'chirishingiz mumkin. Teri profilini alohida o'chirish mumkin.</p>
    <h3>Uchinchi tomonlar</h3><p>Barkod qidiruvida barkod raqami tashqi ochiq ma'lumot manbasiga (Open Beauty Facts) yuboriladi; shaxsiy ma'lumot yuborilmaydi.</p></div>` };
}
