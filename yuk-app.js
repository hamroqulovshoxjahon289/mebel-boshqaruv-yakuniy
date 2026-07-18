const DAY_NAMES_BY_DOW = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const HOLAT_LABEL = { qizil: 'Hali tayyor emas', sariq: 'Yuklanmoqda', yashil: 'Yuborildi' };
const MAX_PER_DAY = 30;
const NEW_OPTION = '__new__';
const VISIBLE_DAYS = 3;   // asosiy ekranda ko'rinadigan kunlar soni
const REPORT_DAYS = 7;    // hisobot doim 7 kunlik (haftalik) hisoblanadi
const ADNASPALNI_NAME = 'adnaspalni';

let loads = [];
let taxonomy = { categories: [], matrasCategories: [], matrasTypes: [] };
let zborshiklar = [];
let labolar = [];
let currentStart = startOfDay(new Date());
let editingId = null;
let viewingLoad = null;
let searchTerm = '';

// ---------------- Sana yordamchilari ----------------
function startOfDay(d) { const date = new Date(d); date.setHours(0, 0, 0, 0); return date; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toISO(d) {
  // MUHIM: toISOString() ishlatmaymiz — u UTC (Grinvich) vaqtiga o'tkazib
  // hisoblaydi, O'zbekiston esa UTC+5 bo'lgani uchun bu kunni bir kunga
  // siljitib qo'yardi. Shu sabab mahalliy (local) sana qismlarini
  // to'g'ridan-to'g'ri o'zimiz yig'amiz — hech qanday siljish bo'lmaydi.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtShort(d) { return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' }); }
function fmtMoney(n) { return Number(n || 0).toLocaleString('ru-RU'); }
function escapeHtml(s) { const div = document.createElement('div'); div.textContent = s ?? ''; return div.innerHTML; }

// ---------------- API: loads ----------------
async function fetchLoads() { loads = await (await fetch('/api/loads')).json(); }
async function createLoad(payload) {
  const res = await fetch('/api/loads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function updateLoad(id, payload) {
  const res = await fetch(`/api/loads/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function assignLoad(id, payload) {
  const res = await fetch(`/api/loads/${id}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function deleteLoad(id, deleteCode) {
  const res = await fetch(`/api/loads/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteCode }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}

// ---------------- API: taxonomy / zborshik / labo (hech qanday kod so'ralmaydi) ----------------
async function fetchTaxonomy() { taxonomy = await (await fetch('/api/taxonomy')).json(); }
async function addCategory(name) {
  const res = await fetch('/api/taxonomy/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function addColor(catId, name) {
  const res = await fetch(`/api/taxonomy/categories/${catId}/colors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchZborshiklar() { zborshiklar = await (await fetch('/api/zborshiklar')).json(); }
async function addZborshik(ism, telefon) {
  const res = await fetch('/api/zborshiklar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ism, telefon }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}
async function fetchLabolar() { labolar = await (await fetch('/api/labolar')).json(); }
async function addLabo(raqami, haydovchi, telefon) {
  const res = await fetch('/api/labolar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raqami, haydovchi, telefon }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}

// ---------------- Formadagi selectlar ----------------
const catSelect = document.getElementById('f_kategoriya');
const nomiInput = document.getElementById('f_nomi');
const rangSelect = document.getElementById('f_rang');
const matrasRow = document.getElementById('matrasRow');
const matrasBorCheck = document.getElementById('f_matras_bor');
const matrasTuriWrap = document.getElementById('matrasTuriWrap');
const matrasTuriSelect = document.getElementById('f_matras_turi');
const zborshikSelect = document.getElementById('f_zborshik');
const laboSelect = document.getElementById('f_labo');

function fillSelect(select, items, placeholder, addLabel, valueFn, labelFn) {
  select.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  ph.disabled = true;
  select.appendChild(ph);
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = valueFn ? valueFn(item) : item.id;
    opt.textContent = labelFn ? labelFn(item) : item.name;
    select.appendChild(opt);
  });
  if (addLabel) {
    const addOpt = document.createElement('option');
    addOpt.value = NEW_OPTION;
    addOpt.textContent = addLabel;
    select.appendChild(addOpt);
  }
  select.value = '';
}

function currentCategory() { return taxonomy.categories.find((c) => c.id === catSelect.value); }

function populateCategories(selectedId) {
  fillSelect(catSelect, taxonomy.categories, 'Kategoriyani tanlang', "➕ Yangi kategoriya qo'shish");
  if (selectedId) catSelect.value = selectedId;
  toggleMatrasRow();
}
function populateColors(selectedId) {
  const cat = currentCategory();
  // "Yangi rang qo'shish" tugmasi olib tashlandi — endi faqat mavjud ranglar ko'rsatiladi
  fillSelect(rangSelect, cat ? cat.colors : [], cat ? 'Rangni tanlang' : 'Avval kategoriya tanlang', null);
  rangSelect.disabled = !cat;
  if (selectedId) rangSelect.value = selectedId;
}
function populateZborshiklar(select, selectedId) {
  fillSelect(select, zborshiklar, '— tanlanmagan —', "➕ Yangi zborshik qo'shish", null, (z) => `${z.ism}${z.telefon ? ' — ' + z.telefon : ''}`);
  select.value = selectedId || '';
}
function populateLabolar(select, selectedId) {
  fillSelect(select, labolar, '— tanlanmagan —', "➕ Yangi labo qo'shish", null, (l) => `${l.raqami} — ${l.haydovchi}`);
  select.value = selectedId || '';
}

function toggleMatrasRow() {
  const cat = currentCategory();
  const name = (cat?.name || '').toLowerCase();
  const applicable = taxonomy.matrasCategories.some((m) => m.toLowerCase() === name);
  matrasRow.style.display = applicable ? '' : 'none';
  if (!applicable) {
    matrasBorCheck.checked = false;
    matrasTuriWrap.style.display = 'none';
  }
}

catSelect.addEventListener('change', async () => {
  if (catSelect.value === NEW_OPTION) {
    const name = prompt('Yangi kategoriya nomi:');
    if (!name || !name.trim()) { catSelect.value = ''; return; }
    try {
      const cat = await addCategory(name.trim());
      await fetchTaxonomy();
      populateCategories(cat.id);
      populateColors('');
    } catch (err) {
      showToast(err.message, true);
      catSelect.value = '';
    }
    return;
  }
  toggleMatrasRow();
  populateColors('');
});

// "Yangi rang qo'shish" funksiyasi olib tashlandi (endi rangSelect faqat mavjud
// ranglarni ko'rsatadi, yangi qo'shish imkoniyati yo'q)

matrasBorCheck.addEventListener('change', () => {
  matrasTuriWrap.style.display = matrasBorCheck.checked ? '' : 'none';
});

zborshikSelect.addEventListener('change', async () => {
  if (zborshikSelect.value === NEW_OPTION) {
    const ism = prompt('Yangi zborshik ismi:');
    if (!ism || !ism.trim()) { zborshikSelect.value = ''; return; }
    const telefon = prompt('Zborshikning telefon raqami:') || '';
    try {
      const z = await addZborshik(ism.trim(), telefon.trim());
      await fetchZborshiklar();
      populateZborshiklar(zborshikSelect, z.id);
    } catch (err) {
      showToast(err.message, true);
      zborshikSelect.value = '';
    }
  }
});

laboSelect.addEventListener('change', async () => {
  if (laboSelect.value === NEW_OPTION) {
    const raqami = prompt('Labo (mashina) raqami:');
    if (!raqami || !raqami.trim()) { laboSelect.value = ''; return; }
    const haydovchi = prompt('Haydovchi ismi:') || '';
    const telefon = prompt('Haydovchi telefon raqami:') || '';
    try {
      const l = await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
      await fetchLabolar();
      populateLabolar(laboSelect, l.id);
    } catch (err) {
      showToast(err.message, true);
      laboSelect.value = '';
    }
  }
});

// ---------------- Qidiruv ----------------
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderBoard();
});
function matchesSearch(l) {
  if (!searchTerm) return true;
  const hay = [
    l.nomi, l.manzil?.hudud, l.manzil?.dom, l.tel1, l.tel2,
    l.zborshik?.ism, l.zborshik?.telefon, l.labo?.raqami, l.labo?.haydovchi, l.labo?.telefon,
    l.kategoriya?.nomi, l.rang?.nomi,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(searchTerm);
}

// ---------------- Render: board (har kun ichida 2 ustun: Boshqa | Adnaspalni) ----------------
function renderWeekLabel() {
  const end = addDays(currentStart, VISIBLE_DAYS - 1);
  document.getElementById('weekLabel').textContent = `${fmtShort(currentStart)} — ${fmtShort(end)}`;
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const todayISO = toISO(new Date());

  for (let i = 0; i < VISIBLE_DAYS; i++) {
    const date = addDays(currentStart, i);
    const iso = toISO(date);
    const isToday = iso === todayISO;

    const col = document.createElement('div');
    col.className = 'day-col' + (isToday ? ' is-today' : '');

    const dayLoads = loads.filter((l) => l.sana === iso); // limit hisoblash uchun — filtrlanmagan
    const displayLoads = dayLoads.filter(matchesSearch);
    const otherLoads = displayLoads.filter((l) => (l.kategoriya?.nomi || '').toLowerCase() !== ADNASPALNI_NAME);
    const adnaLoads = displayLoads.filter((l) => (l.kategoriya?.nomi || '').toLowerCase() === ADNASPALNI_NAME);

    const head = document.createElement('div');
    head.className = 'day-col-head';
    head.innerHTML = `<span class="day-name">${DAY_NAMES_BY_DOW[date.getDay()]}</span><span class="day-date">${fmtShort(date)} · ${dayLoads.length}/${MAX_PER_DAY}</span>`;
    col.appendChild(head);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.textContent = dayLoads.length >= MAX_PER_DAY ? "To'ldi (30/30)" : "+ Yuk qo'shish";
    addBtn.disabled = dayLoads.length >= MAX_PER_DAY;
    addBtn.onclick = () => openAddModal(iso);
    col.appendChild(addBtn);

    const split = document.createElement('div');
    split.className = 'day-split';
    split.appendChild(renderGroup('Boshqa', otherLoads));
    split.appendChild(renderGroup('Adnaspalni', adnaLoads));
    col.appendChild(split);

    board.appendChild(col);
  }
}

function renderGroup(title, items) {
  const wrap = document.createElement('div');
  wrap.className = 'day-group';
  const head = document.createElement('div');
  head.className = 'day-group-head';
  head.textContent = `${title} · ${items.length}`;
  wrap.appendChild(head);
  const list = document.createElement('div');
  list.className = 'day-group-list';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-day';
    empty.textContent = '—';
    list.appendChild(empty);
  } else {
    items.forEach((l) => list.appendChild(renderCard(l)));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderCard(l) {
  const card = document.createElement('div');
  card.className = `load-card rang-${l.holat}` + (l.tolandi ? ' is-paid' : '');
  const addrBits = [l.manzil?.hudud, l.manzil?.dom ? `dom ${l.manzil.dom}` : '', l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '', l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '']
    .filter(Boolean).join(', ');

  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');
  const meta = [];
  if (l.matras?.bor) meta.push(`🛏 ${l.matras.turi}`);
  if (l.zborshik) meta.push(`🧰 ${l.zborshik.ism}`);
  if (l.labo) meta.push(`🚚 ${l.labo.raqami}`);

  card.innerHTML = `
    <div class="load-card-top">
      <div class="load-name">${escapeHtml(title || '—')}</div>
      ${l.kategoriya?.nomi ? `<div class="load-number">${escapeHtml(l.kategoriya.nomi)}</div>` : ''}
    </div>
    ${addrBits ? `<div class="load-addr">${escapeHtml(addrBits)}</div>` : ''}
    <div class="load-fin">
      <div class="dot-leader"><span class="lbl">Astatka</span><span class="fill"></span><span class="val">${fmtMoney(l.astatka)}</span></div>
      ${l.tel1 ? `<div class="dot-leader"><span class="lbl">Tel</span><span class="fill"></span><span class="val">${escapeHtml(l.tel1)}</span></div>` : ''}
    </div>
    ${meta.length ? `<div class="load-meta">${meta.map(escapeHtml).join(' · ')}</div>` : ''}
    ${l.tolandi ? `<div class="paid-badge">💰 To'landi</div>` : ''}
  `;
  card.onclick = () => openViewModal(l);
  return card;
}

// ---------------- Add / Edit modal ----------------
const formModal = document.getElementById('formModal');
const loadForm = document.getElementById('loadForm');
const formError = document.getElementById('formError');

function openAddModal(prefilledDate) {
  editingId = null;
  document.getElementById('formModalTitle').textContent = "Yangi yuk qo'shish";
  loadForm.reset();
  populateCategories('');
  populateColors('');
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  matrasRow.style.display = 'none';
  matrasBorCheck.checked = false;
  matrasTuriWrap.style.display = 'none';
  document.getElementById('f_sana').value = prefilledDate || toISO(new Date());
  document.getElementById('addCodeRow').style.display = '';
  document.getElementById('editCodeRow').style.display = 'none';
  formError.textContent = '';
  formModal.classList.remove('hidden');
}

function openEditModal(l) {
  editingId = l.id;
  document.getElementById('formModalTitle').textContent = 'Yukni tahrirlash';
  populateCategories(l.kategoriya?.id || '');
  nomiInput.value = l.nomi || '';
  populateColors(l.rang?.id || '');
  populateZborshiklar(zborshikSelect, l.zborshik?.id || '');
  populateLabolar(laboSelect, l.labo?.id || '');

  toggleMatrasRow();
  if (l.matras?.bor) {
    matrasBorCheck.checked = true;
    matrasTuriWrap.style.display = '';
    matrasTuriSelect.value = l.matras.turi || '';
  } else {
    matrasBorCheck.checked = false;
    matrasTuriWrap.style.display = 'none';
  }

  document.getElementById('f_izoh').value = l.izoh || '';
  document.getElementById('f_sana').value = l.sana || '';
  document.getElementById('f_holat').value = l.holat || 'qizil';
  document.getElementById('f_hudud').value = l.manzil?.hudud || '';
  document.getElementById('f_dom').value = l.manzil?.dom || '';
  document.getElementById('f_padyez').value = l.manzil?.padyez || '';
  document.getElementById('f_etaj').value = l.manzil?.etaj || '';
  document.getElementById('f_astatka').value = l.astatka || '';
  document.getElementById('f_tel1').value = l.tel1 || '';
  document.getElementById('f_tel2').value = l.tel2 || '';
  document.getElementById('addCodeRow').style.display = 'none';
  document.getElementById('editCodeRow').style.display = '';
  document.getElementById('f_pin_edit').value = '';
  formError.textContent = '';
  closeModals();
  formModal.classList.remove('hidden');
}

function closeModals() {
  formModal.classList.add('hidden');
  document.getElementById('viewModal').classList.add('hidden');
  document.getElementById('reportModal').classList.add('hidden');
  document.getElementById('teamModal').classList.add('hidden');
}

document.querySelectorAll('.close-modal').forEach((btn) => btn.addEventListener('click', closeModals));
formModal.addEventListener('click', (e) => { if (e.target === formModal) closeModals(); });
document.getElementById('viewModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('viewModal')) closeModals();
});
document.getElementById('reportModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('reportModal')) closeModals();
});
document.getElementById('teamModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('teamModal')) closeModals();
});

document.getElementById('addLoadTopBtn').onclick = () => openAddModal(toISO(new Date()));

loadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  if (!catSelect.value || catSelect.value === NEW_OPTION) { formError.textContent = 'Kategoriyani tanlang'; return; }
  if (!nomiInput.value.trim()) { formError.textContent = 'Nomini kiriting'; return; }
  if (!rangSelect.value || rangSelect.value === NEW_OPTION) { formError.textContent = 'Rangni tanlang'; return; }

  const manzil = {
    hudud: document.getElementById('f_hudud').value.trim(),
    dom: document.getElementById('f_dom').value.trim(),
    padyez: document.getElementById('f_padyez').value.trim(),
    etaj: document.getElementById('f_etaj').value.trim(),
  };
  const base = {
    kategoriyaId: catSelect.value,
    nomi: nomiInput.value.trim(),
    rangId: rangSelect.value,
    matras: { bor: matrasBorCheck.checked, turi: matrasBorCheck.checked ? matrasTuriSelect.value : null },
    zborshikId: zborshikSelect.value || null,
    laboId: laboSelect.value || null,
    izoh: document.getElementById('f_izoh').value.trim(),
    sana: document.getElementById('f_sana').value,
    holat: document.getElementById('f_holat').value,
    manzil,
    astatka: document.getElementById('f_astatka').value,
    tel1: document.getElementById('f_tel1').value.trim(),
    tel2: document.getElementById('f_tel2').value.trim(),
  };

  try {
    if (editingId) {
      const pin = document.getElementById('f_pin_edit').value.trim();
      await updateLoad(editingId, { ...base, pin });
      showToast('Yuk yangilandi ✓');
    } else {
      const adminCode = document.getElementById('f_adminCode').value.trim();
      const pin = document.getElementById('f_pin_new').value.trim();
      await createLoad({ ...base, adminCode, pin });
      showToast("Yuk qo'shildi ✓");
    }
    closeModals();
    await refresh();
  } catch (err) {
    formError.textContent = err.message;
  }
});

// ---------------- View modal ----------------
const viewModal = document.getElementById('viewModal');
const quickZborshikSelect = document.getElementById('quickZborshik');
const quickLaboSelect = document.getElementById('quickLabo');

function openViewModal(l) {
  viewingLoad = l;
  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');
  document.getElementById('viewTitle').textContent = title || 'Yuk';
  const addrLine = [l.manzil?.hudud].filter(Boolean).join(', ') || '—';
  const domLine = [
    l.manzil?.dom ? `dom ${l.manzil.dom}` : '',
    l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '',
    l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '',
  ].filter(Boolean).join(' · ') || '—';

  document.getElementById('viewBody').innerHTML = `
    <div class="view-row"><span class="k">Holat</span><span class="v"><span class="status-pill"><span class="dot ${l.holat}"></span>${HOLAT_LABEL[l.holat] || l.holat}</span></span></div>
    <div class="view-row"><span class="k">To'lov</span><span class="v">${l.tolandi ? `<span class="status-pill"><span class="dot tolandi"></span>To'landi (${l.tolanganSana}) — ${fmtMoney(l.tolanganSumma)} so'm</span>` : `<span class="status-pill"><span class="dot kutilmoqda"></span>Kutilmoqda</span>`}</span></div>
    <div class="view-row"><span class="k">Kategoriya</span><span class="v">${escapeHtml(l.kategoriya?.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">Nomi</span><span class="v">${escapeHtml(l.nomi || '—')}</span></div>
    <div class="view-row"><span class="k">Rang</span><span class="v">${escapeHtml(l.rang?.nomi || '—')}</span></div>
    ${l.matras?.bor ? `<div class="view-row"><span class="k">Matras</span><span class="v">${escapeHtml(l.matras.turi)}</span></div>` : ''}
    ${l.izoh ? `<div class="view-row"><span class="k">Izoh</span><span class="v">${escapeHtml(l.izoh)}</span></div>` : ''}
    <div class="view-row"><span class="k">Jo'natish sanasi</span><span class="v">${l.sana}</span></div>
    <div class="view-row"><span class="k">Hudud</span><span class="v">${escapeHtml(addrLine)}</span></div>
    <div class="view-row"><span class="k">Dom / padyez / etaj</span><span class="v">${escapeHtml(domLine)}</span></div>
    <div class="view-row"><span class="k">Astatka (qoldiq)</span><span class="v mono">${fmtMoney(l.astatka)} so'm</span></div>
    <div class="view-row"><span class="k">1-telefon</span><span class="v mono">${escapeHtml(l.tel1 || '—')}</span></div>
    <div class="view-row"><span class="k">2-telefon</span><span class="v mono">${escapeHtml(l.tel2 || '—')}</span></div>
  `;

  populateZborshiklar(quickZborshikSelect, l.zborshik?.id || '');
  populateLabolar(quickLaboSelect, l.labo?.id || '');

  document.getElementById('payLoadBtn').style.display = l.tolandi ? 'none' : '';
  formModal.classList.add('hidden');
  viewModal.classList.remove('hidden');
}

quickZborshikSelect.addEventListener('change', async () => {
  if (quickZborshikSelect.value === NEW_OPTION) {
    const ism = prompt('Yangi zborshik ismi:');
    if (!ism || !ism.trim()) { quickZborshikSelect.value = viewingLoad?.zborshik?.id || ''; return; }
    const telefon = prompt('Zborshikning telefon raqami:') || '';
    try {
      const z = await addZborshik(ism.trim(), telefon.trim());
      await fetchZborshiklar();
      populateZborshiklar(quickZborshikSelect, z.id);
    } catch (err) {
      showToast(err.message, true);
    }
  }
});
quickLaboSelect.addEventListener('change', async () => {
  if (quickLaboSelect.value === NEW_OPTION) {
    const raqami = prompt('Labo (mashina) raqami:');
    if (!raqami || !raqami.trim()) { quickLaboSelect.value = viewingLoad?.labo?.id || ''; return; }
    const haydovchi = prompt('Haydovchi ismi:') || '';
    const telefon = prompt('Haydovchi telefon raqami:') || '';
    try {
      const l = await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
      await fetchLabolar();
      populateLabolar(quickLaboSelect, l.id);
    } catch (err) {
      showToast(err.message, true);
    }
  }
});

document.getElementById('quickZborshikSave').onclick = async () => {
  if (!viewingLoad) return;
  if (!quickZborshikSelect.value || quickZborshikSelect.value === NEW_OPTION) { showToast("Zborshikni tanlang", true); return; }
  try {
    const updated = await assignLoad(viewingLoad.id, { zborshikId: quickZborshikSelect.value });
    viewingLoad = updated;
    showToast("Zborshik almashtirildi ✓");
    await refresh();
    openViewModal(updated);
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('quickLaboSave').onclick = async () => {
  if (!viewingLoad) return;
  if (!quickLaboSelect.value || quickLaboSelect.value === NEW_OPTION) { showToast('Laboni tanlang', true); return; }
  try {
    const updated = await assignLoad(viewingLoad.id, { laboId: quickLaboSelect.value });
    viewingLoad = updated;
    showToast('Labo almashtirildi ✓');
    await refresh();
    openViewModal(updated);
  } catch (err) {
    showToast(err.message, true);
  }
};

// Holatni PIN'siz, bitta tugma bosish bilan almashtirish
document.querySelectorAll('.status-quick-btn').forEach((btn) => {
  btn.onclick = async () => {
    if (!viewingLoad) return;
    try {
      const updated = await assignLoad(viewingLoad.id, { holat: btn.dataset.holat });
      viewingLoad = updated;
      showToast(`Holat "${HOLAT_LABEL[btn.dataset.holat]}" ga almashtirildi ✓`);
      await refresh();
      openViewModal(updated);
    } catch (err) {
      showToast(err.message, true);
    }
  };
});

// Bitta buyurtmani chop etish (Ctrl+P) — faqat shu buyurtmaning o'zi chiqadi
document.getElementById('printLoadBtn').onclick = () => {
  if (!viewingLoad) return;
  const l = viewingLoad;
  const addrLine = [l.manzil?.hudud].filter(Boolean).join(', ') || '—';
  const domLine = [
    l.manzil?.dom ? `dom ${l.manzil.dom}` : '',
    l.manzil?.padyez ? `${l.manzil.padyez}-padyez` : '',
    l.manzil?.etaj ? `${l.manzil.etaj}-etaj` : '',
  ].filter(Boolean).join(' · ') || '—';
  const title = [l.nomi, l.rang?.nomi].filter(Boolean).join(' — ');

  document.getElementById('printArea').innerHTML = `
    <h1>${escapeHtml(title || 'Yuk')}</h1>
    <table class="print-table">
      <tr><td>Holat</td><td>${HOLAT_LABEL[l.holat] || l.holat}</td></tr>
      <tr><td>Kategoriya</td><td>${escapeHtml(l.kategoriya?.nomi || '—')}</td></tr>
      <tr><td>Rang</td><td>${escapeHtml(l.rang?.nomi || '—')}</td></tr>
      ${l.matras?.bor ? `<tr><td>Matras</td><td>${escapeHtml(l.matras.turi)}</td></tr>` : ''}
      ${l.izoh ? `<tr><td>Izoh</td><td>${escapeHtml(l.izoh)}</td></tr>` : ''}
      <tr><td>Jo'natish sanasi</td><td>${l.sana}</td></tr>
      <tr><td>Hudud</td><td>${escapeHtml(addrLine)}</td></tr>
      <tr><td>Dom / padyez / etaj</td><td>${escapeHtml(domLine)}</td></tr>
      <tr><td>Astatka (qoldiq)</td><td>${fmtMoney(l.astatka)} so'm</td></tr>
      <tr><td>1-telefon</td><td>${escapeHtml(l.tel1 || '—')}</td></tr>
      <tr><td>2-telefon</td><td>${escapeHtml(l.tel2 || '—')}</td></tr>
      ${l.zborshik ? `<tr><td>Zborshik</td><td>${escapeHtml(l.zborshik.ism)} — ${escapeHtml(l.zborshik.telefon || '')}</td></tr>` : ''}
      ${l.labo ? `<tr><td>Labo</td><td>${escapeHtml(l.labo.raqami)} (${escapeHtml(l.labo.haydovchi)}) — ${escapeHtml(l.labo.telefon || '')}</td></tr>` : ''}
    </table>
  `;
  window.print();
};

document.getElementById('editLoadBtn').onclick = () => { if (viewingLoad) openEditModal(viewingLoad); };

document.getElementById('deleteLoadBtn').onclick = async () => {
  if (!viewingLoad) return;
  const code = prompt("Yukni o'chirish uchun kodni kiriting:");
  if (code === null) return;
  try {
    await deleteLoad(viewingLoad.id, code.trim());
    showToast("Yuk o'chirildi");
    closeModals();
    await refresh();
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('payLoadBtn').onclick = async () => {
  if (!viewingLoad) return;
  const code = prompt("To'lov qabul qilindi — tasdiqlash kodini kiriting:");
  if (code === null) return;
  try {
    const res = await fetch(`/api/loads/${viewingLoad.id}/pay`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentCode: code.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Xatolik');
    showToast(`💰 Pul olindi: ${fmtMoney(data.tolanganSumma)} so'm`);
    closeModals();
    await refresh();
  } catch (err) {
    showToast(err.message, true);
  }
};

// ---------------- Jamoa (Zborshik / Labo) — tashqi boshqaruv, kodsiz ----------------
const teamModal = document.getElementById('teamModal');

function renderTeamModal() {
  // Ranglar: kategoriya tanlansa, o'sha kategoriyaning ranglari ko'rsatiladi
  const catSel = document.getElementById('teamColorCatSelect');
  catSel.innerHTML = taxonomy.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (!catSel.value && taxonomy.categories.length) catSel.value = taxonomy.categories[0].id;
  renderTeamColorList();

  const zbList = document.getElementById('teamZborshikList');
  zbList.innerHTML = zborshiklar.length
    ? zborshiklar.map((z) => `<div class="team-item"><b>${escapeHtml(z.ism)}</b>${z.telefon ? ` <span class="muted">${escapeHtml(z.telefon)}</span>` : ''}</div>`).join('')
    : `<div class="empty-day">Hali zborshik qo'shilmagan</div>`;

  const lbList = document.getElementById('teamLaboList');
  lbList.innerHTML = labolar.length
    ? labolar.map((l) => `<div class="team-item"><b>${escapeHtml(l.raqami)}</b> — ${escapeHtml(l.haydovchi)}${l.telefon ? ` <span class="muted">${escapeHtml(l.telefon)}</span>` : ''}</div>`).join('')
    : `<div class="empty-day">Hali labo qo'shilmagan</div>`;

  teamModal.classList.remove('hidden');
}

function renderTeamColorList() {
  const catSel = document.getElementById('teamColorCatSelect');
  const cat = taxonomy.categories.find((c) => c.id === catSel.value);
  const list = document.getElementById('teamColorList');
  list.innerHTML = (cat && cat.colors.length)
    ? cat.colors.map((c) => `<div class="team-item"><b>${escapeHtml(c.name)}</b></div>`).join('')
    : `<div class="empty-day">Bu kategoriyada hali rang yo'q</div>`;
}

document.getElementById('teamColorCatSelect').addEventListener('change', renderTeamColorList);

document.getElementById('teamAddColorBtn').onclick = async () => {
  const catSel = document.getElementById('teamColorCatSelect');
  if (!catSel.value) { showToast("Avval kategoriya tanlang", true); return; }
  const name = prompt('Yangi rang nomi:');
  if (!name || !name.trim()) return;
  try {
    await addColor(catSel.value, name.trim());
    await fetchTaxonomy();
    renderTeamColorList();
    showToast(`✅ "${name.trim()}" rangi qo'shildi`);
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('teamBtn').onclick = renderTeamModal;

document.getElementById('teamAddZborshikBtn').onclick = async () => {
  const ism = prompt('Zborshik ismi:');
  if (!ism || !ism.trim()) return;
  const telefon = prompt('Telefon raqami:') || '';
  try {
    await addZborshik(ism.trim(), telefon.trim());
    await fetchZborshiklar();
    renderTeamModal();
    showToast("Zborshik qo'shildi ✓");
  } catch (err) {
    showToast(err.message, true);
  }
};

document.getElementById('teamAddLaboBtn').onclick = async () => {
  const raqami = prompt('Labo (mashina) raqami:');
  if (!raqami || !raqami.trim()) return;
  const haydovchi = prompt('Haydovchi ismi:') || '';
  const telefon = prompt('Haydovchi telefon raqami:') || '';
  try {
    await addLabo(raqami.trim(), haydovchi.trim(), telefon.trim());
    await fetchLabolar();
    renderTeamModal();
    showToast('Labo qo\'shildi ✓');
  } catch (err) {
    showToast(err.message, true);
  }
};

// ---------------- Toast ----------------
let toastTimer = null;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ---------------- Hisobot: astatka / kassa + zborshik / labo hikoya shaklida (7 kunlik) ----------------
function reportRangeDates() {
  const arr = [];
  for (let i = 0; i < REPORT_DAYS; i++) arr.push(toISO(addDays(currentStart, i)));
  return arr;
}

function computeMoneyReport() {
  const rangeDates = reportRangeDates();
  const days = rangeDates.map((iso) => {
    const date = new Date(iso);
    const ordersForDay = loads.filter((l) => l.sana === iso);
    const astatkaKutilmoqda = ordersForDay.filter((l) => !l.tolandi).reduce((s, l) => s + Number(l.astatka || 0), 0);
    const kassa = loads.filter((l) => l.tolandi && l.tolanganSana === iso).reduce((s, l) => s + Number(l.tolanganSumma || 0), 0);
    return { iso, dayName: DAY_NAMES_BY_DOW[date.getDay()], soni: ordersForDay.length, astatkaKutilmoqda, kassa };
  });
  const umumiy = days.reduce((acc, d) => ({
    astatkaKutilmoqda: acc.astatkaKutilmoqda + d.astatkaKutilmoqda,
    kassa: acc.kassa + d.kassa,
    soni: acc.soni + d.soni,
  }), { astatkaKutilmoqda: 0, kassa: 0, soni: 0 });
  return { days, umumiy };
}

// Har bir zborshik/labo bo'yicha, kunlar kesimida qaysi zakazlar (nomlari) berilganini yig'ish
function computePeopleReport(getKey, getMeta) {
  const rangeDates = reportRangeDates();
  const map = new Map();
  loads.forEach((l) => {
    const key = getKey(l);
    if (!key || !rangeDates.includes(l.sana)) return;
    if (!map.has(key)) map.set(key, { meta: getMeta(l), perDayNames: {}, jami: 0 });
    const rec = map.get(key);
    if (!rec.perDayNames[l.sana]) rec.perDayNames[l.sana] = [];
    rec.perDayNames[l.sana].push(l.nomi || 'nomsiz');
    rec.jami += 1;
  });
  return { rangeDates, rows: Array.from(map.values()) };
}

function renderPeopleNarrative(report, icon, emptyText) {
  if (!report.rows.length) return `<div class="empty-day">${emptyText}</div>`;
  return report.rows.map((r) => {
    const dayLines = report.rangeDates
      .filter((iso) => r.perDayNames[iso])
      .map((iso) => {
        const names = r.perDayNames[iso];
        return `<div class="report-day-line"><b>${fmtShort(new Date(iso))}:</b> ${escapeHtml(names.join(', '))} <span class="muted">(${names.length} ta)</span></div>`;
      }).join('');
    return `
      <div class="report-person">
        <div class="report-person-head">${icon} ${escapeHtml(r.meta)} — jami ${r.jami} ta zakaz</div>
        <div class="report-person-days">${dayLines}</div>
      </div>
    `;
  }).join('');
}

function renderReport() {
  const { days, umumiy } = computeMoneyReport();
  const moneyRows = days.map((d) => `
    <tr>
      <td>${d.dayName}<br><span class="muted">${fmtShort(new Date(d.iso))}</span></td>
      <td class="mono">${d.soni}</td>
      <td class="mono">${fmtMoney(d.astatkaKutilmoqda)}</td>
      <td class="mono">${fmtMoney(d.kassa)}</td>
    </tr>
  `).join('');

  const zb = computePeopleReport((l) => l.zborshik?.id, (l) => `${l.zborshik.ism}${l.zborshik.telefon ? ' — ' + l.zborshik.telefon : ''}`);
  const lb = computePeopleReport((l) => l.labo?.id, (l) => `${l.labo.raqami} — ${l.labo.haydovchi}${l.labo.telefon ? ' — ' + l.labo.telefon : ''}`);

  document.getElementById('reportBody').innerHTML = `
    <h3 class="report-subhead">💰 Astatka / Kassa (7 kunlik)</h3>
    <table class="report-table">
      <thead><tr><th>Kun</th><th>Zakazlar</th><th>Kutilayotgan astatka</th><th>Kassa (pul olingan)</th></tr></thead>
      <tbody>${moneyRows}</tbody>
      <tfoot>
        <tr>
          <td>Umumiy (7 kun)</td>
          <td class="mono">${umumiy.soni}</td>
          <td class="mono">${fmtMoney(umumiy.astatkaKutilmoqda)}</td>
          <td class="mono">${fmtMoney(umumiy.kassa)}</td>
        </tr>
      </tfoot>
    </table>
    <p class="report-note">
      "Kutilayotgan astatka" — hali "pul olindi" deb belgilanmagan zakazlarning qoldiq summasi.
      "Kassa" — aynan shu kunda "💰 Pul olindi" tugmasi orqali qabul qilingan pul.
    </p>

    <h3 class="report-subhead">🧰 Zborshiklar nima qildi (7 kunlik)</h3>
    ${renderPeopleNarrative(zb, '🧰', "Bu 7 kunda zborshik biriktirilgan zakaz yo'q")}

    <h3 class="report-subhead">🚚 Labo / haydovchilar nima tashidi (7 kunlik)</h3>
    ${renderPeopleNarrative(lb, '🚚', "Bu 7 kunda labo biriktirilgan zakaz yo'q")}
  `;
  document.getElementById('reportModal').classList.remove('hidden');
}

document.getElementById('reportBtn').onclick = renderReport;

// ---------------- Kun-kun surish ----------------
document.getElementById('prevWeek').onclick = () => { currentStart = addDays(currentStart, -1); renderWeekLabel(); renderBoard(); };
document.getElementById('nextWeek').onclick = () => { currentStart = addDays(currentStart, 1); renderWeekLabel(); renderBoard(); };
document.getElementById('todayBtn').onclick = () => { currentStart = startOfDay(new Date()); renderWeekLabel(); renderBoard(); };

// ---------------- Boot ----------------
async function refresh() { await fetchLoads(); renderWeekLabel(); renderBoard(); }
async function boot() {
  await fetchTaxonomy();
  await fetchZborshiklar();
  await fetchLabolar();
  populateCategories('');
  populateColors('');
  populateZborshiklar(zborshikSelect, '');
  populateLabolar(laboSelect, '');
  await refresh();
}
boot().catch(() => showToast('Serverga ulanishda xatolik', true));
