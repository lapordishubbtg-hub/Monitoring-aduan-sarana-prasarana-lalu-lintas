/* =====================================================
   MARINA - Frontend Portal
   Monitoring Aduan Rambu, Infrastruktur, dan Akses Jalan
===================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxMgWJuIrdmqzPq-9G5hqGPcQeqFqtlWryHwVsH_V3swprpdxqhbSlBlvkDjjSJB8Q2/exec";
const MAP_CENTER = [-5.5574, 119.9500];
const MAP_ZOOM = 11;
const MAX_FILE_SIZE_MB = 5;

let PUBLIC_REPORTS = [];
let ADMIN_REPORTS = [];
let reportMap = null;
let mainMap = null;
let adminMap = null;
let reportMarker = null;
let mainMarkers = null;
let adminMarkers = null;
let chartStatus = null;
let chartKategori = null;

function $(id) {
  return document.getElementById(id);
}

function val(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function setVal(id, value) {
  const el = $(id);
  if (el) el.value = value || "";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsArg(value) {
  return JSON.stringify(String(value ?? ""));
}

function showLoading() {
  $("loadingOverlay")?.classList.remove("hidden");
}

function hideLoading() {
  $("loadingOverlay")?.classList.add("hidden");
}

function showToast(message) {
  const toast = $("toast");
  const text = $("toastText");
  if (!toast || !text) return;
  text.textContent = message || "";
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 3600);
}

function isApiConfigured() {
  return API_URL && !API_URL.includes("PASTE_URL") && API_URL.startsWith("https://script.google.com/");
}

function buildApiError(result, fallback = "Permintaan gagal") {
  if (!result) return fallback;
  const message = result.message || fallback;
  const detail = result.detail ? ` - ${result.detail}` : "";
  return `${message}${detail}`;
}

async function parseApiResponse(response) {
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (error) {
    throw new Error(`Respons server bukan JSON valid: ${text.slice(0, 180)}`);
  }
  if (!response.ok) {
    throw new Error(buildApiError(result, "Server tidak merespons dengan benar"));
  }
  if (result.success === false) {
    throw new Error(buildApiError(result));
  }
  return result;
}

async function apiGet(action, params = {}) {
  if (!isApiConfigured()) {
    throw new Error("API_URL belum diisi. Masukkan URL Web App Apps Script pada script.js.");
  }
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`${API_URL}?${query.toString()}`, { method: "GET" });
  return parseApiResponse(response);
}

async function apiPost(payload = {}) {
  if (!isApiConfigured()) {
    throw new Error("API_URL belum diisi. Masukkan URL Web App Apps Script pada script.js.");
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse(response);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

/* =========================
   INIT
========================= */

window.addEventListener("load", async () => {
  bindEvents();
  initReportMap();
  initMainMap();
  await loadPublicData();
  cekAdminSession();
});

function bindEvents() {
  $("formAduan")?.addEventListener("submit", submitAduan);
  $("fotoAduan")?.addEventListener("change", previewFoto);
  $("formLoginAdmin")?.addEventListener("submit", loginAdmin);
  $("publicFilterStatus")?.addEventListener("change", renderPublicMap);
  $("publicFilterKategori")?.addEventListener("change", renderPublicMap);
  $("adminSearch")?.addEventListener("input", renderAdminTable);
  $("adminFilterStatus")?.addEventListener("change", renderAdminTable);
  $("adminFilterKategori")?.addEventListener("change", renderAdminTable);
  $("navToggle")?.addEventListener("click", () => $("navMenu")?.classList.toggle("show"));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAdminModal();
      closeDetailModal();
    }
  });

  $("adminModal")?.addEventListener("click", (event) => {
    if (event.target.id === "adminModal") closeAdminModal();
  });

  $("detailModal")?.addEventListener("click", (event) => {
    if (event.target.id === "detailModal") closeDetailModal();
  });
}

/* =========================
   MAPS
========================= */

function createTileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });
}

function initReportMap() {
  const el = $("reportMap");
  if (!el || typeof L === "undefined") return;

  reportMap = L.map(el, { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
  createTileLayer().addTo(reportMap);

  reportMap.on("click", (event) => {
    setReportLocation(event.latlng.lat, event.latlng.lng, true);
  });

  setTimeout(() => reportMap.invalidateSize(), 400);
}

function initMainMap() {
  const el = $("mainMap");
  if (!el || typeof L === "undefined") return;

  mainMap = L.map(el, { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
  createTileLayer().addTo(mainMap);
  mainMarkers = L.layerGroup().addTo(mainMap);

  setTimeout(() => mainMap.invalidateSize(), 400);
}

function initAdminMap() {
  const el = $("adminMap");
  if (!el || typeof L === "undefined") return;

  if (!adminMap) {
    adminMap = L.map(el, { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
    createTileLayer().addTo(adminMap);
    adminMarkers = L.layerGroup().addTo(adminMap);
  }

  setTimeout(() => {
    adminMap.invalidateSize();
    renderAdminMap();
  }, 300);
}

function markerColor(status) {
  const s = String(status || "").toLowerCase();
  if (s === "selesai") return "#16a34a";
  if (s === "diproses") return "#f59e0b";
  if (s === "diverifikasi") return "#2563eb";
  if (s === "ditolak") return "#64748b";
  return "#dc2626";
}

function createDivIcon(status) {
  const color = markerColor(status);
  return L.divIcon({
    className: "custom-marker",
    html: `<span style="background:${color}"><i class="fa-solid fa-location-dot"></i></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -30]
  });
}

function setReportLocation(lat, lng, moveMap = false) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showToast("Koordinat tidak valid");
    return;
  }

  setVal("latitudeAduan", latitude.toFixed(7));
  setVal("longitudeAduan", longitude.toFixed(7));

  if (reportMap) {
    if (reportMarker) {
      reportMarker.setLatLng([latitude, longitude]);
    } else {
      reportMarker = L.marker([latitude, longitude], { draggable: true }).addTo(reportMap);
      reportMarker.on("dragend", function () {
        const pos = reportMarker.getLatLng();
        setReportLocation(pos.lat, pos.lng, false);
      });
    }
    if (moveMap) reportMap.setView([latitude, longitude], 16);
  }
}

function clearReportLocation() {
  setVal("latitudeAduan", "");
  setVal("longitudeAduan", "");
  if (reportMarker && reportMap) {
    reportMap.removeLayer(reportMarker);
    reportMarker = null;
  }
}

function gunakanLokasiSaya() {
  if (!navigator.geolocation) {
    showToast("Browser tidak mendukung geolocation");
    return;
  }

  showLoading();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      hideLoading();
      setReportLocation(position.coords.latitude, position.coords.longitude, true);
      showToast("Lokasi berhasil diambil");
    },
    (error) => {
      hideLoading();
      let msg = "Gagal mengambil lokasi";
      if (error.code === 1) msg = "Izin lokasi ditolak. Aktifkan izin lokasi pada browser.";
      if (error.code === 2) msg = "Lokasi tidak tersedia. Coba lagi di area dengan sinyal GPS lebih baik.";
      if (error.code === 3) msg = "Pengambilan lokasi terlalu lama. Coba lagi.";
      showToast(msg);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function getFilteredPublicReports() {
  const status = val("publicFilterStatus");
  const kategori = val("publicFilterKategori");

  return PUBLIC_REPORTS.filter(item => {
    const okStatus = !status || item.status === status;
    const okKategori = !kategori || item.kategori === kategori;
    return okStatus && okKategori;
  });
}

function renderPublicMap() {
  if (!mainMap || !mainMarkers) return;
  mainMarkers.clearLayers();

  const data = getFilteredPublicReports().filter(hasCoords);
  const bounds = [];

  data.forEach(item => {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    bounds.push([lat, lng]);

    const marker = L.marker([lat, lng], { icon: createDivIcon(item.status) })
      .bindPopup(popupHtml(item, false));
    mainMarkers.addLayer(marker);
  });

  if (bounds.length > 0) {
    mainMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
}

function renderAdminMap() {
  if (!adminMap || !adminMarkers) return;
  adminMarkers.clearLayers();
  const data = ADMIN_REPORTS.filter(hasCoords);
  const bounds = [];

  data.forEach(item => {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    bounds.push([lat, lng]);
    const marker = L.marker([lat, lng], { icon: createDivIcon(item.status) })
      .bindPopup(popupHtml(item, true));
    adminMarkers.addLayer(marker);
  });

  if (bounds.length > 0) {
    adminMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
}

function hasCoords(item) {
  return Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude));
}

function popupHtml(item, admin = false) {
  const foto = item.fotoLink ? `<a href="${escapeHtml(item.fotoLink)}" target="_blank" rel="noopener">Lihat foto</a>` : "-";
  const detailBtn = admin ? `<button type="button" class="popup-btn" onclick="openDetail(${jsArg(item.id)})">Detail</button>` : "";
  return `
    <div class="map-popup">
      <strong>${escapeHtml(item.kode || item.id)}</strong>
      <h4>${escapeHtml(item.judul || "Aduan")}</h4>
      <p>${escapeHtml(item.kategori || "-")}</p>
      <p>${statusBadge(item.status)} ${priorityBadge(item.prioritas)}</p>
      <p>${escapeHtml(item.alamat || item.kecamatan || "Lokasi aduan")}</p>
      <p>${foto}</p>
      ${detailBtn}
    </div>
  `;
}

/* =========================
   PUBLIC DATA
========================= */

async function loadPublicData() {
  try {
    if (!isApiConfigured()) {
      renderDashboard([]);
      showToast("API_URL belum diisi. Portal tampilan sudah siap, koneksi backend belum aktif.");
      return;
    }
    showLoading();
    const result = await apiGet("getPublicReports");
    PUBLIC_REPORTS = Array.isArray(result.reports) ? result.reports : [];
    renderDashboard(PUBLIC_REPORTS);
    renderPublicMap();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal memuat data publik");
  } finally {
    hideLoading();
  }
}

function renderDashboard(data) {
  const rekap = buildStats(data);

  setText("heroTotal", rekap.total);
  setText("heroDiproses", rekap.diproses);
  setText("heroSelesai", rekap.selesai);

  setText("statTotal", rekap.total);
  setText("statDiterima", rekap.diterima);
  setText("statDiverifikasi", rekap.diverifikasi);
  setText("statDiproses", rekap.diproses);
  setText("statSelesai", rekap.selesai);
  setText("statDarurat", rekap.darurat);

  renderCharts(data);
}

function buildStats(data) {
  return {
    total: data.length,
    diterima: data.filter(x => x.status === "Diterima").length,
    diverifikasi: data.filter(x => x.status === "Diverifikasi").length,
    diproses: data.filter(x => x.status === "Diproses").length,
    selesai: data.filter(x => x.status === "Selesai").length,
    ditolak: data.filter(x => x.status === "Ditolak").length,
    darurat: data.filter(x => x.prioritas === "Darurat").length
  };
}

function countBy(data, field) {
  return data.reduce((acc, item) => {
    const key = item[field] || "Tidak Ada";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function renderCharts(data) {
  if (typeof Chart === "undefined") return;
  const statusCtx = $("chartStatus");
  const kategoriCtx = $("chartKategori");
  if (!statusCtx || !kategoriCtx) return;

  const statusCounts = countBy(data, "status");
  const kategoriCounts = countBy(data, "kategori");

  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{ data: Object.values(statusCounts) }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });

  if (chartKategori) chartKategori.destroy();
  chartKategori = new Chart(kategoriCtx, {
    type: "bar",
    data: {
      labels: Object.keys(kategoriCounts),
      datasets: [{ label: "Jumlah Aduan", data: Object.values(kategoriCounts) }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

/* =========================
   SUBMIT ADUAN
========================= */

async function submitAduan(event) {
  event.preventDefault();

  const payload = {
    action: "submitReport",
    namaPelapor: val("namaPelapor"),
    emailPelapor: val("emailPelapor"),
    hpPelapor: val("hpPelapor"),
    kategori: val("kategoriAduan"),
    prioritas: val("prioritasAduan"),
    kecamatan: val("kecamatanAduan"),
    judul: val("judulAduan"),
    deskripsi: val("deskripsiAduan"),
    latitude: val("latitudeAduan"),
    longitude: val("longitudeAduan"),
    alamat: val("alamatAduan")
  };

  const validation = validateAduan(payload);
  if (!validation.valid) {
    showToast(validation.message);
    return;
  }

  try {
    showLoading();
    const fileData = await readFotoAduan();
    Object.assign(payload, fileData);
    const result = await apiPost(payload);
    showToast(result.message || "Aduan berhasil dikirim");
    showSuccessAfterSubmit(result.kode || result.id);
    resetFormAduan();
    await loadPublicData();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal mengirim aduan");
  } finally {
    hideLoading();
  }
}

function validateAduan(payload) {
  if (!payload.namaPelapor) return { valid: false, message: "Nama pelapor wajib diisi" };
  if (!payload.hpPelapor) return { valid: false, message: "Nomor HP/WhatsApp wajib diisi" };
  if (!payload.kategori) return { valid: false, message: "Kategori aduan wajib dipilih" };
  if (!payload.judul) return { valid: false, message: "Judul aduan wajib diisi" };
  if (!payload.deskripsi) return { valid: false, message: "Uraian aduan wajib diisi" };
  if (!payload.latitude || !payload.longitude) return { valid: false, message: "Titik lokasi wajib diisi. Tekan Gunakan Lokasi Saya atau klik titik pada peta." };
  if (!Number.isFinite(Number(payload.latitude)) || !Number.isFinite(Number(payload.longitude))) return { valid: false, message: "Koordinat lokasi tidak valid" };
  if (!$("fotoAduan")?.files?.length) return { valid: false, message: "Foto aduan wajib diupload" };
  return { valid: true };
}

function readFotoAduan() {
  return new Promise((resolve, reject) => {
    const input = $("fotoAduan");
    const file = input?.files?.[0];
    if (!file) return reject(new Error("Foto aduan wajib diupload"));

    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > MAX_FILE_SIZE_MB) {
      return reject(new Error(`Ukuran foto maksimal ${MAX_FILE_SIZE_MB} MB`));
    }

    if (!file.type.startsWith("image/")) {
      return reject(new Error("File harus berupa gambar"));
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        fileBase64: reader.result,
        fileName: file.name,
        fileMimeType: file.type
      });
    };
    reader.onerror = () => reject(new Error("Gagal membaca file foto"));
    reader.readAsDataURL(file);
  });
}

function previewFoto() {
  const input = $("fotoAduan");
  const img = $("previewFoto");
  const wrap = $("previewWrap");
  const file = input?.files?.[0];

  if (!file || !img || !wrap) {
    wrap?.classList.add("hidden");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    img.src = reader.result;
    wrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function resetFormAduan() {
  $("formAduan")?.reset();
  clearReportLocation();
  $("previewWrap")?.classList.add("hidden");
}

function showSuccessAfterSubmit(kode) {
  const message = kode
    ? `Aduan berhasil dikirim. Kode laporan Anda: ${kode}. Simpan kode ini untuk pengecekan lanjutan.`
    : "Aduan berhasil dikirim.";
  alert(message);
}

/* =========================
   ADMIN AUTH
========================= */

function openAdminModal() {
  $("adminModal")?.classList.remove("hidden");
  setTimeout(() => $("adminUsername")?.focus(), 150);
}

function closeAdminModal() {
  $("adminModal")?.classList.add("hidden");
}

async function loginAdmin(event) {
  event.preventDefault();
  const username = val("adminUsername");
  const password = val("adminPassword");

  if (!username || !password) {
    showToast("Username dan password wajib diisi");
    return;
  }

  try {
    showLoading();
    const result = await apiGet("login", { username, password });
    localStorage.setItem("marina_login", "true");
    localStorage.setItem("marina_user", username);
    localStorage.setItem("marina_nama", result.user?.nama || username);
    localStorage.setItem("marina_role", result.user?.role || "ADMIN");
    closeAdminModal();
    showAdminApp();
    await loadAdminData();
    showToast("Login admin berhasil");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Login gagal");
  } finally {
    hideLoading();
  }
}

function cekAdminSession() {
  if (localStorage.getItem("marina_login") === "true") {
    showAdminApp(false);
    loadAdminData();
  }
}

function showAdminApp(scroll = true) {
  $("adminApp")?.classList.remove("hidden");
  setText("adminGreeting", `Selamat datang, ${localStorage.getItem("marina_nama") || "Admin"}.`);
  if (scroll) $("adminApp")?.scrollIntoView({ behavior: "smooth" });
}

function logoutAdmin() {
  if (!confirm("Keluar dari admin panel?")) return;
  localStorage.removeItem("marina_login");
  localStorage.removeItem("marina_user");
  localStorage.removeItem("marina_nama");
  localStorage.removeItem("marina_role");
  location.reload();
}

function toggleAdminSidebar() {
  document.querySelector(".admin-sidebar")?.classList.toggle("show");
}

function showAdminPage(pageId) {
  document.querySelectorAll(".admin-page").forEach(page => page.classList.add("hidden"));
  $(pageId)?.classList.remove("hidden");

  document.querySelectorAll(".admin-nav").forEach(btn => btn.classList.remove("active"));
  const button = Array.from(document.querySelectorAll(".admin-nav")).find(btn => btn.getAttribute("onclick")?.includes(pageId));
  button?.classList.add("active");

  const title = pageId === "adminLaporan" ? "Data Aduan" : pageId === "adminPeta" ? "Peta Admin" : "Dashboard Admin";
  setText("adminPageTitle", title);

  if (window.innerWidth <= 960) document.querySelector(".admin-sidebar")?.classList.remove("show");
  if (pageId === "adminPeta") initAdminMap();
}

/* =========================
   ADMIN DATA
========================= */

async function loadAdminData() {
  try {
    showLoading();
    const result = await apiGet("getAdminReports", { user: localStorage.getItem("marina_user") || "" });
    ADMIN_REPORTS = Array.isArray(result.reports) ? result.reports : [];
    renderAdminDashboard();
    renderAdminTable();
    renderAdminMap();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal memuat data admin");
  } finally {
    hideLoading();
  }
}

function renderAdminDashboard() {
  const stats = buildStats(ADMIN_REPORTS);
  setText("adminTotal", stats.total);
  setText("adminDiterima", stats.diterima);
  setText("adminDiverifikasi", stats.diverifikasi);
  setText("adminDiproses", stats.diproses);
  setText("adminSelesai", stats.selesai);
  setText("adminDarurat", stats.darurat);

  const recent = [...ADMIN_REPORTS].slice(0, 7);
  const tbody = $("adminRecentBody");
  if (!tbody) return;

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Belum ada aduan</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.kode)}</strong></td>
      <td>${escapeHtml(shortDate(item.createdAt))}</td>
      <td>${escapeHtml(item.namaPelapor || "-")}</td>
      <td>${escapeHtml(item.kategori || "-")}</td>
      <td>${escapeHtml(item.judul || "-")}</td>
      <td>${statusBadge(item.status)}</td>
      <td><button type="button" class="btn-mini" onclick="openDetail(${jsArg(item.id)})">Detail</button></td>
    </tr>
  `).join("");
}

function getFilteredAdminReports() {
  const q = normalize(val("adminSearch"));
  const status = val("adminFilterStatus");
  const kategori = val("adminFilterKategori");

  return ADMIN_REPORTS.filter(item => {
    const text = normalize([
      item.kode,
      item.namaPelapor,
      item.hpPelapor,
      item.emailPelapor,
      item.kategori,
      item.judul,
      item.deskripsi,
      item.kecamatan,
      item.alamat,
      item.status
    ].join(" "));

    const okQ = !q || text.includes(q);
    const okStatus = !status || item.status === status;
    const okKategori = !kategori || item.kategori === kategori;
    return okQ && okStatus && okKategori;
  });
}

function renderAdminTable() {
  const tbody = $("adminTableBody");
  if (!tbody) return;

  const data = getFilteredAdminReports();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center">Tidak ada data aduan</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.kode)}</strong></td>
      <td>${escapeHtml(shortDate(item.createdAt))}</td>
      <td>${escapeHtml(item.namaPelapor || "-")}</td>
      <td>${escapeHtml(item.hpPelapor || item.emailPelapor || "-")}</td>
      <td>${escapeHtml(item.kategori || "-")}</td>
      <td>${escapeHtml(item.judul || "-")}</td>
      <td>${escapeHtml(item.kecamatan || item.alamat || "-")}</td>
      <td>${priorityBadge(item.prioritas)}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="table-actions">
        <button type="button" class="btn-mini" onclick="openDetail(${jsArg(item.id)})">Detail</button>
        <button type="button" class="btn-mini btn-warning" onclick="quickStatus(${jsArg(item.id)})">Status</button>
      </td>
    </tr>
  `).join("");
}

function statusBadge(status) {
  const cls = normalize(status).replace(/\s+/g, "-") || "diterima";
  return `<span class="status-pill ${cls}">${escapeHtml(status || "Diterima")}</span>`;
}

function priorityBadge(prioritas) {
  const cls = normalize(prioritas).replace(/\s+/g, "-") || "normal";
  return `<span class="priority-pill ${cls}">${escapeHtml(prioritas || "Normal")}</span>`;
}

function openDetail(id) {
  const item = ADMIN_REPORTS.find(row => String(row.id) === String(id)) || PUBLIC_REPORTS.find(row => String(row.id) === String(id));
  if (!item) {
    showToast("Data aduan tidak ditemukan");
    return;
  }

  const isAdmin = localStorage.getItem("marina_login") === "true";
  const foto = item.fotoLink
    ? `<a href="${escapeHtml(item.fotoLink)}" target="_blank" rel="noopener" class="btn btn-soft-dark"><i class="fa-solid fa-image"></i> Buka Foto</a>`
    : `<span class="muted">Tidak ada foto</span>`;

  const mapLink = hasCoords(item)
    ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(item.latitude + ',' + item.longitude)}" target="_blank" rel="noopener" class="btn btn-light"><i class="fa-solid fa-map"></i> Buka Maps</a>`
    : "";

  const adminTools = isAdmin ? `
    <div class="status-update-box">
      <h3>Update Status Aduan</h3>
      <div class="status-update-grid">
        <select id="detailStatus">
          <option value="Diterima" ${item.status === "Diterima" ? "selected" : ""}>Diterima</option>
          <option value="Diverifikasi" ${item.status === "Diverifikasi" ? "selected" : ""}>Diverifikasi</option>
          <option value="Diproses" ${item.status === "Diproses" ? "selected" : ""}>Diproses</option>
          <option value="Selesai" ${item.status === "Selesai" ? "selected" : ""}>Selesai</option>
          <option value="Ditolak" ${item.status === "Ditolak" ? "selected" : ""}>Ditolak</option>
        </select>
        <textarea id="detailCatatan" placeholder="Catatan tindak lanjut untuk pelapor/admin">${escapeHtml(item.adminCatatan || "")}</textarea>
        <button type="button" class="btn btn-primary" onclick="updateStatusFromDetail(${jsArg(item.id)})"><i class="fa-solid fa-save"></i> Simpan Status</button>
      </div>
    </div>
  ` : "";

  $("detailContent").innerHTML = `
    <div class="detail-head">
      <span>${statusBadge(item.status)}</span>
      <h2>${escapeHtml(item.kode || item.id)}</h2>
      <p>${escapeHtml(item.judul || "Aduan")}</p>
    </div>

    <div class="detail-actions">${foto}${mapLink}</div>

    <table class="detail-table">
      <tr><td>Tanggal Masuk</td><td>${escapeHtml(formatDate(item.createdAt))}</td></tr>
      <tr><td>Pelapor</td><td>${escapeHtml(item.namaPelapor || "-")}</td></tr>
      <tr><td>Email</td><td>${escapeHtml(item.emailPelapor || "-")}</td></tr>
      <tr><td>HP/WhatsApp</td><td>${escapeHtml(item.hpPelapor || "-")}</td></tr>
      <tr><td>Kategori</td><td>${escapeHtml(item.kategori || "-")}</td></tr>
      <tr><td>Prioritas</td><td>${priorityBadge(item.prioritas)}</td></tr>
      <tr><td>Kecamatan</td><td>${escapeHtml(item.kecamatan || "-")}</td></tr>
      <tr><td>Alamat/Patokan</td><td>${escapeHtml(item.alamat || "-")}</td></tr>
      <tr><td>Koordinat</td><td>${escapeHtml(item.latitude || "-")}, ${escapeHtml(item.longitude || "-")}</td></tr>
      <tr><td>Uraian</td><td>${escapeHtml(item.deskripsi || "-")}</td></tr>
      <tr><td>Catatan Admin</td><td>${escapeHtml(item.adminCatatan || "-")}</td></tr>
      <tr><td>Update Terakhir</td><td>${escapeHtml(formatDate(item.updatedAt))}</td></tr>
    </table>

    ${adminTools}
  `;

  $("detailModal")?.classList.remove("hidden");
}

function closeDetailModal() {
  $("detailModal")?.classList.add("hidden");
}

function quickStatus(id) {
  openDetail(id);
  setTimeout(() => $("detailStatus")?.focus(), 100);
}

async function updateStatusFromDetail(id) {
  const status = val("detailStatus");
  const catatan = val("detailCatatan");
  if (!status) {
    showToast("Status wajib dipilih");
    return;
  }

  try {
    showLoading();
    const result = await apiPost({
      action: "updateStatus",
      id,
      status,
      adminCatatan: catatan,
      updatedBy: localStorage.getItem("marina_nama") || localStorage.getItem("marina_user") || "ADMIN"
    });
    showToast(result.message || "Status berhasil diupdate");
    closeDetailModal();
    await loadAdminData();
    await loadPublicData();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal update status");
  } finally {
    hideLoading();
  }
}

function exportCSV() {
  const data = getFilteredAdminReports();
  const headers = [
    "Kode", "Tanggal", "Nama Pelapor", "Email", "HP", "Kategori", "Prioritas", "Judul", "Deskripsi", "Kecamatan", "Alamat", "Latitude", "Longitude", "Status", "Foto", "Catatan Admin"
  ];

  const rows = data.map(item => [
    item.kode, item.createdAt, item.namaPelapor, item.emailPelapor, item.hpPelapor, item.kategori,
    item.prioritas, item.judul, item.deskripsi, item.kecamatan, item.alamat,
    item.latitude, item.longitude, item.status, item.fotoLink, item.adminCatatan
  ]);

  const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MARINA_Aduan_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
