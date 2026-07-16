# Face ID Ishchi Nazorati (Node.js backend bilan)

Ishchilarning yuzini tanib, ishga kelish/ketish vaqtlarini avtomatik hisoblaydigan tizim.
Har bir voqea darhol `davomat.xlsx` fayliga yoziladi.

## ✨ Asosiy funksiyalar
- **Avtomatik Excelga yozish** — qo'lda hech narsa saqlashning hojati yo'q.
- **Kech qolish jarimasi** — soat **08:35** dan keyin kelgan har bir ishchiga, har 1 daqiqa kechikish uchun **1000 so'm** jarima avtomatik hisoblanadi va ekranda ham, Excelda ham ko'rsatiladi.
- **Tushlik hisoboti + SMS** — soat **10:00** bo'lishi bilan tizim o'zi avtomatik ravishda o'sha vaqtgacha nechta ishchi kelganini hisoblab, ekranga va Excelga yozadi, **hamda oshpazning telefoniga SMS yuboradi** (masalan: "07/15/2026 bugun 20 kishi keldi. Shunga yarasha ovqat tayyorlang.").
- **Oylik va yillik hisobotlar** — har xodim uchun necha kun kelgani, necha marta kech qolgani, jami jarimasi va jami ishlagan soati avtomatik jamlanib boriladi (`Oylik MM-YYYY` va `Yillik YYYY` varaqlarida).
- **Ishonchli holat** — kim kelib-ketganini server o'zi yodda saqlaydi, sahifani yangilasangiz ham ma'lumot yo'qolmaydi.
- **Planshet/telefondan kirish** — bir xil Wi-Fi tarmog'ida bo'lsa, boshqa qurilmalardan ham ochish mumkin.

## 📁 Papka tuzilishi
- `index.html`, `style.css`, `script.js` - sayt (brauzerda ishlaydi)
- `server.js` - backend: holatni yodda saqlaydi, jarima/tushlik/SMS hisobini qiladi, Excelga yozadi
- `package.json` - serverga kerakli kutubxonalar
- `labels/` - har bir ishchi uchun papka, ichida uning rasmi (masalan `labels/shoxi/1.jpg`)
- `davomat.xlsx` - **avtomatik yaratiladigan natija fayli**

## ⚙️ Sozlamalarni o'zgartirish
`server.js` faylining yuqori qismida shu qatorlarni topasiz — kerak bo'lsa raqamlarni o'zgartirishingiz mumkin:
```js
const LATE_DEADLINE = { hour: 8, minute: 35 };   // shu vaqtdan keyin kelsa — kech qolgan
const FINE_PER_MINUTE = 1000;                     // har daqiqa kechikish uchun jarima (so'm)
const LUNCH_REPORT_TIME = { hour: 10, minute: 0 }; // tushlik hisoboti chiqadigan vaqt
```

## 📲 Oshpazga SMS yuborishni sozlash (Eskiz.uz)

SMS yuborish uchun **Eskiz.uz** xizmatidan foydalaniladi (O'zbekistonda eng ko'p ishlatiladigan SMS xizmati).

1. https://eskiz.uz saytida ro'yxatdan o'ting (biznes/yuridik yoki jismoniy shaxs sifatida).
2. Hisobingizga kirib, **email va parolni** eslab qoling (API shu orqali ishlaydi).
3. Balansingizga pul to'ldiring (har bir SMS pullik, taxminan bir necha yuz so'm).
4. Boshida test uchun `4546` nomli standart jo'natuvchidan foydalanish mumkin. Haqiqiy biznes uchun o'z jo'natuvchi nomingizni (masalan "MyCompany") tasdiqlatishingiz kerak bo'ladi — bu Eskiz kabinetida qilinadi.
5. Loyiha papkasida **`.env`** nomli yangi fayl yarating (yo'q bo'lsa) va shunday yozing:
   ```
   ESKIZ_EMAIL=sizning_emailingiz@mail.com
   ESKIZ_PASSWORD=sizning_parolingiz
   ESKIZ_FROM=4546
   OSHPAZ_PHONE=998901234567
   ```
   (`OSHPAZ_PHONE` — oshpazning telefon raqami, 998 bilan boshlanadi, bo'sh joy yoki `+` belgisiz)
6. Serverni qayta ishga tushiring (`npm start`).
7. Sozlamalar to'g'ri ishlayotganini darhol tekshirish uchun brauzerda shu manzilni oching:
   ```
   http://localhost:3000/api/test-sms
   ```
   Agar `{"sent":true}` chiqsa — hammasi to'g'ri, oshpazga test SMS yuboriladi. Agar xato chiqsa, terminaldagi qizil yozuvni o'qing (odatda email/parol xato yoki balans yo'qligi haqida bo'ladi).

⚠️ **Railway'da ishlatsangiz:** `.env` fayl o'rniga, Railway loyihasida **"Variables"** bo'limiga xuddi shu 4 ta o'zgaruvchini (`ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_FROM`, `OSHPAZ_PHONE`) qo'shing.


## 🚛 Yuk Manifest (haftalik yetkazib berish)
Uchinchi sahifa ham qo'shildi: `yuk.html` — mijozlarga yuk (mebel) yetkazib berishni rejalashtiruvchi haftalik jadval.
- Manzil: `http://localhost:3000/yuk.html`
- Xavfsizlik kodlari `server.js` faylining yuqorisida:
  ```js
  const YUK_ADD_CODE = '1111';      // yangi yuk qo'shish uchun kod
  const YUK_DELETE_CODE = '9999';   // yukni o'chirish uchun kod
  const YUK_PAYMENT_CODE = '2222';  // "pul olindi" deb belgilash uchun kod
  ```
  **Saytdan foydalanishdan oldin bu 3 ta kodni albatta o'zingizga xos qiling!**
- Har bir yukni **tahrirlash** uchun umumiy kod yo'q — buni xodim yuk qo'shayotganda o'zi PIN sifatida o'ylab topadi.
- "➕ Yangi rang qo'shish" tugmasi (ilgari mavjud edi) endi **olib tashlangan** — endi faqat mavjud ranglardan tanlanadi.
- Ma'lumotlar avtomatik **`yuk-manifest.xlsx`** fayliga yoziladi (yuklab olish: `/api/export/excel`).

## 🏭 Mebel Tizimi bilan birlashtirilgan
Endi shu loyiha ichida **ikkinchi sahifa** ham bor: `mebel.html` — Temurshox Mebel ishlab chiqarish jurnali.
- Manzil: `http://localhost:3000/mebel.html` (yoki Railway domeningiz + `/mebel.html`)
- Google Sheets endi kerak emas — barcha ma'lumot `mebel-data.json` (ichki xotira) va **`ishlab_chiqarish.xlsx`** fayliga avtomatik yoziladi.
- Xodim Face ID orqali "keldi" deb belgilangach, agar uning bo'limi `script.js` dagi `EMPLOYEE_DEPARTMENT` ro'yxatida ko'rsatilgan bo'lsa, ekranda **"🏭 Ishlab chiqarish jurnaliga o'tish"** tugmasi chiqadi — bosilsa, to'g'ridan-to'g'ri o'sha xodimning bo'limiga, ismi avtomatik to'ldirilgan holda o'tkazadi.
- Yangi xodim qo'shsangiz yoki bo'limini to'g'irlash kerak bo'lsa, `script.js` faylidagi `EMPLOYEE_DEPARTMENT` obyektini tahrirlang.
- Ishlab chiqarish Excel faylini yuklab olish: `http://localhost:3000/download-mebel-excel`

## 🚀 Birinchi marta ishga tushirish

### 1-qadam: Node.js o'rnatish
https://nodejs.org saytidan yuklab, o'rnating.

### 2-qadam: Ishchilar rasmlarini joylashtirish
`labels/` papkasi ichida har bir ishchi uchun alohida papka oching, ichiga uning yuzi aniq ko'ringan rasmni `1.jpg` nomi bilan joylang:
```
labels/
  └── shoxi/
        └── 1.jpg
```
Keyin `script.js` faylini ochib, `LABELS` massiviga shu papka nomlarini yozing:
```js
const LABELS = ['shoxi'];
```

### 3-qadam: Kerakli kutubxonalarni o'rnatish
VS Code terminalida:
```
npm install
```
(faqat 1 marta kerak)

### 4-qadam: Serverni ishga tushirish
```
npm start
```
Terminalda shunga o'xshash yozuv chiqadi:
```
✅ Server ishga tushdi!
🌐 Shu kompyuterda oching:      http://localhost:3000
📱 Planshet/telefonda oching: http://192.168.1.15:3000
```

### 5-qadam: Saytni ochish
Ko'rsatilgan manzilni brauzerda (Chrome tavsiya etiladi) oching.
**MUHIM:** Faylni ikki marta bosib yoki Live Server orqali OCHMANG — faqat server bergan manzil orqali oching (aks holda Excelga yozish va jarima/tushlik hisoblari ishlamaydi).

## 📱 Planshet yoki telefondan kirish
1. Kompyuter va planshet/telefon **bir xil Wi-Fi tarmog'ida** bo'lishi shart.
2. Terminaldagi `📱 Planshet/telefonda oching:` qatoridagi manzilni brauzerda oching.
3. Kompyuterda server (`npm start`) doim ishlab turishi kerak.

## 🔁 Keyingi safarlar
```
npm start
```
— shu, boshqa hech narsa qilishning hojati yo'q (`npm install` faqat birinchi marta kerak edi).

## 📊 Excel fayli haqida
- `davomat.xlsx` loyiha papkasida avtomatik paydo bo'ladi.
- Har kun uchun alohida varaq (sheet) — masalan `08-07-2026`, `09-07-2026`.
- Ustunlar: Ishchi ismi, Amal (Keldi/Ketdi), Vaqt, Kech qolish (daqiqa), Jarima (so'm), Ishlagan vaqt.
- Soat 10:00'da avtomatik qo'shiladigan qalin yozuvli qator: "📊 TUSHLIK HISOBOTI: soat 10:00 gacha X kishi keldi".
- **Diqqat:** faylni Excel dasturida ochib turgan bo'lsangiz, server unga yoza olmaydi — bunday paytda faylni yopib turing.

*Eslatmalar:*
- *Kamera ishlashi uchun brauzer so'raganda "Kameraga ruxsat berish" tugmasini bosing.*
- *Bir kishi kamera oldida bir necha soniya tursa ham xato bilan "ketdi" deb yozilmaydi — tizim kamida 5 daqiqa farq bo'lishini kutadi (bu vaqtni server.js dagi `MIN_GAP_MINUTES` orqali o'zgartirish mumkin).*
- *Server ishlab turgan vaqtda terminal oynasini yopmang — yopilsa, server ham to'xtaydi.*
