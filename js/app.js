// ===== НАСТРОЙКИ =====
const CONFIG = {
  githubUser: "ibcsz12",
  githubRepo: "homework-552",
  backgroundDir: "background",
  cacheMinutes: 60,
  supabaseUrl: "https://fvihtnpcwrftnjwwovzy.supabase.co",
  supabaseAnonKey: "sb_publishable_XSYtPmeWYimq-cgeDEwYEw_VVD0jwrG", // публичный ключ, можно во фронтенде
  avatarPath: "images/avatar.jpg",
  botUsername: "dfdfsdfsdfsdfsdfBot", // без @
};

// ===== TELEGRAM =====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ===== РОЛЬ =====
// Роль приходит в ссылке, которую бот формирует для каждого пользователя (?role=...).
// Это только для показа разделов. Реальные действия проверяет бот.
const params = new URLSearchParams(location.search);
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
  answerRaw: `=== ЗАДАНИЕ 1 ===
1. Раскроем скобки: 3x + 6 - 2x = 10.
2. Приведём подобные слагаемые: x + 6 = 10.
3. Перенесём 6 в правую часть: x = 4.
Ответ: x = 4

=== ЗАДАНИЕ 2 ===
1. Площадь прямоугольника S = a * b = 6 * 7 = 42.
2. Периметр P = 2 * (a + b) = 2 * 13 = 26.
Ответ: S = 42, P = 26`,
};

const IS_DEMO = !CONFIG.supabaseUrl || CONFIG.supabaseUrl.includes("YOUR_");

const dataSource = {
  isDemo: IS_DEMO,

  // Все ДЗ, которые бот публикует в Supabase (таблица homework_snapshot, строка id = 1)
  getHomework: async () => {
    if (IS_DEMO) {
      await delay(250);
      return { subjects: JSON.parse(JSON.stringify(DEMO.subjects)), updatedAt: null };
    }
    const res = await fetch(
      `${CONFIG.supabaseUrl}/rest/v1/homework_snapshot?id=eq.1&select=payload,updated_at`,
      { headers: { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${CONFIG.supabaseAnonKey}` } }
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const [row] = await res.json();
    return { subjects: row?.payload?.subjects || [], updatedAt: row?.updated_at || null };
  },

  // Решения ИИ пока демо, подключим следующим шагом
  getAnswer: async () => {
    await delay(400);
    return DEMO.answerRaw;
  },
};

// Разбор текста решения: блоки "=== ЗАДАНИЕ N ===", внутри которых строка "Ответ: ..."
function parseAnswer(raw) {
  const chunks = raw.split(/^=== ЗАДАНИЕ (\d+) ===\s*$/m);
  const tasks = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const num = chunks[i];
    const body = (chunks[i + 1] || "").trim();
    const idx = body.lastIndexOf("Ответ:");
    tasks.push({
      num,
      solution: idx >= 0 ? body.slice(0, idx).trim() : body,
      answer: idx >= 0 ? body.slice(idx + "Ответ:".length).trim() : "",
    });
  }
  return tasks;
}

// ===== НАВИГАЦИЯ =====
let currentView = "home";
const navStack = [];

const LOADERS = {
  homework: () => loadHomework(),
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

async function loadHomework() {
  const list = $("#hwList");
  list.replaceChildren(h("div", { class: "skeleton" }));

  let result;
  try {
    result = await dataSource.getHomework();
    subjectsCache = result.subjects;
  } catch {
    list.replaceChildren(h("div", { class: "panel" }, "Не удалось загрузить ДЗ. Попробуйте позже."));
    return;
  }

  $("#hwCount").textContent = subjectsCache.length;
  const updated = result.updatedAt
    ? new Date(result.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  $("#hwUpdated").textContent = updated ? `Обновлено: ${updated}` : "";

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

async function openAnswer(index) {
  const subject = subjectsCache[index];
  showView("answer");
  $("#answerTitle").textContent = subject?.subject || "Решение";
  $("#answerBody").replaceChildren(h("div", { class: "skeleton" }));

  try {
    const raw = await dataSource.getAnswer(subject);
    answerTasks = parseAnswer(raw);
  } catch {
    toast("Не удалось получить решение");
    return;
  }

  setAnswerTab("solutions");
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
    showView("homework");
    toast("Выберите предмет для решения ИИ");
  },
  refresh: () => loadHomework(),
  copy: () => copyAnswers(),
  dzauto: () => scheduleOn(),
  dzoff: () => sendToBot({ action: "dzoff" }),
  broadcast: () => sendBroadcast(),
  close: () => (tg ? tg.close() : toast("Откройте через Telegram")),
};

// ===== ПРОФИЛЬ И АВАТАР =====
function fillProfile() {
  const user = tg?.initDataUnsafe?.user;
  const firstName = user?.first_name;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ")
    || "нет данных Telegram, откройте через бота";

  $("#greeting").textContent = firstName ? `Привет, ${firstName}!` : "Привет!";
  $("#profileName").textContent = fullName;
  $("#profileRole").textContent = ROLE_LABELS[role];
  $("#handle").textContent = CONFIG.botUsername ? `@${CONFIG.botUsername}` : "";
  $("#demoBadge").hidden = !dataSource.isDemo;
}

// Аватарка: сначала фото из Telegram, если его нет, то images/avatar.jpg, иначе буква имени.
function initAvatar() {
  const img = $("#avatarImg");
  const user = tg?.initDataUnsafe?.user;

  $("#avatarLetter").textContent = (user?.first_name?.[0] || "?").toUpperCase();

  const sources = [user?.photo_url, CONFIG.avatarPath].filter(Boolean);
  let index = 0;
  const tryNext = () => {
    if (index >= sources.length) {
      img.hidden = true;
      return;
    }
    img.src = sources[index++];
  };

  img.onload = () => {
    img.hidden = false;
  };
  img.onerror = tryNext;
  tryNext();
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