// ============================================================
//  script.js — IEG 16ª GRE  |  com sincronização Firebase
// ============================================================

const STORAGE_KEY    = "ieg16gre_schools_v1";
const ADMIN_PASSWORD = "adm123";
const FB_DOC_PATH    = { collection: "ieg16gre", document: "schools" };

// ── Estado ──────────────────────────────────────────────────
let storageEnabled = true;
let schools        = [];
let currentSchoolId = null;
let activeProfile   = "usuario";
let adminUnlocked   = false;
let cloudAvailable  = false;   // true quando Firebase estiver pronto
let isSyncing       = false;   // evita loop de escrita

// ── Metadados dos indicadores ────────────────────────────────
const indicatorMeta = [
  { id: "ind1" }, { id: "ind2" }, { id: "ind15" }, { id: "ind16" },
  { id: "ind17" }, { id: "ind18" }, { id: "ind19" },
];

const indicatorImportRules = {
  ind1:  { number: 1,  aliases: ["frequência escolar", "frequência"] },
  ind2:  { number: 2,  aliases: ["evasão escolar", "rota de evasão", "evasão"] },
  ind15: { number: 15, aliases: ["língua portuguesa", "portuguesa"] },
  ind16: { number: 16, aliases: ["matemática"] },
  ind17: { number: 17, aliases: ["linguagens"] },
  ind18: { number: 18, aliases: ["c. da natureza", "ciências da natureza", "natureza"] },
  ind19: { number: 19, aliases: ["c. humanas", "ciências humanas", "humanas"] },
};

// ── Elementos DOM ────────────────────────────────────────────
const profileButtons    = document.querySelectorAll(".profile-btn");
const adminControls     = document.querySelector("#admin-controls");
const userControls      = document.querySelector("#user-controls");
const spreadsheetUpload = document.querySelector("#spreadsheet-upload");
const importStatus      = document.querySelector("#import-status");
const citySelect        = document.querySelector("#city-select");
const schoolSelect      = document.querySelector("#school-select");
const reportDateInput   = document.querySelector("#report-date-input");
const notesInput        = document.querySelector("#notes-input");
const saveMetaBtn       = document.querySelector("#save-meta-btn");
const printBtn          = document.querySelector("#print-btn");
const printAdmBtn       = document.querySelector("#print-adm-btn");
const resetDataBtn      = document.querySelector("#reset-data-btn");
const reportSchool      = document.querySelector("#report-school");
const reportPeriod      = document.querySelector("#report-period");
const reportNotes       = document.querySelector("#report-notes");
const overallScore      = document.querySelector("#ieg-score");
const cloudLabel        = document.querySelector("#cloud-label");
const cloudStatus       = document.querySelector("#cloud-status");

// ── Indicador de nuvem ───────────────────────────────────────
function setCloudStatus(state, text) {
  // state: "connecting" | "online" | "offline" | "syncing" | "error"
  if (!cloudStatus) return;
  cloudStatus.className = `cloud-status cloud-${state}`;
  if (cloudLabel) cloudLabel.textContent = text;
}

// ── Callback chamado pelo módulo Firebase no index.html ──────
window.__cloudReady = function ({ error }) {
  if (error === "config_missing") {
    setCloudStatus("offline", "Modo local (sem nuvem)");
    cloudAvailable = false;
    initApp();
    return;
  }

  if (error) {
    setCloudStatus("error", "Erro na conexão");
    cloudAvailable = false;
    initApp();
    return;
  }

  // Firebase conectado — inicia listener em tempo real
  cloudAvailable = true;
  setCloudStatus("online", "Conectado à nuvem");

  const db       = window.__db;
  const fbDoc    = window.__fbDoc;
  const snapshot = window.__fbSnapshot;

  const ref = fbDoc(db, FB_DOC_PATH.collection, FB_DOC_PATH.document);

  snapshot(ref, (snap) => {
    if (isSyncing) return; // evita reprocessar a própria escrita
    if (snap.exists()) {
      try {
        schools = JSON.parse(snap.data().jsonData || "[]");
        // Sincroniza localStorage como cache offline
        safeLocalSet(schools);
      } catch {
        schools = [];
      }
    } else {
      schools = [];
    }
    renderSchoolSelect();
    setCloudStatus("online", "Conectado à nuvem");
  }, (err) => {
    console.error("Listener Firestore:", err);
    setCloudStatus("error", "Erro na sincronização");
  });

  initApp();
};

// ── localStorage (cache / fallback offline) ──────────────────
function safeLocalSet(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); storageEnabled = true; }
  catch { storageEnabled = false; }
}

function safeLocalGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    storageEnabled = true;
    return raw ? JSON.parse(raw) : [];
  } catch { storageEnabled = false; return []; }
}

// ── Persistência principal ───────────────────────────────────
async function saveSchools() {
  safeLocalSet(schools); // sempre salva localmente como cache

  if (!cloudAvailable) return;

  isSyncing = true;
  setCloudStatus("syncing", "Salvando na nuvem...");
  try {
    const db      = window.__db;
    const fbDoc   = window.__fbDoc;
    const fbSet   = window.__fbSetDoc;
    const ref     = fbDoc(db, FB_DOC_PATH.collection, FB_DOC_PATH.document);
    await fbSet(ref, { jsonData: JSON.stringify(schools), updatedAt: new Date().toISOString() });
    setCloudStatus("online", "Conectado à nuvem");
  } catch (e) {
    console.error("Firestore write:", e);
    setCloudStatus("error", "Falha ao salvar na nuvem");
  } finally {
    isSyncing = false;
  }
}

// ── Inicialização da UI ──────────────────────────────────────
function initApp() {
  // Carrega cache local enquanto nuvem não responde (ou se offline)
  if (!cloudAvailable) {
    schools = safeLocalGet();
  }
  setActiveProfile("usuario");
  renderSchoolSelect();
  fillMetaInputs();
}

// ── Utilitários ──────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

function parseLocaleNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let s = raw.replace(/\s/g, "").replace(/%/g, "");
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const num = Number(s);
  return Number.isNaN(num) ? null : num;
}

function getSelectedSchool() {
  return schools.find((s) => s.id === currentSchoolId) || null;
}

function createDefaultIndicators() {
  const result = {};
  indicatorMeta.forEach((m) => { result[m.id] = ""; });
  return result;
}

// ── Import de planilha ───────────────────────────────────────
function extractField(row, candidates) {
  for (const key of Object.keys(row)) {
    const nk = normalizeText(key);
    if (candidates.some((c) => nk.includes(c))) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function isScoreColumn(nk) {
  return nk.includes("pontu") || nk.includes("ponto") || nk.includes("score");
}

function hasIndicatorNumber(nk, number) {
  const pat = new RegExp(`(^|\\D)${number}(\\D|$)`);
  if (!pat.test(nk)) return false;
  if (nk.includes("ind") || nk.includes("indicador")) return true;
  return nk.startsWith(String(number));
}

function headerMatchesIndicator(nk, indicatorId) {
  const rule = indicatorImportRules[indicatorId];
  if (!rule) return false;
  if (hasIndicatorNumber(nk, rule.number)) return true;
  return rule.aliases.some((a) => nk.includes(a));
}

function extractIndicatorValue(row, indicatorId) {
  for (const key of Object.keys(row)) {
    const nk = normalizeText(key);
    if (!headerMatchesIndicator(nk, indicatorId)) continue;
    if (isScoreColumn(nk)) continue;
    const num = parseLocaleNumber(row[key]);
    if (num !== null) return String(num);
  }
  return "";
}

function mergeImportedSchools(imported) {
  let created = 0, updated = 0;
  imported.forEach((item) => {
    const existing = schools.find(
      (s) => normalizeText(s.name) === normalizeText(item.name) &&
             normalizeText(s.city) === normalizeText(item.city)
    );
    if (existing) {
      existing.period     = item.period     || existing.period     || "";
      existing.reportDate = item.reportDate || existing.reportDate || "";
      existing.schoolIeg  = item.schoolIeg  ?? existing.schoolIeg  ?? "";
      existing.notes      = item.notes      || existing.notes      || "";
      existing.indicators = { ...existing.indicators, ...item.indicators };
      updated++;
    } else {
      schools.push({ id: uid(), ...item });
      created++;
    }
  });
  return { created, updated };
}

function parseRowsToSchools(rows) {
  return rows.reduce((acc, row) => {
    const name = extractField(row, ["nome da escola", "nome escola", "escola"]);
    if (!name) return acc;
    const city      = extractField(row, ["cidade", "municipio"]) || "Nao informado";
    const period    = extractField(row, ["periodo", "referencia", "mes"]);
    const schoolIeg = extractField(row, ["ieg"]);
    const notes     = extractField(row, ["observação", "observações", "obs"]);
    const indicators = createDefaultIndicators();
    indicatorMeta.forEach((m) => { indicators[m.id] = extractIndicatorValue(row, m.id); });
    acc.push({ name, city, period, schoolIeg, notes, indicators });
    return acc;
  }, []);
}

function setImportStatus(text, isError = false) {
  importStatus.textContent = text;
  importStatus.style.color = isError ? "#b02f24" : "#1f4e32";
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Falha ao ler arquivo."));
    r.readAsArrayBuffer(file);
  });
}

async function importSpreadsheet(file) {
  if (!adminUnlocked) {
    setImportStatus("Acesso negado. Desbloqueie o perfil ADM para importar.", true);
    return;
  }
  if (!file) return;
  try {
    setImportStatus("Importando planilha...");
    if (!window.XLSX) {
      setImportStatus("Não foi possível carregar o leitor de Excel.", true);
      return;
    }
    const buffer  = await readFileAsArrayBuffer(file);
    const wb      = XLSX.read(buffer, { type: "array" });
    const rows    = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });

    if (!rows.length) {
      setImportStatus("A planilha esta vazia ou sem cabecalho reconhecivel.", true);
      return;
    }
    const imported = parseRowsToSchools(rows);
    if (!imported.length) {
      setImportStatus("Nenhuma escola valida encontrada. Verifique os nomes das colunas.", true);
      return;
    }
    const { created, updated } = mergeImportedSchools(imported);
    await saveSchools();
    citySelect.value = "";
    renderSchoolSelect();
    const dest = cloudAvailable ? "na nuvem" : "localmente";
    setImportStatus(`Importacao concluida ${dest}: ${created} criada(s), ${updated} atualizada(s).`);
  } catch (e) {
    console.error(e);
    setImportStatus("Erro ao importar planilha. Verifique o arquivo e tente novamente.", true);
  } finally {
    spreadsheetUpload.value = "";
  }
}

// ── Pontuação e visual ───────────────────────────────────────
function capPercent(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
}

function pointsForIndicator(indicatorId, percentValue) {
  const p = capPercent(percentValue);
  if (indicatorId === "ind1") {
    return p < 90 ? 0 : p <= 94 ? 1.5 : 3;
  }
  if (indicatorId === "ind2") {
    return p > 1 ? 0 : (p >= 0.7 && p <= 1) ? 1.5 : 3;
  }
  if (["ind15","ind16","ind17","ind18","ind19"].includes(indicatorId)) {
    return p < 90 ? 0 : p <= 95 ? 1.5 : 3;
  }
  return 0;
}

function updateIndicatorVisual(indicatorId, value) {
  const percent = capPercent(value);
  const points  = pointsForIndicator(indicatorId, percent);
  const bar     = document.querySelector(`[data-bar="${indicatorId}"]`);
  const valNode = document.querySelector(`[data-value="${indicatorId}"]`);
  const ptsNode = document.querySelector(`[data-points="${indicatorId}"]`);
  const gauge   = ptsNode?.closest(".score-gauge");
  if (bar)     bar.style.width       = `${percent}%`;
  if (valNode) valNode.textContent   = `${percent.toFixed(0)}%`;
  if (ptsNode) ptsNode.textContent   = points.toFixed(1);
  if (gauge) {
    gauge.classList.remove("is-green", "is-yellow", "is-red");
    gauge.classList.add(points >= 3 ? "is-green" : points >= 1.5 ? "is-yellow" : "is-red");
  }
  return points;
}

// ── Renderização ─────────────────────────────────────────────
function renderReport() {
  const school = getSelectedSchool();
  if (!school) {
    reportSchool.textContent = "Nenhuma escola selecionada";
    reportPeriod.textContent = "Período não informado";
    reportNotes.textContent  = "Sem observações.";
    overallScore.textContent = "0.0";
    indicatorMeta.forEach((m) => updateIndicatorVisual(m.id, 0));
    return;
  }
  reportSchool.textContent = school.name;
  const periodText = school.reportDate || school.period;
  reportPeriod.textContent = periodText
    ? `Data/Período: ${periodText} | Cidade: ${school.city}`
    : `Cidade: ${school.city}`;
  reportNotes.textContent = school.notes?.trim() || "Sem observações.";
  let sum = 0;
  indicatorMeta.forEach((m) => { sum += updateIndicatorVisual(m.id, school.indicators[m.id]); });
  const iegManual = Number(school.schoolIeg);
  overallScore.textContent = !Number.isNaN(iegManual)
    ? Math.max(0, iegManual).toFixed(1)
    : (sum / indicatorMeta.length).toFixed(1);
}

function fillMetaInputs() {
  const school = getSelectedSchool();
  reportDateInput.value = school?.reportDate || "";
  notesInput.value      = school?.notes      || "";
}

async function saveReportMeta() {
  const school = getSelectedSchool();
  if (!school) { alert("Selecione uma escola antes de salvar."); return; }
  school.reportDate = reportDateInput.value || "";
  school.notes      = notesInput.value      || "";
  await saveSchools();
  renderReport();
}

function renderCitySelect() {
  const cur    = citySelect.value;
  const cities = [...new Set(schools.map((s) => String(s.city || "").trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,"pt-BR"));
  citySelect.innerHTML = `<option value="">Todas as cidades</option>`;
  cities.forEach((c) => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c; citySelect.appendChild(o);
  });
  citySelect.value = cities.includes(cur) ? cur : "";
}

function renderSchoolSelect() {
  renderCitySelect();
  const selCity   = normalizeText(citySelect.value);
  const visible   = schools.filter((s) => !selCity || normalizeText(s.city) === selCity);
  schoolSelect.innerHTML = "";
  if (!visible.length) {
    schoolSelect.innerHTML = `<option value="">Nenhuma escola encontrada</option>`;
    currentSchoolId = null;
    fillMetaInputs(); renderReport(); return;
  }
  visible.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = `${s.name} - ${s.city}`; schoolSelect.appendChild(o);
  });
  if (!visible.some((s) => s.id === currentSchoolId)) currentSchoolId = visible[0].id;
  schoolSelect.value = currentSchoolId;
  fillMetaInputs(); renderReport();
}

// ── Impressão via html2canvas ────────────────────────────────
function buildPrintDoc(imageDataUrl) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório IEG</title>
<style>
  html,body{margin:0;padding:0;background:#fff;}
  #page{width:186mm;height:265mm;margin:0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;}
  #page img{max-width:100%;max-height:100%;object-fit:contain;display:block;}
  @page{size:A4 portrait;margin:4mm;}
</style></head><body><div id="page"><img src="${imageDataUrl}" alt="Relatório IEG"></div></body></html>`;
}

async function printReport() {
  if (!getSelectedSchool()) { alert("Selecione uma escola antes de imprimir."); return; }
  if (!window.html2canvas)  { alert("Falha ao carregar módulo de impressão. Recarregue a página."); return; }
  const node = document.querySelector("#report");
  try {
    const canvas = await window.html2canvas(node, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      windowWidth: node.scrollWidth, windowHeight: node.scrollHeight,
    });
    const html = buildPrintDoc(canvas.toDataURL("image/png"));
    let frame = document.querySelector("#print-frame");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "print-frame";
      Object.assign(frame.style, { position:"fixed", right:"0", bottom:"0", width:"0", height:"0", border:"0" });
      frame.setAttribute("aria-hidden", "true");
      document.body.appendChild(frame);
    }
    frame.onload = () => setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 80);
    frame.srcdoc = html;
  } catch {
    alert("Não foi possível gerar a impressão. Tente novamente.");
  }
}

// ── Perfis ───────────────────────────────────────────────────
function setActiveProfile(profile) {
  activeProfile          = profile;
  const isAdm            = profile === "adm";
  adminControls.hidden   = !isAdm;
  userControls.hidden    = isAdm;
  profileButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.profile === profile));
}

function handleProfileSwitch(target) {
  if (target === "adm" && !adminUnlocked) {
    const typed = prompt("Digite a senha do perfil ADM:");
    if (typed === null) return;
    if (String(typed).trim() !== ADMIN_PASSWORD) {
      alert("Senha incorreta.");
      setActiveProfile("usuario");
      return;
    }
    adminUnlocked = true;
  }
  setActiveProfile(target);
}

async function resetAllSchoolData() {
  if (!adminUnlocked) { alert("Desbloqueie o perfil ADM para apagar os dados."); return; }
  if (!confirm("Tem certeza que deseja apagar TODAS as escolas e dados importados?")) return;
  schools         = [];
  currentSchoolId = null;
  await saveSchools();
  setImportStatus("Dados apagados com sucesso.");
  renderSchoolSelect();
  fillMetaInputs();
  renderReport();
}

// ── Event listeners ──────────────────────────────────────────
profileButtons.forEach((b) => b.addEventListener("click", () => handleProfileSwitch(b.dataset.profile)));
spreadsheetUpload.addEventListener("change", (e) => importSpreadsheet(e.target.files?.[0]));
citySelect.addEventListener("change", renderSchoolSelect);
schoolSelect.addEventListener("change", () => { currentSchoolId = schoolSelect.value || null; fillMetaInputs(); renderReport(); });
printBtn?.addEventListener("click", printReport);
printAdmBtn?.addEventListener("click", printReport);
saveMetaBtn?.addEventListener("click", saveReportMeta);
resetDataBtn?.addEventListener("click", resetAllSchoolData);

// ── Aguarda Firebase antes de inicializar ────────────────────
// Se o módulo Firebase demorar mais de 6s, inicia em modo local
const cloudTimeout = setTimeout(() => {
  if (!cloudAvailable) {
    setCloudStatus("offline", "Modo local (timeout)");
    window.__cloudReady({ error: "timeout" });
  }
}, 6000);

// Quando Firebase chamar __cloudReady, cancelamos o timeout
const originalCloudReady = window.__cloudReady;
window.__cloudReady = function (args) {
  clearTimeout(cloudTimeout);
  originalCloudReady(args);
};

setCloudStatus("connecting", "Conectando...");
