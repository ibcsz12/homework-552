// ===== НАСТРОЙКИ: заполни своими значениями =====
const CONFIG = {
  githubUser: "ibcsz12",
  githubRepo: "homework-552",
  backgroundDir: "background",
  cacheMinutes: 60,
};

// ===== TELEGRAM =====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// Роль приходит из URL: ?role=admin | ai | user
// Это только для показа интерфейса. Реальные права проверяет бот.
const params = new URLSearchParams(location.search);
const ROLE_RANK = { user: 0, ai: 1, admin: 2 };
const role = ROLE_RANK[params.get("role")] !== undefined ? params.get("role") : "user";
const roleAtLeast = (need) => ROLE_RANK[role] >= ROLE_RANK[need];

const ROLE_LABELS = { user: "Ученик", ai: "Ученик · ИИ-доступ", admin: "Администратор" };

// ===== ОТПРАВКА ДЕЙСТВИЙ БОТУ =====
function send(payload) {
  if (!tg) {
    toast("Откройте приложение через Telegram");
    return;
  }
  // После sendData Mini App закрывается, а бот получает данные.
  tg.sendData(JSON.stringify(payload));
}

// ===== ВСПОМОГАТЕЛЬНОЕ =====
let toastTimer;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function showTab(name) {
  document.querySelectorAll(".view").forEach(v =>
    v.classList.toggle("active", v.id === `view-${name}`)
  );
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== РОЛИ: скрываем кнопки, которые не для этой роли =====
function applyRoleVisibility() {
  document.querySelectorAll("[data-min-role]").forEach(el => {
    el.hidden = !roleAtLeast(el.dataset.minRole);
  });
}

function fillProfile() {
  const user = tg?.initDataUnsafe?.user;
  const name = user?.first_name || "друг";
  document.getElementById("userName").textContent = name;
  document.getElementById("profileName").textContent = name;
  document.getElementById("roleLabel").textContent = ROLE_LABELS[role];
  document.getElementById("profileRole").textContent = ROLE_LABELS[role];
}

// ===== ОБРАБОТКА НАЖАТИЙ =====
document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) {
    showTab(tabBtn.dataset.tab);
    return;
  }

  const actionBtn = e.target.closest("[data-action]");
  if (actionBtn) {
    handleAction(actionBtn.dataset.action);
  }
});

document.getElementById("btnDzauto").addEventListener("click", () => {
  const time = document.getElementById("dzTime").value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    toast("Укажите время в формате ЧЧ:ММ");
    return;
  }
  send({ action: "dzauto", time });
});

function handleAction(action) {
  switch (action) {
    case "get_dz":
      send({ action: "get_dz" });
      break;

    case "dzoff":
      send({ action: "dzoff" });
      break;

    case "ai_dz":
      if (!roleAtLeast("ai")) {
        toast("Функция недоступна");
        return;
      }
      send({ action: "ai_dz" });
      break;

    case "broadcast": {
      if (!roleAtLeast("admin")) return;
      const text = document.getElementById("broadcastText").value.trim();
      if (!text) {
        toast("Введите текст рассылки");
        return;
      }
      send({ action: "broadcast", text });
      break;
    }
  }
}

// ===== ФОН: случайная картинка из папки background/ =====
// Если папка пустая или API недоступен, остаётся градиент из CSS.
const BG_CACHE_KEY = "autodz_bg_cache";
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

function readBgCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(BG_CACHE_KEY) || "null");
    if (!raw) return null;
    const fresh = Date.now() - raw.ts < CONFIG.cacheMinutes * 60 * 1000;
    return fresh ? raw.list : null;
  } catch {
    return null;
  }
}

function writeBgCache(list) {
  try {
    localStorage.setItem(BG_CACHE_KEY, JSON.stringify({ ts: Date.now(), list }));
  } catch { /* localStorage недоступен, ничего страшного */ }
}

function applyBackground(list) {
  if (!list || list.length === 0) return;
  const url = list[Math.floor(Math.random() * list.length)];
  const banner = document.getElementById("banner");
  // Тёмный оверлей поверх картинки, чтобы текст читался
  banner.style.backgroundImage =
    `linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.55)), url("${url}")`;
}

async function loadBackground() {
  const cached = readBgCache();
  if (cached) {
    applyBackground(cached);
    return;
  }

  try {
    const api = `https://api.github.com/repos/${CONFIG.githubUser}/${CONFIG.githubRepo}/contents/${CONFIG.backgroundDir}`;
    const res = await fetch(api, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;

    const files = await res.json();
    const list = files
      .filter(f => f.type === "file" && IMAGE_RE.test(f.name))
      .map(f => f.download_url);

    writeBgCache(list);
    applyBackground(list);
  } catch {
    // Нет сети или лимит API: остаёмся на градиенте
  }
}

// ===== СТАРТ =====
applyRoleVisibility();
fillProfile();
loadBackground();