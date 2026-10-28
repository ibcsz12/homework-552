// ===== НАСТРОЙКИ =====
const CONFIG = {
  githubUser: "ibcsz12",
  githubRepo: "homework-552",
  backgroundDir: "background",
  cacheMinutes: 60,
  avatarPath: "images/avatar.jpg",
  botUsername: "dfdfsdfsdfsdfBot",
  apiUrl: "http://127.0.0.1:8080",
};

// ===== TELEGRAM =====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ===== API URL (ПАРАМЕТР ИЛИ LOCALSTORAGE) =====
const params = new URLSearchParams(location.search);
let storedApi = null;
try {
  storedApi = localStorage.getItem("hw_api_url");
} catch (e) {}

const paramApi = params.get("api");
if (paramApi) {
  try {
    localStorage.setItem("hw_api_url", paramApi);
  } catch (e) {}
}

const API_BASE = (paramApi || storedApi || CONFIG.apiUrl).replace(/\/$/, "");

// ===== РОЛЬ =====
// Роль приходит в ссылке, которую бот формирует для каждого пользователя (?role=...).
// Это только для показа разделов. Реальные действия проверяет бот.
const ROLE_RANK = { user: 0, ai: 1, admin: 2 };
const role = ROLE_RANK[params.get("role")] !== undefined ? params.get("role") : "user";
const roleAtLeast = (need) => ROLE_RANK[role] >= ROLE_RANK[need];
const ROLE_LABELS = { user: "Ученик", ai: "Ученик · ИИ-доступ", admin: "Администратор" };

// ===== ХЕЛПЕРЫ =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Создание элементов без innerHTML, чтобы текст из данных не выполнялся как разметка
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null) el.append(child);
  }
  return el;
}

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// Действия, которым не нужен ответ бота (рассылка, расписание).
// После sendData Telegram закрывает приложение, а подтверждение приходит в чат.
function sendToBot(payload) {
  if (!tg) {
    toast("Откройте приложение через Telegram");
    return;
  }
  tg.sendData(JSON.stringify(payload));
}

function formatDate(iso) {
  const date = new Date(iso);
  return isNaN(date) ? iso : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// ===== ИСТОЧНИК ДАННЫХ =====
// Сейчас демо. Когда выберем канал (например, БД, куда бот пишет результаты),
// заменим реализацию здесь, остальной код не трогаем.
const DEMO = {
  subjects: [
    {
      subject: "Математика",
      date: "2026-10-16",
      tasks: [{ name: "№ 412, 415 (а, б)", files: [{ name: "Учебник стр. 87.pdf", url: "#" }] }],
    },
    {
      subject: "Русский язык",
      date: "2026-10-15",
      tasks: [{ name: "Упр. 233: выписать орфограммы", files: [] }],
    },
    {
      subject: "История",
      date: "2026-10-14",
      tasks: [{ name: "§ 12, ответить на вопросы 1–3", files: [] }],
    },
  ],
};

const dataSource = {
  isDemo: false,

  // Все ДЗ, которые бот публикует в SQLite через локальный API
  getHomework: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/homework`);
      if (!res.ok) throw new Error(`API HTTP ${res.status}`);
      const data = await res.json();
      return { subjects: data.subjects || [], updatedAt: data.updated_at || null };
    } catch (err) {
      console.warn("API unreachable, fallback to demo/cache:", err);
      return { subjects: JSON.parse(JSON.stringify(DEMO.subjects)), updatedAt: null };
    }
  },
};

// Запрос на сбор ДЗ через локальный API
async function requestHomeworkRefresh() {
  const res = await fetch(`${API_BASE}/api/homework/refresh`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
}

// Ждём, пока бот опубликует новый снимок (меняется updated_at)
async function waitForFreshSnapshot(previousUpdatedAt, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await delay(3000);
    const fresh = await dataSource.getHomework();
    if (fresh.updatedAt && fresh.updatedAt !== previousUpdatedAt) return fresh;
  }
  return null;
}

// ===== НАВИГАЦИЯ =====
let currentView = "home";
const navStack = [];

const LOADERS = {
  homework: () => loadHomework({ refresh: true }),
};

function showView(name, { push = true } = {}) {
  if (push && name !== currentView) navStack.push(currentView);
  currentView = name;

  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));

  const navName = name === "answer" ? "homework" : name;
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === navName));

  if (tg?.BackButton) {
    if (name === "home") tg.BackButton.hide();
    else tg.BackButton.show();
  }

  window.scrollTo({ top: 0 });
  LOADERS[name]?.();
}

function goBack() {
  const prev = navStack.pop() || "home";
  showView(prev, { push: false });
}

// ===== ДЗ =====
let subjectsCache = [];

async function loadHomework({ refresh = false } = {}) {
  const list = $("#hwList");
  list.replaceChildren(h("div", { class: "skeleton" }));

  let result;
  try {
    result = await dataSource.getHomework();
  } catch {
    list.replaceChildren(h("div", { class: "panel" }, "Не удалось загрузить ДЗ. Попробуйте позже."));
    return;
  }

  renderHomework(result);

  if (refresh && !dataSource.isDemo) {
    $("#hwUpdated").textContent = "Обновляю ДЗ...";
    try {
      await requestHomeworkRefresh();
      const fresh = await waitForFreshSnapshot(result.updatedAt);
      if (fresh) {
        renderHomework(fresh);
      } else {
        renderHomework(result);
        toast("ДЗ уже актуальны, обновление не чаще раза в 8 минут");
      }
    } catch {
      renderHomework(result);
      toast("Не удалось обновить ДЗ");
    }
  }
}

function renderHomework(result) {
  subjectsCache = result.subjects;
  $("#hwCount").textContent = subjectsCache.length;

  const updated = result.updatedAt
    ? new Date(result.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  $("#hwUpdated").textContent = updated ? `Обновлено: ${updated}` : "";

  const list = $("#hwList");
  if (!subjectsCache.length) {
    list.replaceChildren(h("div", { class: "panel" }, "📭 Нет домашних заданий"));
    return;
  }
  list.replaceChildren(...subjectsCache.map(renderSubject));
}

function renderSubject(subject, index) {
  const aiButton = roleAtLeast("ai")
    ? h("button", { class: "btn primary small", onclick: () => openAnswer(index) }, "🤖 Решить ИИ")
    : null;

  return h(
    "article",
    { class: "hw-card" },
    h("div", { class: "hw-head" },
      h("span", { class: "hw-subject" }, subject.subject),
      h("span", { class: "chip" }, formatDate(subject.date))
    ),
    ...subject.tasks.map((task) =>
      h("div", { class: "hw-task" },
        h("div", { class: "hw-name" }, task.name),
        task.files?.length
          ? h("div", { class: "hw-files" },
              ...task.files.map((f) =>
                h("a", { class: "file", href: f.url, target: "_blank", rel: "noopener" }, `📎 ${f.name}`)
              )
            )
          : null
      )
    ),
    aiButton
  );
}

// ===== РЕШЕНИЕ ИИ (в приложении, вместо двух файлов) =====
let answerTasks = [];

// «Решить ИИ» открывает обычный чат с ботом: выбор предметов, пожелания и решение работают там
function openAnswer(index) {
  const subject = subjectsCache[index];
  sendToBot({ action: "ai_dz", subject: subject?.subject || "" });
}

function setAnswerTab(tab) {
  $$(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.seg === tab));
  const body = $("#answerBody");

  if (!answerTasks.length) {
    body.replaceChildren(h("div", { class: "panel" }, "Решение пока пустое"));
    return;
  }

  if (tab === "solutions") {
    body.replaceChildren(
      ...answerTasks.map((t) =>
        h("article", { class: "sol-card" },
          h("div", { class: "sol-num" }, `Задание ${t.num}`),
          h("pre", { class: "sol-text" }, t.solution),
          h("div", { class: "sol-answer" }, h("b", {}, "Ответ: "), t.answer)
        )
      )
    );
  } else {
    body.replaceChildren(
      ...answerTasks.map((t) =>
        h("div", { class: "ans-row" },
          h("span", { class: "ans-num" }, t.num),
          h("span", { class: "ans-text" }, t.answer)
        )
      )
    );
  }
}

async function copyAnswers() {
  const text = answerTasks.map((t) => `Задание ${t.num}: ${t.answer}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Ответы скопированы");
  } catch {
    toast("Не удалось скопировать");
  }
}

// ===== РАССЫЛКА И РОЛИ =====
function scheduleOn() {
  const time = $("#dzTime").value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    toast("Укажите время в формате ЧЧ:ММ");
    return;
  }
  sendToBot({ action: "dzauto", time });
}

function sendBroadcast() {
  if (!roleAtLeast("admin")) return;
  const text = $("#broadcastText").value.trim();
  if (!text) {
    toast("Введите текст рассылки");
    return;
  }
  sendToBot({ action: "broadcast", text });
}

function applyRoleVisibility() {
  $$("[data-min-role]").forEach((el) => {
    el.hidden = !roleAtLeast(el.dataset.minRole);
  });
}

const ACTIONS = {
  get_dz: () => showView("homework"),
  ai_dz: () => {
    if (!roleAtLeast("ai")) {
      toast("Функция недоступна");
      return;
    }
    sendToBot({ action: "ai_dz" });
  },
  refresh: () => loadHomework({ refresh: true }),
  copy: () => copyAnswers(),
  dzauto: () => scheduleOn(),
  dzoff: () => sendToBot({ action: "dzoff" }),
  broadcast: () => sendBroadcast(),
  close: () => (tg ? tg.close() : toast("Откройте через Telegram")),
};

// ===== ПОЛУЧЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ =====
function getUser() {
  // 1. Из штатного Telegram WebApp SDK
  if (tg?.initDataUnsafe?.user?.id || tg?.initDataUnsafe?.user?.first_name) {
    return tg.initDataUnsafe.user;
  }

  // 2. Парсинг из сырого tg.initData
  if (tg?.initData) {
    try {
      const q = new URLSearchParams(tg.initData);
      const uStr = q.get("user");
      if (uStr) return JSON.parse(uStr);
    } catch (e) {}
  }

  // 3. Парсинг из хэша URL (location.hash -> tgWebAppData)
  if (location.hash) {
    try {
      const hp = new URLSearchParams(location.hash.slice(1));
      const raw = hp.get("tgWebAppData");
      if (raw) {
        const q = new URLSearchParams(raw);
        const uStr = q.get("user");
        if (uStr) return JSON.parse(uStr);
      }
    } catch (e) {}
  }

  // 4. Fallback из GET-параметров URL (?fname=...&uname=...&id=...)
  const pName = params.get("fname") || params.get("first_name") || params.get("name");
  const pUser = params.get("uname") || params.get("username");
  const pId = params.get("id");
  if (pName || pUser || pId) {
    return {
      first_name: pName || "",
      last_name: params.get("lname") || params.get("last_name") || "",
      username: pUser ? pUser.replace(/^@/, "") : "",
      id: pId ? Number(pId) || pId : "",
      photo_url: params.get("photo_url") || ""
    };
  }

  return null;
}

// ===== ПРОФИЛЬ И АВАТАР =====
function fillProfile() {
  const user = getUser();
  const firstName = user?.first_name || (user?.username ? `@${user.username}` : "");
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ")
    || (user?.username ? `@${user.username}` : "Пользователь");

  $("#greeting").textContent = firstName ? `Привет, ${firstName}!` : "Привет!";
  $("#profileName").textContent = fullName;
  
  const roleEl = $("#profileRole");
  if (roleEl) {
    roleEl.textContent = ROLE_LABELS[role] || "Ученик";
    roleEl.className = `badge-role ${role}`;
  }

  const idEl = $("#profileId");
  if (idEl) {
    idEl.textContent = user?.id ? `${user.id}` : "—";
  }

  const handle = user?.username ? `@${user.username}` : (CONFIG.botUsername ? `@${CONFIG.botUsername}` : "");
  $("#handle").textContent = handle;
  $("#demoBadge").hidden = !dataSource.isDemo;
}

// Аватарка: фото из Telegram -> публичный Telegram CDN -> генератор -> стильная буква
function initAvatar() {
  const img = $("#avatarImg");
  const letter = $("#avatarLetter");
  const user = getUser();

  const char = (user?.first_name?.[0] || user?.username?.[0] || "U").toUpperCase();
  letter.textContent = char;

  const sources = [];
  if (user?.photo_url) sources.push(user.photo_url);
  if (user?.username) sources.push(`https://t.me/i/userpic/320/${user.username}.jpg`);
  if (user?.first_name) {
    sources.push(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.first_name)}&background=f38020&color=fff&bold=true`);
  }

  let index = 0;
  const tryNext = () => {
    if (index >= sources.length) {
      img.hidden = true;
      letter.hidden = false;
      return;
    }
    img.src = sources[index++];
  };

  img.onload = () => {
    img.hidden = false;
    letter.hidden = true;
  };
  img.onerror = tryNext;

  if (sources.length > 0) {
    tryNext();
  } else {
    img.hidden = true;
    letter.hidden = false;
  }
}

// ===== ФОН: случайная картинка из папки background/ =====
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
  } catch {
    // localStorage недоступен, ничего страшного
  }
}

function applyBackground(list) {
  if (!list?.length) return;
  const url = list[Math.floor(Math.random() * list.length)];
  $("#banner").style.backgroundImage = `url("${url}")`;
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
      .filter((f) => f.type === "file" && IMAGE_RE.test(f.name))
      .map((f) => f.download_url);

    writeBgCache(list);
    applyBackground(list);
  } catch {
    // Нет сети или лимит API: остаёмся на градиенте
  }
}

// ===== СОБЫТИЯ =====
document.addEventListener("click", (e) => {
  const el = e.target.closest("button, a");
  if (!el) return;

  if (el.dataset.tab) {
    showView(el.dataset.tab);
    return;
  }
  if (el.hasAttribute("data-back")) {
    goBack();
    return;
  }
  if (el.dataset.seg) {
    setAnswerTab(el.dataset.seg);
    return;
  }
  if (el.dataset.action && ACTIONS[el.dataset.action]) {
    ACTIONS[el.dataset.action]();
  }
});

// ===== СТАРТ =====
function init() {
  if (tg?.BackButton) tg.BackButton.onClick(goBack);

  applyRoleVisibility();
  fillProfile();
  initAvatar();
  loadBackground();
  showView("home", { push: false });
  loadHomework(); // обновит счётчик на главной
}

init();