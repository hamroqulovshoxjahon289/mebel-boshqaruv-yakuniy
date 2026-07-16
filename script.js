const video = document.getElementById('video');
const loadingOverlay = document.getElementById('loading-overlay');
const statusCard = document.getElementById('status-card');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');
const logsBody = document.getElementById('logs-body');
const lunchReportEl = document.getElementById('lunch-report');
const lunchDesc = document.getElementById('lunch-desc');

// 🟢 Bu yerdagi nom "labels/" papkasidagi papka nomi bilan bir xil bo'lishi shart!
// Masalan: LABELS ichida 'shoxi' bo'lsa, "labels/shoxi/1.jpg" fayli bo'lishi kerak.
const LABELS = [
    'shoxi',
    'Dilshod',
    'Shorux_mayda',
    'Amir_upakovka',
    'Fayoz_kromka',
    'Fayoz_utalshoni',
    'Islom_kromka',
    'Samir',
    'Shaxriyor',
    'Shaxzod_rover',
    'Zarshed_arra'
];

// AI modellari internetdan (CDN orqali) avtomatik yuklanadi.
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/';

// 🏭 MEBEL TIZIMI BILAN BOG'LASH: xodim "keldi" deganidan keyin, uning
// ishlab chiqarish bo'limiga bitta tugma bilan o'tishi uchun.
// Chap tomon — LABELS dagi ism (aynan bir xil yozilishi kerak).
// O'ng tomon — mebel.html dagi bo'lim kaliti (OPERATIONAL_SECTIONS/MATERIAL_SECTIONS ichidan).
// DIQQAT: bu ro'yxatni tekshirib, kerak bo'lsa to'g'irlang — men taxminan moslashtirdim!
const EMPLOYEE_DEPARTMENT = {
    'Amir_upakovka': 'korpus_upakovka',
    'Fayoz_kromka': 'korpus_kromka',
    'Fayoz_utalshoni': 'fasad_utalshoni',
    'Shaxzod_rover': 'fasad_rover',
    'Zarshed_arra': 'korpus_ara',
    'Shorux_mayda': 'korpus_toshuk',
    'Samir': 'korpus_upakovka',
    'Shaxriyor': 'korpus_upakovka',
    'Dilshod': 'taminot',
};

let faceMatcher = null;
let isProcessing = false;

// Bir xil odamni ketma-ket bir necha marta serverga yubormaslik uchun
// (haqiqiy keldi/ketdi qarori serverning o'zida qabul qilinadi, bu shunchaki keraksiz so'rovlarni kamaytiradi)
let lastSentPerson = null;
let lastSentTime = 0;
const CLIENT_DEBOUNCE_MS = 5000;

async function startApp() {
    try {
        statusTitle.innerText = "Modellar yuklanmoqda...";
        // TinyFaceDetector — tezkor (real vaqtda) yuz aniqlash uchun (jonli kamerada ishlatiladi)
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        // SsdMobilenetv1 — aniqroq, lekin sekinroq model (faqat xodim rasmlarini 1 marta "o'qish" uchun ishlatiladi)
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        statusTitle.innerText = "Kamera yoqilmoqda...";
        await startVideo();

        statusTitle.innerText = "Ishchilar ma'lumotlari tahlil qilinmoqda...";
        faceMatcher = await loadLabeledImages();

        // Bugungi holatni serverdan olib, jadvalni to'ldiramiz
        // (sahifa yangilansa ham ma'lumot yo'qolmaydi, chunki bu server xotirasida turadi)
        await refreshTodayState();

        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 500);

        updateStatus('waiting', 'Kameraga qarang', "Tizim tayyor, yuzingizni ko'rsating");
        onPlay();

        // Jadval va tushlik hisobotini har 30 soniyada bir yangilab turamiz
        // (hech kim kameraga qaramasa ham, ekran yangi holatni ko'rsatib tursin)
        setInterval(refreshTodayState, 30000);
    } catch (error) {
        console.error(error);
        statusTitle.innerText = "Xatolik!";
        statusDesc.innerText = "Modellar yoki kamerani yuklashda xato bo'ldi.";
    }
}

async function startVideo() {
    return new Promise((resolve, reject) => {
        // Kamera piksel o'lchamini cheklaymiz — bu tanish jarayonini sezilarli tezlashtiradi
        // (kattaroq rasmni tahlil qilish ko'proq vaqt oladi, aniqlik uchun bunchalik katta shart emas)
        navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } })
            .then(stream => { video.srcObject = stream; resolve(); })
            .catch(err => reject(err));
    });
}

async function loadLabeledImages() {
    return Promise.all(
        LABELS.map(async label => {
            const descriptions = [];

            // Har bir xodim uchun 1 nechta rasm bo'lishi mumkin: 1.jpg, 2.jpg, 3.jpg ...
            // Tizim qancha ko'p rasm ko'rsa, shuncha aniq taniydi (turli burchak/yorug'lik bilan)
            // Kamida 1.jpg bo'lishi shart, qolganlari ixtiyoriy (bo'lmasa shunchaki o'tkazib yuboriladi)
            const MAX_PHOTOS = 5;
            for (let i = 1; i <= MAX_PHOTOS; i++) {
                const imgUrl = `./labels/${label}/${i}.jpg`;
                try {
                    const img = await faceapi.fetchImage(imgUrl);
                    const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
                    if (detections) {
                        descriptions.push(detections.descriptor);
                    } else if (i === 1) {
                        console.warn(`Yuz aniqlanmadi: ${label}. Rasm aniq va yuz ochiq ko'ringanligiga ishonch hosil qiling.`);
                    }
                } catch (e) {
                    if (i === 1) {
                        console.error(`Rasm yuklanmadi (${label}). "labels/${label}/1.jpg" fayli mavjudligini tekshiring:`, e);
                    }
                    // 2.jpg, 3.jpg va h.k. topilmasa — bu normal, shunchaki shu odam uchun qo'shimcha rasm yo'q
                }
            }

            console.log(`✅ ${label} uchun ${descriptions.length} ta rasm yuklandi.`);
            if (descriptions.length === 0) {
                console.error(`⚠️⚠️ DIQQAT: "${label}" uchun BIRORTA HAM rasm yuklanmadi! "labels/${label}/1.jpg" fayli borligini va nomi to'g'ri yozilganini tekshiring.`);
            }
            return new faceapi.LabeledFaceDescriptors(label, descriptions);
        })
    ).then(labels => {
        // MUHIM: rasmi 0 ta bo'lgan xodimlarni FaceMatcher'ga umuman qo'shmaymiz!
        // (face-api.js kutubxonasi 0 ta rasmli xodimni "masofa 0.000" ya'ni "aynan mos" deb
        // noto'g'ri hisoblab, uni HAR DOIM g'olib deb tanlab qo'yadigan xato bor edi —
        // aynan shu sabab tizim tasodifiy odamlarni "tanib" chiqarayotgan edi)
        const validLabels = labels.filter(l => l.descriptors.length > 0);
        const skipped = labels.filter(l => l.descriptors.length === 0).map(l => l.label);
        if (skipped.length > 0) {
            console.error(`🚫 Quyidagi xodimlar rasmsizligi sababli TANISH RO'YXATIDAN OLIB TASHLANDI (ular hozircha tanilmaydi, lekin boshqalarni ham xato tanimaydi): ${skipped.join(', ')}`);
        }
        // Moslik chegarasi (0.4) — bu tizimni juda "qattiq" qiladi,
        // shunda umuman o'xshamagan odamlarni bir-biriga adashtirish deyarli imkonsiz bo'ladi.
        // Agar tizim haqiqiy xodimni ham "Noma'lum" deb chiqara boshlasa, buni 0.45-0.5 ga oshiring.
        return new faceapi.FaceMatcher(validLabels, 0.4);
    });
}

async function onPlay() {
    if (video.paused || video.ended) {
        return setTimeout(() => onPlay(), 500);
    }

    if (isProcessing) {
        return setTimeout(() => onPlay(), 500);
    }

    // TinyFaceDetector — tez ishlaydi, jonli kamera uchun mos
    const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (detection && faceMatcher) {
        const match = faceMatcher.findBestMatch(detection.descriptor);
        // Diagnostika: konsolda kim bilan qanchalik "yaqinligi"ni ko'rsatadi (0 ga qancha yaqin bo'lsa, shuncha o'xshash)
        console.log(`🔍 Eng yaqin topilgan: "${match.label}" (masofa: ${match.distance.toFixed(3)}, chegara: 0.4)`);
        if (match.label !== 'unknown') {
            await handleRecognitionResult(match.label);
        } else {
            updateStatus('waiting', 'Kameraga qarang', "Yuz tanilmadi. Qaytadan urinib ko'ring");
        }
    } else {
        updateStatus('waiting', 'Kameraga qarang', 'Yuzingizni skanerlash uchun markazda turing');
    }

    setTimeout(() => onPlay(), 500);
}

async function handleRecognitionResult(rawLabel) {
    const personName = rawLabel.replace('_', ' ');
    const now = Date.now();

    // Bir necha soniya ichida takror so'rov yubormaslik (server hozir shu odamni qayta ishlamoqda)
    if (lastSentPerson === personName && (now - lastSentTime) < CLIENT_DEBOUNCE_MS) {
        return;
    }
    lastSentPerson = personName;
    lastSentTime = now;

    isProcessing = true;

    try {
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: personName })
        });

        if (!response.ok) throw new Error('Server javobi xato: ' + response.status);
        const data = await response.json();

        if (data.status === 'keldi') {
            if (data.lateMinutes > 0) {
                updateStatus('unknown',
                    `${personName} ${data.lateMinutes} daqiqa kech qoldi`,
                    `Jarima: ${data.fine.toLocaleString('uz-UZ')} so'm. Vaqt: ${data.time}`);
            } else {
                updateStatus('success', `${personName} keldi!`, `Vaqt: ${data.time}. Oq yo'l!`);
            }
            showMebelLink(rawLabel, personName);
        } else if (data.status === 'ketdi') {
            if (data.fineReduction > 0) {
                updateStatus('success', `${personName} ketdi!`,
                    `Vaqt: ${data.time}. Bugun ${data.workHours} ishladingiz. Kech qolgan uchun jarimadan ${data.fineReduction.toLocaleString('uz-UZ')} so'm kamaytirildi (qoldi: ${data.remainingFine.toLocaleString('uz-UZ')} so'm).`);
            } else {
                updateStatus('success', `${personName} ketdi!`, `Vaqt: ${data.time}. Bugun ${data.workHours} ishladingiz.`);
            }
        } else if (data.status === 'done') {
            updateStatus('success', personName, "Siz bugun allaqachon ro'yxatdan o'tgansiz.");
        }
        // status === 'ignored' bo'lsa — hech narsa ko'rsatmaymiz, kutish holatida qolaveradi

        await refreshTodayState();
    } catch (err) {
        console.error("Serverga yuborishda xato:", err);
        updateStatus('unknown', "Excelga yozib bo'lmadi!", "Server ishlab turganini tekshiring (node server.js).");
    }

    setTimeout(() => {
        isProcessing = false;
        updateStatus('waiting', 'Kameraga qarang', "Tizim tayyor, yuzingizni ko'rsating");
    }, 4000);
}

function updateStatus(type, title, desc) {
    if (!statusCard) return;
    statusCard.className = `status-card ${type}`;
    const iconEl = statusCard.querySelector('.status-icon');
    if (iconEl) {
        iconEl.innerText = type === 'waiting' ? '📷' : (type === 'unknown' ? '⚠️' : '✅');
    }
    statusTitle.innerText = title;
    statusDesc.innerText = desc;
}

// Serverdan bugungi to'liq holatni olib, jadval va tushlik hisobotini yangilaydi
async function refreshTodayState() {
    try {
        const response = await fetch('/api/attendance/today');
        if (!response.ok) return;
        const data = await response.json();
        renderTable(data.arrivals);
        renderLunchReport(data.lunchReport);
    } catch (e) {
        console.warn("Holatni yangilab bo'lmadi:", e);
    }
}

function renderTable(arrivals) {
    const names = Object.keys(arrivals);
    if (names.length === 0) {
        logsBody.innerHTML = `<tr class="empty-row"><td colspan="6">Hozircha hech kim ro'yxatdan o'tmadi</td></tr>`;
        return;
    }

    logsBody.innerHTML = '';
    names.forEach(name => {
        const item = arrivals[name];
        const lateText = item.lateMinutes > 0 ? `${item.lateMinutes} daqiqa` : "Yo'q";
        const fineText = item.fine > 0 ? `${item.fine.toLocaleString('uz-UZ')} so'm` : "—";

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td style="color:rgb(11, 152, 63);">${item.checkIn || '--:--'}</td>
            <td style="color: #dc2626;">${item.checkOut || '--:--'}</td>
            <td class="late-cell ${item.lateMinutes > 0 ? '' : 'none'}">${lateText}</td>
            <td class="fine-cell ${item.fine > 0 ? '' : 'none'}">${fineText}</td>
            <td style="font-weight: 600; color: #2563eb;">${item.workHours}</td>
        `;
        logsBody.appendChild(row);
    });
}

function renderLunchReport(lunchReport) {
    if (!lunchReport || !lunchReport.done) {
        lunchReportEl.classList.add('hidden');
        return;
    }
    lunchReportEl.classList.remove('hidden');
    lunchDesc.innerText = `Soat 10:00 holatiga: ${lunchReport.count} kishi keldi. Oshpazga xabar bering!`;
}

// Xodim "keldi" deb belgilangach, uning ishlab chiqarish bo'limiga
// bitta tugma bilan o'tishi uchun havola ko'rsatamiz (agar bo'limi ma'lum bo'lsa)
function showMebelLink(rawLabel, personName) {
    const sectionKey = EMPLOYEE_DEPARTMENT[rawLabel];
    const el = document.getElementById('mebel-link');
    if (!el) return;

    if (sectionKey) {
        const url = `/mebel.html?ism=${encodeURIComponent(personName)}&bolim=${encodeURIComponent(sectionKey)}`;
        el.innerHTML = `<a href="${url}" class="mebel-link-btn">🏭 Ishlab chiqarish jurnaliga o'tish (${personName})</a>`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

window.onload = startApp;
