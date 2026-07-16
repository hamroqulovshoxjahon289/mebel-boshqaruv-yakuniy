// ==========================================================
//  Yuz orqali davomat tizimi — Backend server
//  Vazifalari:
//   1. Saytni ko'rsatadi
//   2. Kim keldi/ketdi - shuni serverning o'zi hal qiladi
//      (brauzer yangilansa ham ma'lumot yo'qolmaydi)
//   3. 08:35 dan keyin kelganlarga jarima hisoblaydi
//      (har daqiqaga 1000 so'm)
//   4. Soat 10:00 bo'lishi bilan o'zi avtomatik ravishda
//      "necha kishi keldi" hisobotini chiqaradi (oshpaz uchun)
//   5. Hamma narsani "davomat.xlsx" fayliga yozib boradi
// ==========================================================

require('dotenv').config();

const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const app = express();

// Railway (va boshqa hosting'lar) o'zi PORT raqamini beradi — buni albatta shunday yozish kerak
const PORT = process.env.PORT || 3000;

// Railway'da "davomat.xlsx" faylini alohida doimiy diskka (Volume) yozish uchun.
// Railway'da bu papkani DATA_DIR degan o'zgaruvchi orqali ko'rsatasiz (masalan "/data").
// Agar shunday o'zgaruvchi berilmasa (masalan o'zingizning kompyuteringizda ishga tushirsangiz),
// oddiy loyiha papkasiga yoziladi.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const EXCEL_PATH = path.join(DATA_DIR, 'davomat.xlsx');

// ---------- SOZLAMALAR (kerak bo'lsa shu yerdan o'zgartiring) ----------
const LATE_DEADLINE = { hour: 8, minute: 35 };   // shu vaqtdan keyin kelsa — kech qolgan
const FINE_PER_MINUTE = 1000;                     // har 1 daqiqa kechikish uchun jarima (so'm)
const LUNCH_REPORT_TIME = { hour: 10, minute: 0 }; // shu vaqtda "necha kishi keldi" hisoboti chiqadi
const MIN_GAP_MINUTES = 5;                        // shu vaqt ichida bir odamni qayta-qayta hisoblamaslik uchun

// Kech qolgan bo'lsa-yu, lekin kechqurun kech vaqtgacha ishlab, "o'rnini to'ldirsa" —
// jarimasi shu tarzda kamayadi:
const WORK_END_TIME = { hour: 18, minute: 30 };   // rasmiy ish tugash vaqti
const FINE_REDUCTION_PER_2MIN = 1000;             // shu vaqtdan keyin har 2 daqiqa ishlasa, jarimadan 1000 so'm ayiriladi

// ---------- YUK MANIFEST (haftalik yetkazib berish) sozlamalari ----------
// MUHIM: saytdan foydalanishdan oldin bu kodlarni albatta o'zingizga xos qiling!
const YUK_ADD_CODE = '1111';      // yangi yuk QO'SHISH uchun so'raladigan kod
const YUK_DELETE_CODE = '9999';   // yukni O'CHIRISH uchun so'raladigan kod
const YUK_PAYMENT_CODE = '2222';  // "Pul olindi" deb belgilash uchun so'raladigan kod
const YUK_MAX_PER_DAY = 30;       // bir kunga maksimal yuk soni

// ---------- SMS sozlamalari (Eskiz.uz orqali oshpazga SMS yuborish uchun) ----------
// Bularni qo'lda shu yerga yozmang! "Environment Variables" (o'zgaruvchilar) orqali beriladi
// (pastda README'da qanday qilib sozlash yozilgan).
const ESKIZ_EMAIL = process.env.ESKIZ_EMAIL || '';
const ESKIZ_PASSWORD = process.env.ESKIZ_PASSWORD || '';
const ESKIZ_FROM = process.env.ESKIZ_FROM || '4546'; // standart test jo'natuvchi nomi
const OSHPAZ_PHONE = process.env.OSHPAZ_PHONE || ''; // masalan: 998901234567
// ------------------------------------------------------------------------

app.use(express.json());
app.use(express.static(__dirname));

// Agar DATA_DIR papkasi hali mavjud bo'lmasa (masalan birinchi marta ishga tushganda), yaratib qo'yamiz
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}


// ---------- Kunlik holatni xotirada saqlash ----------
let todayState = {
    dateKey: null,           // "2026-07-08" kabi
    arrivals: {},            // { "shoxi": { checkIn, checkOut, lateMinutes, fine, workHours } }
    lunchReportDone: false,
    lunchCount: null
};

// Mahalliy (local) sanani "YYYY-MM-DD" shaklida qaytaradi — toISOString() ISHLATMAYDI,
// chunki u UTC vaqtga o'tkazib, O'zbekiston (UTC+5) uchun kunni noto'g'ri hisoblardi.
function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function todayKey(d = new Date()) {
    return localDateStr(d);
}

// Agar kun almashgan bo'lsa, xotirani tozalab, yangi kun boshlaymiz
function ensureToday() {
    const key = todayKey();
    if (todayState.dateKey !== key) {
        todayState = { dateKey: key, arrivals: {}, lunchReportDone: false, lunchCount: null };
    }
}

function sheetNameFor(d = new Date()) {
    // Lokal (uz-UZ) sana formati ba'zi kompyuterlarda "/" bilan chiqishi mumkin,
    // Excel esa varaq nomida "/" kabi belgilarni taqiqlaydi — shuning uchun sanani
    // kompyuter tiliga bog'liq bo'lmagan, doim xavfsiz "DD-MM-YYYY" shaklida o'zimiz yasaymiz.
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function timeStringFor(d) {
    return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------- Excel bilan ishlash ----------
async function openWorkbook() {
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(EXCEL_PATH)) {
        await workbook.xlsx.readFile(EXCEL_PATH);
    }
    return workbook;
}

function getOrCreateSheet(workbook, name) {
    let sheet = workbook.getWorksheet(name);
    if (!sheet) {
        sheet = workbook.addWorksheet(name);
        sheet.columns = [
            { header: 'Ishchi ismi', key: 'name', width: 26 },
            { header: 'Amal', key: 'action', width: 12 },
            { header: 'Vaqt', key: 'time', width: 14 },
            { header: 'Kech qolish (daqiqa)', key: 'lateMin', width: 18 },
            { header: "Jarima (so'm)", key: 'fine', width: 14 },
            { header: 'Ishlagan vaqt', key: 'hours', width: 16 },
            { header: "Kechqurun kamaytirilgan jarima (so'm)", key: 'fineReduction', width: 30 },
            { header: "Yakuniy jarima (so'm)", key: 'finalFine', width: 18 },
        ];
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    }
    return sheet;
}

async function appendRow(rowData, eventDate = new Date()) {
    const workbook = await openWorkbook();
    const sheet = getOrCreateSheet(workbook, sheetNameFor(eventDate));
    const row = sheet.addRow(rowData);
    if (rowData.action === 'TUSHLIK HISOBOTI') {
        row.font = { bold: true, color: { argb: 'FF9A3412' } };
    }

    // Har voqeadan keyin oylik va yillik yig'ma hisobotlarni ham yangilab qo'yamiz
    if (rowData.action === 'Keldi' || rowData.action === 'Ketdi') {
        updateSummarySheet(workbook, monthlySheetName(eventDate), (name) => isSameMonth(name, eventDate));
        updateSummarySheet(workbook, yearlySheetName(eventDate), (name) => isSameYear(name, eventDate));
    }

    await workbook.xlsx.writeFile(EXCEL_PATH);
}

// ---------- Oylik / Yillik yig'ma hisobotlar ----------

// Kunlik varaq nomi "DD-MM-YYYY" formatida (masalan "08-07-2026")
function parseSheetDate(name) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(name);
    if (!m) return null;
    return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
}

function isSameMonth(sheetName, eventDate) {
    const d = parseSheetDate(sheetName);
    if (!d) return false;
    return d.month === (eventDate.getMonth() + 1) && d.year === eventDate.getFullYear();
}

function isSameYear(sheetName, eventDate) {
    const d = parseSheetDate(sheetName);
    if (!d) return false;
    return d.year === eventDate.getFullYear();
}

function monthlySheetName(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `Oylik ${mm}-${d.getFullYear()}`;
}

function yearlySheetName(d) {
    return `Yillik ${d.getFullYear()}`;
}

// Barcha mos keladigan kunlik varaqlarni yig'ib, har xodim bo'yicha jamlaydi,
// so'ngra natijani (masalan "Oylik 07-2026") alohida varaqqa yozadi
function updateSummarySheet(workbook, summaryName, matchesFn) {
    const totals = {}; // { ismi: { daysPresent, lateDays, lateMinutes, fine, hours } }

    workbook.eachSheet((sheet) => {
        if (!matchesFn(sheet.name)) return;

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const [, name, action, , lateMin, fine, hours, fineReduction] = row.values;
            if (!name || !action) return;
            if (action !== 'Keldi' && action !== 'Ketdi') return; // TUSHLIK HISOBOTI qatorini o'tkazib yuboramiz

            if (!totals[name]) {
                totals[name] = { daysPresent: 0, lateDays: 0, lateMinutes: 0, fine: 0, hours: 0 };
            }

            if (action === 'Keldi') {
                totals[name].daysPresent += 1;
                const lm = Number(lateMin) || 0;
                const f = Number(fine) || 0;
                if (lm > 0) totals[name].lateDays += 1;
                totals[name].lateMinutes += lm;
                totals[name].fine += f;
            } else if (action === 'Ketdi') {
                const hrs = parseFloat(String(hours || '').replace(' soat', '')) || 0;
                totals[name].hours += hrs;
                // Kechqurun ishlagani uchun kamaytirilgan jarimani ayirib tashlaymiz
                const reduction = Number(fineReduction) || 0;
                if (reduction > 0) {
                    totals[name].fine = Math.max(0, totals[name].fine - reduction);
                }
            }
        });
    });

    // Eski hisobot varag'i bo'lsa, o'chirib, yangisini yozamiz (har doim yangilangan holatda tursin)
    const existing = workbook.getWorksheet(summaryName);
    if (existing) workbook.removeWorksheet(existing.id);

    const summarySheet = workbook.addWorksheet(summaryName);
    summarySheet.columns = [
        { header: 'Ishchi ismi', key: 'name', width: 26 },
        { header: 'Kelgan kunlar', key: 'daysPresent', width: 16 },
        { header: 'Kech qolgan kunlar', key: 'lateDays', width: 18 },
        { header: 'Jami kech qolish (daqiqa)', key: 'lateMinutes', width: 22 },
        { header: "Jami jarima (so'm)", key: 'fine', width: 18 },
        { header: 'Jami ishlagan soat', key: 'hours', width: 18 },
    ];
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    Object.keys(totals).sort().forEach(name => {
        const t = totals[name];
        summarySheet.addRow({
            name,
            daysPresent: t.daysPresent,
            lateDays: t.lateDays,
            lateMinutes: t.lateMinutes,
            fine: t.fine,
            hours: t.hours.toFixed(2)
        });
    });
}

// Server qayta ishga tushganda, bugungi varaq mavjud bo'lsa,
// undan xotirani tiklaymiz (shunda kech qolish/hisob-kitob yo'qolib qolmaydi)
async function restoreTodayStateFromExcel() {
    ensureToday();
    if (!fs.existsSync(EXCEL_PATH)) return;
    try {
        const workbook = await openWorkbook();
        const sheet = workbook.getWorksheet(sheetNameFor());
        if (!sheet) return;

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // sarlavha qatorini o'tkazib yuboramiz
            const [, name, action, time, lateMin, fine, hours, , finalFine] = row.values;
            if (!name || !action) return;

            if (action === 'Keldi') {
                const checkIn = combineTodayWithTimeString(time);
                todayState.arrivals[name] = {
                    checkIn,
                    checkOut: null,
                    lateMinutes: Number(lateMin) || 0,
                    fine: Number(fine) || 0,
                    workHours: '-'
                };
            } else if (action === 'Ketdi' && todayState.arrivals[name]) {
                todayState.arrivals[name].checkOut = combineTodayWithTimeString(time);
                if (hours) todayState.arrivals[name].workHours = hours;
                // Agar kechqurun ishlagani uchun jarima kamaytirilgan bo'lsa, yakuniy qiymatni tiklaymiz
                if (finalFine !== undefined && finalFine !== null && finalFine !== '') {
                    todayState.arrivals[name].fine = Number(finalFine) || 0;
                }
            } else if (action === 'TUSHLIK HISOBOTI') {
                todayState.lunchReportDone = true;
            }
        });
        console.log(`🔄 Bugungi holat Excel'dan tiklandi (${Object.keys(todayState.arrivals).length} kishi).`);
    } catch (e) {
        console.warn("Bugungi holatni tiklab bo'lmadi:", e.message);
    }
}

function combineTodayWithTimeString(timeStr) {
    const now = new Date();
    const [h, m, s] = String(timeStr).split(':').map(Number);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, s || 0);
    return d;
}

// ---------- SMS yuborish (Eskiz.uz) ----------
let eskizToken = null;
let eskizTokenExpiry = 0;

async function getEskizToken() {
    if (eskizToken && Date.now() < eskizTokenExpiry) {
        return eskizToken; // eski token hali yaroqli
    }
    const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ESKIZ_EMAIL, password: ESKIZ_PASSWORD })
    });
    const data = await res.json();
    if (!res.ok || !data.data || !data.data.token) {
        throw new Error('Eskiz tokenini olib bo\'lmadi: ' + JSON.stringify(data));
    }
    eskizToken = data.data.token;
    eskizTokenExpiry = Date.now() + 25 * 24 * 60 * 60 * 1000; // token ~1 oy yaroqli, ehtiyot uchun 25 kun deb olamiz
    return eskizToken;
}

async function sendSms(phone, message) {
    if (!ESKIZ_EMAIL || !ESKIZ_PASSWORD || !phone) {
        console.warn('⚠️ SMS yuborilmadi: ESKIZ_EMAIL / ESKIZ_PASSWORD / OSHPAZ_PHONE sozlanmagan.');
        return { sent: false, reason: 'not_configured' };
    }
    try {
        const token = await getEskizToken();
        const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                mobile_phone: phone.replace(/\D/g, ''), // faqat raqamlar qoldiriladi
                message,
                from: ESKIZ_FROM
            })
        });
        const data = await res.json();
        if (!res.ok) {
            console.error('❌ SMS yuborishda xatolik:', data);
            return { sent: false, reason: data };
        }
        console.log(`📲 SMS yuborildi (${phone}): ${message}`);
        return { sent: true };
    } catch (e) {
        console.error('❌ SMS yuborishda xatolik:', e.message);
        return { sent: false, reason: e.message };
    }
}


function computeLateInfo(checkInDate) {
    const deadline = new Date(checkInDate);
    deadline.setHours(LATE_DEADLINE.hour, LATE_DEADLINE.minute, 0, 0);

    if (checkInDate <= deadline) {
        return { lateMinutes: 0, fine: 0 };
    }
    const lateMinutes = Math.ceil((checkInDate - deadline) / 60000);
    const fine = lateMinutes * FINE_PER_MINUTE;
    return { lateMinutes, fine };
}

// ---------- API: kelish/ketish qabul qilish ----------
app.post('/api/attendance', async (req, res) => {
    try {
        ensureToday();
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Ism yuborilmadi" });
        }

        const now = new Date();
        const entry = todayState.arrivals[name];

        // Hali kelmagan bo'lsa — bu KELISH
        if (!entry) {
            const { lateMinutes, fine } = computeLateInfo(now);
            todayState.arrivals[name] = {
                checkIn: now,
                checkOut: null,
                lateMinutes,
                fine,
                workHours: '-'
            };

            await appendRow({
                name,
                action: 'Keldi',
                time: timeStringFor(now),
                lateMin: lateMinutes || '',
                fine: fine || '',
                hours: ''
            });

            return res.json({ status: 'keldi', time: timeStringFor(now), lateMinutes, fine });
        }

        // Kelgan, lekin hali ketmagan — juda tez orada bo'lsa e'tiborsiz qoldiramiz
        // (bir odam kamera oldida bir necha soniya tursa, avtomatik "ketdi" bo'lib qolmasligi uchun)
        const minGapMs = MIN_GAP_MINUTES * 60000;

        if (!entry.checkOut) {
            if ((now - entry.checkIn) < minGapMs) {
                return res.json({ status: 'ignored' });
            }

            entry.checkOut = now;
            const diffHrs = ((entry.checkOut - entry.checkIn) / 3600000).toFixed(2);
            entry.workHours = `${diffHrs} soat`;

            // Agar ertalab kech qolib jarima yozilgan bo'lsa-yu, lekin kechqurun
            // ish tugash vaqtidan (18:30) keyin ham ishlab, "o'rnini to'ldirgan" bo'lsa —
            // shu qadar jarima kamaytiriladi (har 2 daqiqaga 1000 so'm)
            let fineReduction = 0;
            if (entry.fine > 0) {
                const workEnd = new Date(now);
                workEnd.setHours(WORK_END_TIME.hour, WORK_END_TIME.minute, 0, 0);
                if (now > workEnd) {
                    const overtimeMinutes = Math.floor((now - workEnd) / 60000);
                    fineReduction = Math.floor(overtimeMinutes / 2) * FINE_REDUCTION_PER_2MIN;
                    fineReduction = Math.min(fineReduction, entry.fine); // jarimadan ortiqcha ayirib yubormaslik uchun
                    entry.fine -= fineReduction;
                }
            }

            await appendRow({
                name,
                action: 'Ketdi',
                time: timeStringFor(now),
                lateMin: '',
                fine: '',
                hours: entry.workHours,
                fineReduction: fineReduction || '',
                finalFine: fineReduction > 0 ? entry.fine : ''
            });

            return res.json({
                status: 'ketdi',
                time: timeStringFor(now),
                workHours: entry.workHours,
                fineReduction,
                remainingFine: entry.fine
            });
        }

        // Kelib, ketib bo'lgan — kun uchun tugagan
        if ((now - entry.checkOut) < minGapMs) {
            return res.json({ status: 'ignored' });
        }
        return res.json({ status: 'done' });
    } catch (err) {
        console.error('❌ /api/attendance xatolik:', err.message);
        res.status(500).json({ error: "Serverda xatolik. Excel fayli ochiq turgan bo'lishi mumkin — uni yopib ko'ring." });
    }
});

// ---------- API: bugungi holatni to'liq qaytarish (jadvalni to'ldirish uchun) ----------
app.get('/api/attendance/today', (req, res) => {
    ensureToday();
    const arrivals = {};
    for (const [name, e] of Object.entries(todayState.arrivals)) {
        arrivals[name] = {
            checkIn: e.checkIn ? timeStringFor(e.checkIn).slice(0, 5) : null,
            checkOut: e.checkOut ? timeStringFor(e.checkOut).slice(0, 5) : null,
            lateMinutes: e.lateMinutes,
            fine: e.fine,
            workHours: e.workHours
        };
    }
    res.json({
        arrivals,
        lunchReport: { done: todayState.lunchReportDone, count: todayState.lunchCount }
    });
});

// ---------- API: SMS sozlamalarini sinab ko'rish uchun ----------
// ---------- API: davomat.xlsx faylini yuklab olish ----------
// Brauzerda shu manzilni oching: http://localhost:3000/download-excel
// (yoki Railway'dagi manzilingiz + /download-excel)
// Fayl qayerda saqlanayotganidan (kompyuterda yoki Railway'da) qat'iy nazar shu orqali ochiladi/yuklanadi.
app.get('/download-excel', (req, res) => {
    if (!fs.existsSync(EXCEL_PATH)) {
        return res.status(404).send("Hali hech kim ro'yxatdan o'tmagan, fayl hali yaratilmagan.");
    }
    res.download(EXCEL_PATH, 'davomat.xlsx');
});

// Brauzerda shu manzilni oching: http://localhost:3000/api/test-sms
app.get('/api/test-sms', async (req, res) => {
    const result = await sendSms(OSHPAZ_PHONE, "Test xabar: Face ID tizimi SMS'ni to'g'ri sozlangan!");
    res.json(result);
});

// ---------- Soat 10:00'dagi tushlik hisobotini avtomatik chiqarish ----------
async function checkLunchReport() {
    ensureToday();
    if (todayState.lunchReportDone) return;

    const now = new Date();
    const target = new Date(now);
    target.setHours(LUNCH_REPORT_TIME.hour, LUNCH_REPORT_TIME.minute, 0, 0);

    if (now < target) return; // hali vaqti kelmadi

    const count = Object.keys(todayState.arrivals).length;
    todayState.lunchReportDone = true;
    todayState.lunchCount = count;

    try {
        await appendRow({
            name: `📊 TUSHLIK HISOBOTI: soat 10:00 gacha ${count} kishi keldi`,
            action: 'TUSHLIK HISOBOTI',
            time: '10:00',
            lateMin: '',
            fine: '',
            hours: ''
        });
        console.log(`🍲 Tushlik hisoboti tayyor: ${count} kishi keldi.`);
    } catch (e) {
        console.error('Tushlik hisobotini Excelga yozishda xatolik:', e.message);
    }

    // Oshpazga SMS yuborish
    const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    const smsText = `${dateStr} bugun ${count} kishi keldi. Shunga yarasha (${count} kishiga) ovqat tayyorlang.`;
    await sendSms(OSHPAZ_PHONE, smsText);
}

// Har 20 soniyada bir marta vaqtni tekshirib turadi
setInterval(checkLunchReport, 20 * 1000);

// ---------- Kompyuterning lokal tarmoq (Wi-Fi) manzilini topish ----------
function getLocalIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips;
}

// ---------- Serverni ishga tushirish ----------
// ==========================================================
//  MEBEL TIZIMI (Ishlab chiqarish jurnali) — backend
//  Google Sheets o'rniga oddiy JSON fayl (ma'lumotlar bazasi
//  vazifasini o'taydi) + har bir yozuv avtomatik Excelga ham
//  ko'chiriladi (ishlab_chiqarish.xlsx)
// ==========================================================

const MEBEL_DATA_PATH = path.join(DATA_DIR, 'mebel-data.json');
const MEBEL_XLSX_PATH = path.join(DATA_DIR, 'ishlab_chiqarish.xlsx');

// mebel.html dagi OPERATIONAL_SECTIONS / MATERIAL_SECTIONS bilan bir xil —
// bo'lim kaliti o'zgarsa, shu yerni ham yangilang
const MEBEL_LOG_TITLES = {
    sklad_zapchast: "Sklad - Zapchast",
    sklad_koja: "Sklad - Koja",
    sklad_divan_saberat: "Sklad - Divan saberat",
    sklad_padval: "Sklad - Padval",
    sklad_bolo_divancho: "Sklad - Bolo divancho",
    korpus_ara: "Korpus - Ara",
    korpus_kromka: "Korpus - Kromka",
    korpus_toshuk: "Korpus - To'shuk",
    korpus_upakovka: "Korpus - Upakovka",
    fasad_rover: "Fasad - Rover",
    fasad_utalshoni: "Fasad - Utalshoni",
    fasad_najdak: "Fasad - Najdak",
    fasad_gruntofka: "Fasad - Gruntofka",
    fasad_kraska: "Fasad - Kraska",
};
const MEBEL_MATERIAL_TITLES = {
    korpus_yuklar: "Ombor - Yuklar (Laminat)",
    fasad_mdf_baza: "Ombor - MDF Baza",
};

function loadMebelStore() {
    if (!fs.existsSync(MEBEL_DATA_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(MEBEL_DATA_PATH, 'utf8'));
    } catch (e) {
        console.error("Mebel ma'lumotlarini o'qishda xatolik:", e.message);
        return {};
    }
}

function saveMebelStore(store) {
    fs.writeFileSync(MEBEL_DATA_PATH, JSON.stringify(store, null, 2));
}

// Bitta kalitni (masalan "log_korpus_kromka") Excel varag'iga to'liq qayta yozadi
async function mirrorMebelKeyToExcel(key, value) {
    let sheetName = null;
    let columns = null;
    let rows = [];

    if (key.startsWith('log_')) {
        const title = MEBEL_LOG_TITLES[key.slice(4)];
        if (!title) return;
        sheetName = title.slice(0, 31);
        columns = [
            { header: 'Sana', key: 'date', width: 14 },
            { header: 'Vaqt', key: 'time', width: 10 },
            { header: 'Ismi', key: 'ismi', width: 20 },
            { header: 'Nima qildi', key: 'tavsif', width: 40 },
            { header: 'Soni', key: 'soni', width: 10 },
            { header: 'Birligi', key: 'birlik', width: 10 },
        ];
        rows = (value || []).map(item => ({
            date: item.date, time: item.time, ismi: item.ismi,
            tavsif: item.tavsif, soni: item.soni, birlik: item.birlik
        }));
    } else if (key.startsWith('material_')) {
        const title = MEBEL_MATERIAL_TITLES[key.slice(9)];
        if (!title) return;
        sheetName = title.slice(0, 31);
        columns = [
            { header: 'Sana', key: 'sana', width: 18 },
            { header: 'Rangi', key: 'rang', width: 16 },
            { header: "O'lchami", key: 'olcham', width: 14 },
            { header: 'Kim kiritdi', key: 'ismi', width: 18 },
            { header: 'Soni', key: 'soni', width: 10 },
        ];
        rows = (value || []).map(item => ({
            sana: item.sana, rang: item.rang, olcham: item.olcham,
            ismi: item.ismi, soni: item.soni
        }));
    } else if (key === 'taminot_labolar') {
        sheetName = "Ta'minot - Labolar";
        columns = [
            { header: 'Avto raqami', key: 'plate', width: 18 },
            { header: 'Haydovchi', key: 'driverName', width: 20 },
            { header: 'Telefon raqami', key: 'driverPhone', width: 18 },
        ];
        rows = (value || []).map(item => ({
            plate: item.plate, driverName: item.driverName, driverPhone: item.driverPhone
        }));
    } else {
        return; // savedLogo kabi boshqa kalitlarni Excelga yozmaymiz
    }

    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(MEBEL_XLSX_PATH)) {
        await workbook.xlsx.readFile(MEBEL_XLSX_PATH);
    }
    const existing = workbook.getWorksheet(sheetName);
    if (existing) workbook.removeWorksheet(existing.id);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    rows.forEach(r => sheet.addRow(r));

    await workbook.xlsx.writeFile(MEBEL_XLSX_PATH);
}

app.get('/api/mebel/data', (req, res) => {
    const key = req.query.key;
    const store = loadMebelStore();
    res.json(store[key] !== undefined ? store[key] : null);
});

app.post('/api/mebel/data', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key kerak' });

        const store = loadMebelStore();
        store[key] = value;
        saveMebelStore(store);

        try {
            await mirrorMebelKeyToExcel(key, value);
        } catch (e) {
            console.error('Mebel Excel mirror xatolik:', e.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('❌ /api/mebel/data xatolik:', err.message);
        res.status(500).json({ error: 'Serverda xatolik' });
    }
});

// Ishlab chiqarish Excel faylini yuklab olish
app.get('/download-mebel-excel', (req, res) => {
    if (!fs.existsSync(MEBEL_XLSX_PATH)) {
        return res.status(404).send("Hali hech qanday yozuv kiritilmagan, fayl hali yaratilmagan.");
    }
    res.download(MEBEL_XLSX_PATH, 'ishlab_chiqarish.xlsx');
});

// ==========================================================
//  YUK MANIFEST — haftalik yetkazib berish (kanban) tizimi
//  Ma'lumotlar JSON fayllarda saqlanadi, har o'zgarishda
//  avtomatik "yuk-manifest.xlsx" fayliga ham ko'chiriladi.
// ==========================================================

const YUK_DATA_DIR = path.join(DATA_DIR, 'yuk-data');
const YUK_DATA_FILE = path.join(YUK_DATA_DIR, 'loads.json');
const YUK_TAXONOMY_FILE = path.join(YUK_DATA_DIR, 'taxonomy.json');
const YUK_ZBORSHIK_FILE = path.join(YUK_DATA_DIR, 'zborshiklar.json');
const YUK_LABO_FILE = path.join(YUK_DATA_DIR, 'labolar.json');
const YUK_EXCEL_FILE = path.join(DATA_DIR, 'yuk-manifest.xlsx');

const YUK_DEFAULT_CATEGORIES = ['Shkaf', 'Penal', 'Adnaspalni', 'Spalni garnitur', 'Termo', 'Dvuxspalni', 'Sandiq', 'Divan'];
const YUK_MATRAS_CATEGORIES = ['Adnaspalni', 'Spalni garnitur', 'Dvuxspalni', 'Divan'];
const YUK_MATRAS_TYPES = ['Pol artaped', 'Artaped', 'Super artaped'];

function yukReadJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return fallback;
    }
}
function yukWriteJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function yukReadLoads() { return yukReadJson(YUK_DATA_FILE, []); }
function yukWriteLoads(loads) {
    yukWriteJson(YUK_DATA_FILE, loads);
    yukWriteExcelSnapshot(loads);
}
function yukPublicLoad(l) {
    const { pin, ...rest } = l;
    return rest;
}

function yukWriteExcelSnapshot(loads) {
    try {
        const rows = loads.map((l) => ({
            'Sana': l.sana,
            'Holat': l.holat,
            'Kategoriya': l.kategoriya?.nomi || '',
            'Nomi': l.nomi || '',
            'Rang': l.rang?.nomi || '',
            'Matras': l.matras?.bor ? (l.matras.turi || 'Bor') : '',
            'Izoh': l.izoh || '',
            'Hudud': l.manzil?.hudud || '',
            'Dom': l.manzil?.dom || '',
            'Padyez': l.manzil?.padyez || '',
            'Etaj': l.manzil?.etaj || '',
            'Astatka': l.astatka || 0,
            'Telefon 1': l.tel1 || '',
            'Telefon 2': l.tel2 || '',
            "Zborshik": l.zborshik?.ism || '',
            'Zborshik tel': l.zborshik?.telefon || '',
            'Labo raqami': l.labo?.raqami || '',
            'Haydovchi': l.labo?.haydovchi || '',
            'Haydovchi tel': l.labo?.telefon || '',
            "To'landimi": l.tolandi ? 'Ha' : "Yo'q",
            "To'langan sana": l.tolanganSana || '',
            "To'langan summa": l.tolanganSumma || '',
            'Yaratilgan': l.createdAt || '',
        }));
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = [
            { wch: 11 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
            { wch: 26 }, { wch: 20 }, { wch: 8 }, { wch: 9 }, { wch: 7 }, { wch: 13 },
            { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 16 },
            { wch: 16 }, { wch: 9 }, { wch: 13 }, { wch: 15 }, { wch: 19 },
        ];
        if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, sheet, 'Zakazlar');
        fs.mkdirSync(DATA_DIR, { recursive: true });
        XLSX.writeFile(wb, YUK_EXCEL_FILE);
    } catch (err) {
        console.error("Yuk Excel'ga yozishda xatolik:", err.message);
    }
}

function yukReadTaxonomy() {
    let tax = yukReadJson(YUK_TAXONOMY_FILE, null);
    if (!tax) {
        tax = YUK_DEFAULT_CATEGORIES.map((name) => ({ id: crypto.randomUUID(), name, colors: [] }));
        yukWriteJson(YUK_TAXONOMY_FILE, tax);
        return tax;
    }
    return tax;
}
function yukWriteTaxonomy(tax) { yukWriteJson(YUK_TAXONOMY_FILE, tax); }

app.get('/api/taxonomy', (req, res) => {
    res.json({ categories: yukReadTaxonomy(), matrasCategories: YUK_MATRAS_CATEGORIES, matrasTypes: YUK_MATRAS_TYPES });
});

app.post('/api/taxonomy/categories', (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Kategoriya nomini kiriting' });
    const tax = yukReadTaxonomy();
    if (tax.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: 'Bu kategoriya allaqachon mavjud' });
    }
    const cat = { id: crypto.randomUUID(), name, colors: [] };
    tax.push(cat);
    yukWriteTaxonomy(tax);
    res.json(cat);
});

// Diqqat: "rang qo'shish" tugmasi frontend'dan olib tashlandi, lekin bu manzilning
// o'zi hali ham mavjud (kelajakda kerak bo'lib qolsa) — u orqali yangi rang qo'shilmaydi,
// chunki frontend endi bu funksiyani chaqirmaydi.
app.post('/api/taxonomy/categories/:catId/colors', (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Rang nomini kiriting' });
    const tax = yukReadTaxonomy();
    const cat = tax.find((c) => c.id === req.params.catId);
    if (!cat) return res.status(404).json({ error: 'Kategoriya topilmadi' });
    if (cat.colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: 'Bu rang allaqachon mavjud' });
    }
    const color = { id: crypto.randomUUID(), name };
    cat.colors.push(color);
    yukWriteTaxonomy(tax);
    res.json(color);
});

function yukReadZborshiklar() { return yukReadJson(YUK_ZBORSHIK_FILE, []); }
function yukWriteZborshiklar(list) { yukWriteJson(YUK_ZBORSHIK_FILE, list); }

app.get('/api/zborshiklar', (req, res) => res.json(yukReadZborshiklar()));

app.post('/api/zborshiklar', (req, res) => {
    const ism = String(req.body.ism || '').trim();
    const telefon = String(req.body.telefon || '').trim();
    if (!ism) return res.status(400).json({ error: "Zborshik ismini kiriting" });
    const list = yukReadZborshiklar();
    const z = { id: crypto.randomUUID(), ism, telefon };
    list.push(z);
    yukWriteZborshiklar(list);
    res.json(z);
});

function yukReadLabolar() { return yukReadJson(YUK_LABO_FILE, []); }
function yukWriteLabolar(list) { yukWriteJson(YUK_LABO_FILE, list); }

app.get('/api/labolar', (req, res) => res.json(yukReadLabolar()));

app.post('/api/labolar', (req, res) => {
    const raqami = String(req.body.raqami || '').trim();
    const haydovchi = String(req.body.haydovchi || '').trim();
    const telefon = String(req.body.telefon || '').trim();
    if (!raqami || !haydovchi) return res.status(400).json({ error: "Labo raqami va haydovchi ismini kiriting" });
    const list = yukReadLabolar();
    const l = { id: crypto.randomUUID(), raqami, haydovchi, telefon };
    list.push(l);
    yukWriteLabolar(list);
    res.json(l);
});

app.get('/api/loads', (req, res) => {
    const loads = yukReadLoads();
    res.json(loads.map(yukPublicLoad));
});

function yukResolveMatras(kategoriyaNomi, matrasInput) {
    if (!matrasInput || !matrasInput.bor) return { bor: false, turi: null };
    if (!YUK_MATRAS_CATEGORIES.includes(kategoriyaNomi)) return { bor: false, turi: null };
    const turi = YUK_MATRAS_TYPES.includes(matrasInput.turi) ? matrasInput.turi : YUK_MATRAS_TYPES[0];
    return { bor: true, turi };
}

app.post('/api/loads', (req, res) => {
    const {
        adminCode, pin, sana, holat, kategoriyaId, nomi, rangId, matras,
        izoh, manzil, astatka, tel1, tel2, zborshikId, laboId,
    } = req.body;

    if (adminCode !== YUK_ADD_CODE) return res.status(403).json({ error: "Kod noto'g'ri" });
    if (!pin || String(pin).trim().length < 4) return res.status(400).json({ error: "PIN kamida 4 xonali bo'lishi kerak" });
    if (!sana || !kategoriyaId || !rangId || !String(nomi || '').trim()) {
        return res.status(400).json({ error: 'Sana, kategoriya, nomi va rang majburiy' });
    }

    const loads = yukReadLoads();
    const sameDayCount = loads.filter((l) => l.sana === sana).length;
    if (sameDayCount >= YUK_MAX_PER_DAY) {
        return res.status(400).json({ error: `Bu kunga zakazlar to'ldi (kuniga maksimum ${YUK_MAX_PER_DAY} ta)` });
    }

    const tax = yukReadTaxonomy();
    const cat = tax.find((c) => c.id === kategoriyaId);
    const rang = cat && cat.colors.find((c) => c.id === rangId);
    if (!cat || !rang) return res.status(400).json({ error: 'Kategoriya / rang topilmadi' });

    let zborshik = null;
    if (zborshikId) {
        const z = yukReadZborshiklar().find((x) => x.id === zborshikId);
        if (z) zborshik = { id: z.id, ism: z.ism, telefon: z.telefon };
    }
    let labo = null;
    if (laboId) {
        const lv = yukReadLabolar().find((x) => x.id === laboId);
        if (lv) labo = { id: lv.id, raqami: lv.raqami, haydovchi: lv.haydovchi, telefon: lv.telefon };
    }

    const newLoad = {
        id: crypto.randomUUID(),
        sana,
        holat: ['yashil', 'qizil', 'sariq'].includes(holat) ? holat : 'yashil',
        kategoriya: { id: cat.id, nomi: cat.name },
        nomi: String(nomi).trim(),
        rang: { id: rang.id, nomi: rang.name },
        matras: yukResolveMatras(cat.name, matras),
        izoh: String(izoh || '').trim(),
        manzil: {
            hudud: manzil?.hudud || '',
            dom: manzil?.dom || '',
            padyez: manzil?.padyez || '',
            etaj: manzil?.etaj || '',
        },
        astatka: Number(astatka) || 0,
        tel1: tel1 || '',
        tel2: tel2 || '',
        zborshik,
        labo,
        pin: String(pin).trim(),
        tolandi: false,
        tolanganSana: null,
        tolanganSumma: null,
        createdAt: new Date().toISOString(),
    };
    loads.push(newLoad);
    yukWriteLoads(loads);
    res.json(yukPublicLoad(newLoad));
});

app.put('/api/loads/:id', (req, res) => {
    const loads = yukReadLoads();
    const idx = loads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });

    const { pin } = req.body;
    if (!pin || String(pin).trim() !== String(loads[idx].pin)) {
        return res.status(403).json({ error: "PIN noto'g'ri" });
    }

    const {
        sana, holat, kategoriyaId, nomi, rangId, matras, izoh, manzil, astatka,
        tel1, tel2, zborshikId, laboId,
    } = req.body;

    if (sana && sana !== loads[idx].sana) {
        const count = loads.filter((l) => l.sana === sana && l.id !== loads[idx].id).length;
        if (count >= YUK_MAX_PER_DAY) {
            return res.status(400).json({ error: `Bu kunga zakazlar to'ldi (kuniga maksimum ${YUK_MAX_PER_DAY} ta)` });
        }
    }

    let kategoriya = loads[idx].kategoriya;
    let rang = loads[idx].rang;
    let matrasFinal = loads[idx].matras;
    if (kategoriyaId || rangId || matras !== undefined) {
        const tax = yukReadTaxonomy();
        const cat = tax.find((c) => c.id === (kategoriyaId || loads[idx].kategoriya?.id));
        const col = cat && cat.colors.find((c) => c.id === (rangId || loads[idx].rang?.id));
        if (cat) kategoriya = { id: cat.id, nomi: cat.name };
        if (col) rang = { id: col.id, nomi: col.name };
        matrasFinal = yukResolveMatras(kategoriya.nomi, matras !== undefined ? matras : loads[idx].matras);
    }

    let zborshik = loads[idx].zborshik;
    if (zborshikId !== undefined) {
        if (!zborshikId) zborshik = null;
        else {
            const z = yukReadZborshiklar().find((x) => x.id === zborshikId);
            if (z) zborshik = { id: z.id, ism: z.ism, telefon: z.telefon };
        }
    }
    let labo = loads[idx].labo;
    if (laboId !== undefined) {
        if (!laboId) labo = null;
        else {
            const lv = yukReadLabolar().find((x) => x.id === laboId);
            if (lv) labo = { id: lv.id, raqami: lv.raqami, haydovchi: lv.haydovchi, telefon: lv.telefon };
        }
    }

    loads[idx] = {
        ...loads[idx],
        sana: sana ?? loads[idx].sana,
        holat: ['yashil', 'qizil', 'sariq'].includes(holat) ? holat : loads[idx].holat,
        kategoriya,
        nomi: nomi !== undefined ? String(nomi).trim() : loads[idx].nomi,
        rang,
        matras: matrasFinal,
        izoh: izoh !== undefined ? String(izoh).trim() : loads[idx].izoh,
        manzil: manzil ?? loads[idx].manzil,
        astatka: astatka !== undefined ? Number(astatka) : loads[idx].astatka,
        tel1: tel1 ?? loads[idx].tel1,
        tel2: tel2 ?? loads[idx].tel2,
        zborshik,
        labo,
    };
    yukWriteLoads(loads);
    res.json(yukPublicLoad(loads[idx]));
});

// Zborshik / labo'ni tezkor biriktirish yoki almashtirish — HECH QANDAY KOD SO'RALMAYDI
app.put('/api/loads/:id/assign', (req, res) => {
    const loads = yukReadLoads();
    const idx = loads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });

    const { zborshikId, laboId } = req.body;

    if (zborshikId !== undefined) {
        if (!zborshikId) loads[idx].zborshik = null;
        else {
            const z = yukReadZborshiklar().find((x) => x.id === zborshikId);
            loads[idx].zborshik = z ? { id: z.id, ism: z.ism, telefon: z.telefon } : loads[idx].zborshik;
        }
    }
    if (laboId !== undefined) {
        if (!laboId) loads[idx].labo = null;
        else {
            const lv = yukReadLabolar().find((x) => x.id === laboId);
            loads[idx].labo = lv ? { id: lv.id, raqami: lv.raqami, haydovchi: lv.haydovchi, telefon: lv.telefon } : loads[idx].labo;
        }
    }
    yukWriteLoads(loads);
    res.json(yukPublicLoad(loads[idx]));
});

app.put('/api/loads/:id/pay', (req, res) => {
    const { paymentCode } = req.body;
    if (paymentCode !== YUK_PAYMENT_CODE) return res.status(403).json({ error: "Kod noto'g'ri" });
    const loads = yukReadLoads();
    const idx = loads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
    if (loads[idx].tolandi) return res.status(400).json({ error: 'Bu yuk uchun pul allaqachon olingan' });

    loads[idx].tolandi = true;
    loads[idx].tolanganSana = localDateStr();
    loads[idx].tolanganSumma = Number(loads[idx].astatka) || 0;
    yukWriteLoads(loads);
    res.json(yukPublicLoad(loads[idx]));
});

app.put('/api/loads/:id/unpay', (req, res) => {
    const { paymentCode } = req.body;
    if (paymentCode !== YUK_PAYMENT_CODE) return res.status(403).json({ error: "Kod noto'g'ri" });
    const loads = yukReadLoads();
    const idx = loads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
    loads[idx].tolandi = false;
    loads[idx].tolanganSana = null;
    loads[idx].tolanganSumma = null;
    yukWriteLoads(loads);
    res.json(yukPublicLoad(loads[idx]));
});

app.delete('/api/loads/:id', (req, res) => {
    const { deleteCode } = req.body;
    if (deleteCode !== YUK_DELETE_CODE) return res.status(403).json({ error: "Kod noto'g'ri" });
    let loads = yukReadLoads();
    const exists = loads.some((l) => l.id === req.params.id);
    if (!exists) return res.status(404).json({ error: 'Topilmadi' });
    loads = loads.filter((l) => l.id !== req.params.id);
    yukWriteLoads(loads);
    res.json({ ok: true });
});

app.get('/api/export/excel', (req, res) => {
    yukWriteExcelSnapshot(yukReadLoads());
    res.download(YUK_EXCEL_FILE, 'yuk-manifest.xlsx');
});

restoreTodayStateFromExcel().then(() => {
    checkLunchReport(); // agar server 10:00 dan keyin qayta ishga tushsa, darhol tekshirib qo'yadi

    app.listen(PORT, '0.0.0.0', () => {
        console.log('==========================================================');
        console.log(`✅ Server ishga tushdi!`);
        console.log(`🌐 Shu kompyuterda oching:      http://localhost:${PORT}`);
        const ips = getLocalIPs();
        if (ips.length > 0) {
            ips.forEach(ip => console.log(`📱 Planshet/telefonda oching: http://${ip}:${PORT}`));
        }
        console.log(`📊 Davomat fayli shu yerda saqlanadi: ${EXCEL_PATH}`);
        console.log('==========================================================');
    });
});
