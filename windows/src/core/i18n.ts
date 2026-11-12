import { isShelfTraceSourceRecording, shelfTrace } from "./shelf-trace";

export type Language = "uk" | "en";
export type LanguagePreference = Language | "auto";
type Message = { en: string; uk: string };

export interface TrayMenuLabels {
  openNook: string;
  hideIsland: string;
  showIsland: string;
  showAgentsList: string;
  hideAgentsList: string;
  settings: string;
  pause: string;
  quit: string;
}

/** Keys are the existing English source phrases; unknown phrases deliberately fall back to English. */
export const MESSAGES = {
  "Settings": { en: "Settings", uk: "Налаштування" },
  "Disconnect": { en: "Disconnect", uk: "Відключити" },
  "Repair": { en: "Repair", uk: "Відновити підключення" },
  "Open Nook": { en: "Open Nook", uk: "Відкрити Nook" },
  "Hide island": { en: "Hide island", uk: "Приховати острівець" },
  "Show island": { en: "Show island", uk: "Показати острівець" },
  "Show agents list": { en: "Show agents list", uk: "Показати список агентів" },
  "Hide agents list": { en: "Hide agents list", uk: "Приховати список агентів" },
  "Pause": { en: "Pause", uk: "Призупинити" },
  "Quit": { en: "Quit", uk: "Вийти" },
  "Connect": { en: "Connect", uk: "Підключити" },
  "Home": { en: "Home", uk: "Головна" },
  "Shelf": { en: "Shelf", uk: "Панель" },
  "Agents": { en: "Agents", uk: "Агенти" },
  "About and privacy": { en: "About and privacy", uk: "Про застосунок і приватність" },
  "Look and colours": { en: "Look and colours", uk: "Вигляд і кольори" },
  "Sounds": { en: "Sounds", uk: "Звуки" },
  "Shortcuts": { en: "Shortcuts", uk: "Сполучення клавіш" },
  "Shelf widgets": { en: "Shelf widgets", uk: "Віджети панелі" },
  "Language": { en: "Language", uk: "Мова" },
  "Choose the language used throughout Nook.": { en: "Choose the language used throughout Nook.", uk: "Виберіть мову інтерфейсу Nook." },
  "Ukrainian": { en: "Ukrainian", uk: "Українська" },
  "Українська": { en: "Ukrainian", uk: "Українська" },
  "English": { en: "English", uk: "Англійська" },
  "Save": { en: "Save", uk: "Зберегти" },
  "Cancel": { en: "Cancel", uk: "Скасувати" },
  "Turn on…": { en: "Turn on…", uk: "Увімкнути…" },
  "Restart Nook first: a part of it is missing.": { en: "Restart Nook first: a part of it is missing.", uk: "Спочатку перезапустіть Nook: бракує одного з його компонентів." },
  "None yet": { en: "None yet", uk: "Ще немає" },
  "Off. No shortcut is registered.": { en: "Off. No shortcut is registered.", uk: "Вимкнено. Сполучення клавіш не зареєстровано." },
  "Puts everything on this page back as it was when Nook was installed, including starting with your computer (off).": { en: "Puts everything on this page back as it was when Nook was installed, including starting with your computer (off).", uk: "Відновлює початкові налаштування цієї сторінки, зокрема запуск разом із Windows (вимкнено)." },
  "Puts Gullu's colour, the window's colours and the motion back as they came.": { en: "Puts Gullu's colour, the window's colours and the motion back as they came.", uk: "Відновлює початкові кольори Gullu, вікон і параметри анімації." },
  "Turns sounds back on, at the volume they came with.": { en: "Turns sounds back on, at the volume they came with.", uk: "Умикає звуки з початковою гучністю." },
  "Turns the agents list off and puts its fading back as it came. Where you put the list, and its size, are kept.": { en: "Turns the agents list off and puts its fading back as it came. Where you put the list, and its size, are kept.", uk: "Вимикає список агентів і відновлює початкове згасання. Його розташування та розмір не змінюються." },
  "Puts all five shortcuts back to Nook's keys, and turns them on.": { en: "Puts all five shortcuts back to Nook's keys, and turns them on.", uk: "Відновлює п’ять стандартних сполучень клавіш Nook і вмикає їх." },
  "Shows every widget again, in the order they came in.": { en: "Shows every widget again, in the order they came in.", uk: "Показує всі віджети в початковому порядку." },
  "Turn on sounds first.": { en: "Turn on sounds first.", uk: "Спочатку увімкніть звуки." },
  "Nook's log file, and the small helper program Claude Code runs": { en: "Nook's log file, and the small helper program Claude Code runs", uk: "Файл журналу Nook і допоміжна програма, яку запускає Claude Code" },
  "Last successful update: {time}{stale}": { en: "Last successful update: {time}{stale}", uk: "Останнє успішне оновлення: {time}{stale}" },
  "Stale data": { en: "Stale data", uk: "Застарілі дані" },
  "Timed out": { en: "Timed out", uk: "Час очікування вичерпано" },
  "Not authorized": { en: "Not authorized", uk: "Немає авторизації" },
  "Unexpected provider response": { en: "Unexpected provider response", uk: "Неочікувана відповідь постачальника" },
  "Codex CLI unavailable": { en: "Codex CLI unavailable", uk: "Codex CLI недоступний" },
  "Could not start Codex": { en: "Could not start Codex", uk: "Не вдалося запустити Codex" },
  "Codex provider stopped": { en: "Codex provider stopped", uk: "Постачальник Codex зупинився" },
  "Quota data unavailable": { en: "Quota data unavailable", uk: "Дані квот недоступні" },
  "Process isolation unavailable": { en: "Process isolation unavailable", uk: "Ізоляція процесу недоступна" },
  "Unknown error": { en: "Unknown error", uk: "Невідома помилка" },
  "Close": { en: "Close", uk: "Закрити" },
  "Done": { en: "Done", uk: "Завершено" },
  "Working": { en: "Working", uk: "Працює" },
  "Waiting": { en: "Waiting", uk: "Очікує" },
  "Idle": { en: "Idle", uk: "Без роботи" },
  "No active sessions": { en: "No active sessions", uk: "Немає активних сесій" },
  "No sessions": { en: "No sessions", uk: "Немає сесій" },
  "Nothing is running": { en: "Nothing is running", uk: "Зараз нічого не виконується" },

  "If active work does not appear, check the integrations in Settings.": { en: "If active work does not appear, check the integrations in Settings.", uk: "Якщо активна робота не відображається, перевірте інтеграції в налаштуваннях." },
  "No configured integrations": { en: "No configured integrations", uk: "Інтеграції не налаштовано" },
  "Integration status is unknown": { en: "Integration status is unknown", uk: "Стан інтеграцій невідомий" },
  "Integration unavailable": { en: "Integration unavailable", uk: "Інтеграція недоступна" },
  "Not configured": { en: "Not configured", uk: "Не налаштовано" },
  "Unavailable": { en: "Unavailable", uk: "Недоступно" },
  "Unknown": { en: "Unknown", uk: "Невідомо" },
  "Connected": { en: "Connected", uk: "Підключено" },
  "Project override": { en: "Project override", uk: "Перевизначення проєкту" },
  "{agent} · {status}": { en: "{agent} · {status}", uk: "{agent} · {status}" },
  "{agent} · {status} · {activity}": { en: "{agent} · {status} · {activity}", uk: "{agent} · {status} · {activity}" },
  "Hooks from a different Nook build were found; they do not connect this build.": { en: "Hooks from a different Nook build were found; they do not connect this build.", uk: "Знайдено hooks іншої збірки Nook; вони не підключають цю збірку." },
  "Some required hooks are missing. Review Connect to repair this agent.": { en: "Some required hooks are missing. Review Connect to repair this agent.", uk: "Бракує обов’язкових hooks. Перегляньте Connect, щоб виправити підключення." },
  "A configured hook points to a relay that is not available.": { en: "A configured hook points to a relay that is not available.", uk: "Налаштований hook посилається на недоступний relay." },
  "Duplicate hooks were found across configuration scopes.": { en: "Duplicate hooks were found across configuration scopes.", uk: "У різних конфігураціях знайдено дублікати hooks." },
  "An agent configuration could not be read safely.": { en: "An agent configuration could not be read safely.", uk: "Не вдалося безпечно прочитати конфігурацію агента." },
  "No hooks for this Nook build were found.": { en: "No hooks for this Nook build were found.", uk: "Hooks для цієї збірки Nook не знайдено." },
  "Agent hooks are configured for this Nook build.": { en: "Agent hooks are configured for this Nook build.", uk: "Hooks агента налаштовані для цієї збірки Nook." },
  "Disconnected": { en: "Disconnected", uk: "Відключено" },
  "No active agent sessions": { en: "No active agent sessions", uk: "Немає активних сесій агентів" },
  "Hooks not installed": { en: "Hooks not installed", uk: "Hooks не встановлено" },
  "Claude Code · isolated hook test": { en: "Claude Code · isolated hook test", uk: "Claude Code · ізольований тест хуків" },
  "Global Claude Code hooks are not installed in Nook Dev. SessionStart and SessionEnd were verified with the isolated Dev launcher. This indicator covers Claude Code hooks only; Codex lifecycle hooks remain unverified, and quota status is separate.": { en: "Global Claude Code hooks are not installed in Nook Dev. SessionStart and SessionEnd were verified with the isolated Dev launcher. This indicator covers Claude Code hooks only; Codex lifecycle hooks remain unverified, and quota status is separate.", uk: "У Nook Dev глобальні хуки Claude Code не встановлюються. Події SessionStart і SessionEnd перевірено через ізольований засіб запуску Dev. Цей індикатор стосується лише хуків Claude Code; хуки життєвого циклу Codex не перевірено, а квоти мають окремий статус." },
  "Claude Code hooks": { en: "Claude Code hooks", uk: "Хуки Claude Code" },
  "Claude Code hooks are installed": { en: "Claude Code hooks are installed", uk: "Хуки Claude Code встановлено" },
  "Claude Code hooks are not installed": { en: "Claude Code hooks are not installed", uk: "Хуки Claude Code не встановлено" },

  "Nook receives session events through the Claude Code and Codex integrations.": { en: "Nook receives session events through the Claude Code and Codex integrations.", uk: "Nook отримує події сесій через інтеграції Claude Code та Codex." },
  "Open Settings": { en: "Open Settings", uk: "Відкрити налаштування" },

  "Answer": { en: "Answer", uk: "Відповісти" },
  "Review": { en: "Review", uk: "Переглянути" },
  "Permission required": { en: "Permission required", uk: "Потрібен дозвіл" },
  "Allow": { en: "Allow", uk: "Дозволити" },
  "Deny": { en: "Deny", uk: "Відхилити" },
  "Approve": { en: "Approve", uk: "Дозволити" },
  "Decline": { en: "Decline", uk: "Відхилити" },
  "Your answer": { en: "Your answer", uk: "Ваша відповідь" },
  "Waiting for your permission": { en: "Waiting for your permission", uk: "Очікує на ваш дозвіл" },
  "Waiting for your answer": { en: "Waiting for your answer", uk: "Очікує на вашу відповідь" },

  "Fresh": { en: "Fresh", uk: "Актуальні" },
  "Stale": { en: "Stale", uk: "Застарілі" },
  "Loading": { en: "Loading", uk: "Завантаження" },
  "Disabled": { en: "Disabled", uk: "Вимкнено" },
  "Waiting for provider update": { en: "Waiting for provider update", uk: "Очікуємо на дані від постачальника" },
  "Waiting for quota update": { en: "Waiting for quota update", uk: "Очікуємо на оновлення квот" },
  "Quota data is unavailable": { en: "Quota data is unavailable", uk: "Дані про квоти недоступні" },
  "Provider is disabled": { en: "Provider is disabled", uk: "Постачальника вимкнено" },
  "No usage data yet": { en: "No usage data yet", uk: "Даних про використання ще немає" },
  "Turn on usage limits in Settings": { en: "Turn on usage limits in Settings", uk: "Увімкніть облік лімітів у налаштуваннях" },

  "Claude Code": { en: "Claude Code", uk: "Claude Code" },
  "Codex": { en: "Codex", uk: "Codex" },
  "Cursor": { en: "Cursor", uk: "Cursor" },
  "Usage only updates while Claude Code runs. Usage from claude.ai and the desktop app counts toward the same limits but isn't visible to Nook.": { en: "Usage only updates while Claude Code runs. Usage from claude.ai and the desktop app counts toward the same limits but isn't visible to Nook.", uk: "Дані про використання оновлюються лише під час роботи Claude Code. Використання claude.ai та настільного застосунку враховується в тих самих лімітах, але Nook його не бачить." },
  "Sessions waiting for you": { en: "Sessions waiting for you", uk: "Сесії, що очікують на вас" },
  "Unread notifications": { en: "Unread notifications", uk: "Непрочитані сповіщення" },
  "{waiting} waiting": { en: "{waiting} waiting", uk: "Очікують: {waiting}" },
  "{name} · {detail}": { en: "{name} · {detail}", uk: "{name} · {detail}" },
  "Reset, waiting for new data": { en: "Reset, waiting for new data", uk: "Ліміт оновлено, очікуємо на нові дані" },
  "just now": { en: "just now", uk: "щойно" },
  "Nothing playing": { en: "Nothing playing", uk: "Нічого не відтворюється" },
  "Not available": { en: "Not available", uk: "Недоступно" },
  "Unknown title": { en: "Unknown title", uk: "Назва невідома" },
  "Try again": { en: "Try again", uk: "Спробувати ще раз" },
  "The camera is busy": { en: "The camera is busy", uk: "Камера зайнята" },
  "The camera could not be started": { en: "The camera could not be started", uk: "Не вдалося запустити камеру" },
  "Waiting for the camera…": { en: "Waiting for the camera…", uk: "Очікуємо на камеру…" },
  "To-do items": { en: "To-do items", uk: "Список завдань" },
  "Time's up": { en: "Time's up", uk: "Час вийшов" },
  "Thinking…": { en: "Thinking…", uk: "Обмірковує…" },

  "Session stopped on an error.": { en: "Session stopped on an error.", uk: "Сесію зупинено через помилку." },
  "No detail available.": { en: "No detail available.", uk: "Додаткових відомостей немає." },
  "Show full reply": { en: "Show full reply", uk: "Показати повну відповідь" },
  "Show less": { en: "Show less", uk: "Згорнути" },
  "Settings…": { en: "Settings…", uk: "Налаштування…" },
  "Settings...": { en: "Settings...", uk: "Налаштування..." },
  "Close (Esc)": { en: "Close (Esc)", uk: "Закрити (Esc)" },
  "Smaller (Esc)": { en: "Smaller (Esc)", uk: "Зменшити (Esc)" },
  "Permission request": { en: "Permission request", uk: "Запит дозволу" },
  "Sessions and their subagents": { en: "Sessions and their subagents", uk: "Сесії та їхні субагенти" },
  "Session list": { en: "Session list", uk: "Список сесій" },

  "Needs You": { en: "Needs You", uk: "Потребує вашої уваги" },
  "Show question": { en: "Show question", uk: "Показати запитання" },
  "Show request": { en: "Show request", uk: "Показати запит" },
  "Show what it asks": { en: "Show what it asks", uk: "Показати запитання" },
  "Open terminal": { en: "Open terminal", uk: "Відкрити термінал" },
  "Open Claude": { en: "Open Claude", uk: "Відкрити Claude" },

  "About": { en: "About", uk: "Про застосунок" },
  "Privacy": { en: "Privacy", uk: "Приватність" },
  "General": { en: "General", uk: "Загальні" },
  "Position": { en: "Position", uk: "Розташування" },
  "When it shows and hides": { en: "When it shows and hides", uk: "Показ і приховування" },
  "Look": { en: "Look", uk: "Вигляд" },
  "Colour": { en: "Colour", uk: "Колір" },
  "Color": { en: "Color", uk: "Колір" },

  "Top": { en: "Top", uk: "Зверху" },
  "Bottom": { en: "Bottom", uk: "Знизу" },
  "Left": { en: "Left", uk: "Ліворуч" },
  "Right": { en: "Right", uk: "Праворуч" },
  "Gullu's colour": { en: "Gullu's colour", uk: "Колір Ґуллу" },
  "Gullu is the little character in the island. Choose the colour of the island's character.": { en: "Gullu is the little character in the island. Choose the colour of the island's character.", uk: "Ґуллу — персонаж острівця. Виберіть його колір." },
  "Follows your computer, which is set to dark right now. The island itself is always dark.": { en: "Follows your computer, which is set to dark right now. The island itself is always dark.", uk: "Відповідає оформленню Windows, яке зараз темне. Острівець завжди має темне оформлення." },
  "Never": { en: "Never", uk: "Ніколи" },
  "Other": { en: "Other", uk: "Інше" },
  "Work": { en: "Work", uk: "Робота" },
  "Working…": { en: "Working…", uk: "Працює…" },
  "No reminders": { en: "No reminders", uk: "Нагадувань немає" },
  "Add": { en: "Add", uk: "Додати" },
  "Delete": { en: "Delete", uk: "Видалити" },
  "Remove": { en: "Remove", uk: "Прибрати" },
  "Retry": { en: "Retry", uk: "Повторити" },
  "Continue": { en: "Continue", uk: "Продовжити" },
  "Back": { en: "Back", uk: "Назад" },
  "Next": { en: "Next", uk: "Далі" },
  "Search": { en: "Search", uk: "Пошук" },
  "Version": { en: "Version", uk: "Версія" },
  "Updated": { en: "Updated", uk: "Оновлено" },
  "Loading…": { en: "Loading…", uk: "Завантаження…" },
  "Error": { en: "Error", uk: "Помилка" },
  "Warning": { en: "Warning", uk: "Попередження" },
  "Open": { en: "Open", uk: "Відкрити" },
  "Learn more": { en: "Learn more", uk: "Докладніше" },
  "Check integrations in Settings": { en: "Check integrations in Settings", uk: "Перевірте інтеграції в налаштуваннях" },
  "No active sessions are active right now.": { en: "No active sessions are active right now.", uk: "Зараз немає активних сесій." },
  "No sessions are active right now.": { en: "No sessions are active right now.", uk: "Зараз немає активних сесій." },
  "Nook displays Claude Code and Codex sessions when their integrations report activity.": { en: "Nook displays Claude Code and Codex sessions when their integrations report activity.", uk: "Nook показує сесії Claude Code і Codex, коли їхні інтеграції повідомляють про активність." },
  "This Dev build does not inspect or install global agent integrations. Only events sent to Nook Dev appear here.": { en: "This Dev build does not inspect or install global agent integrations. Only events sent to Nook Dev appear here.", uk: "Dev-збірка не перевіряє та не встановлює глобальні інтеграції агентів. Тут відображаються лише події, надіслані до Nook Dev." },
  "No active sessions are active. When Claude Code or Codex starts a session, it will appear here.": { en: "No active sessions are active. When Claude Code or Codex starts a session, it will appear here.", uk: "Немає активних сесій. Коли Claude Code або Codex розпочне сесію, вона з’явиться тут." },
  "No sessions are active. When Claude Code or Codex starts a session, it will appear here.": { en: "No sessions are active. When Claude Code or Codex starts a session, it will appear here.", uk: "Немає активних сесій. Коли Claude Code або Codex розпочне сесію, вона з’явиться тут." },
  "Nothing running": { en: "Nothing running", uk: "Немає активної роботи" },
  "Show it": { en: "Show it", uk: "Показати сесію" },
  "Show them": { en: "Show them", uk: "Показати сесії" },
  "Hover a bot for its project and what it is doing. Click opens its session.": { en: "Hover a bot for its project and what it is doing. Click opens its session.", uk: "Наведіть вказівник на агента, щоб побачити його проєкт і роботу. Натисніть, щоб відкрити сесію." },
  "Connect to see your Claude Code sessions in the island, and to answer their permission requests without switching windows.": { en: "Connect to see your Claude Code sessions in the island, and to answer their permission requests without switching windows.", uk: "Підключіть Claude Code, щоб бачити його сесії на острівці та відповідати на запити дозволу, не перемикаючи вікна." },
  "Your Claude Code sessions show up in the island, and you can answer their questions and permission requests there.": { en: "Your Claude Code sessions show up in the island, and you can answer their questions and permission requests there.", uk: "Сесії Claude Code з’являються на острівці, де можна відповідати на запитання та запити дозволу." },
  "Hear when Claude needs you, without keeping an eye on the island.": { en: "Hear when Claude needs you, without keeping an eye on the island.", uk: "Почуйте, коли агент потребує вашої уваги, не стежачи за острівцем." },
  "Hear when an agent needs you, without keeping an eye on the island.": { en: "Hear when an agent needs you, without keeping an eye on the island.", uk: "Почуйте, коли агент потребує вашої уваги, не стежачи за острівцем." },
  "A small window that stays on top, with a row for each project Claude is working on.": { en: "A small window that stays on top, with a row for each project Claude is working on.", uk: "Невелике вікно поверх інших із рядком для кожного проєкту, над яким працює агент." },
  "A small window that stays on top, with a row for each project an agent is working on.": { en: "A small window that stays on top, with a row for each project an agent is working on.", uk: "Невелике вікно поверх інших із рядком для кожного проєкту, над яким працює агент." },
  "Link Nook to Claude Code, Cursor and Codex. Nothing on your computer is changed until you have seen the change and said yes.": { en: "Link Nook to Claude Code, Cursor and Codex. Nothing on your computer is changed until you have seen the change and said yes.", uk: "Підключіть Nook до Claude Code, Cursor і Codex. Нічого на комп’ютері не зміниться, доки ви не переглянете зміни й не підтвердите їх." },
  "Show how much of your 5-hour and weekly Claude limits you have used, right in the island.": { en: "Show how much of your 5-hour and weekly Claude limits you have used, right in the island.", uk: "Показувати на острівці використання п’ятигодинного та тижневого лімітів Claude." },
  "Claude Usage": { en: "Claude Usage", uk: "Використання Claude" },
  "Codex Usage": { en: "Codex Usage", uk: "Використання Codex" },
  "Nook's instructions for Claude Code have changed since you turned this on. Updating brings them up to date.": { en: "Nook's instructions for Claude Code have changed since you turned this on. Updating brings them up to date.", uk: "Інструкції Nook для Claude Code змінилися після ввімкнення. Оновіть їх до актуальної версії." },
  "Nook can't safely change Codex's hooks file.": { en: "Nook can't safely change Codex's hooks file.", uk: "Nook не може безпечно змінити файл hooks Codex." },
  "Nook can't safely change Cursor's settings file.": { en: "Nook can't safely change Cursor's settings file.", uk: "Nook не може безпечно змінити файл налаштувань Cursor." },
  "Nook can't safely change your Claude Code instructions file.": { en: "Nook can't safely change your Claude Code instructions file.", uk: "Nook не може безпечно змінити файл інструкцій Claude Code." },
  "Nook did not answer, so there is nothing to show here. Close this window and open it again from the island or the tray.": { en: "Nook did not answer, so there is nothing to show here. Close this window and open it again from the island or the tray.", uk: "Nook не відповів, тому тут нічого показати. Закрийте це вікно й відкрийте його знову з острівця або системного лотка." },
  "Nothing found.": { en: "Nothing found.", uk: "Нічого не знайдено." },
  "1 setting found.": { en: "1 setting found.", uk: "Знайдено 1 налаштування." },
  "A dated backup is saved first:": { en: "A dated backup is saved first:", uk: "Спочатку буде створено резервну копію з датою:" },
  "Nothing is changed until you click below.": { en: "Nothing is changed until you click below.", uk: "Нічого не зміниться, доки ви не натиснете нижче." },
  "Resetting…": { en: "Resetting…", uk: "Скидаємо…" },
  "Click again to reset": { en: "Click again to reset", uk: "Натисніть ще раз, щоб скинути" },
  "Everything here is as it came.": { en: "Everything here is as it came.", uk: "Усе повернуто до початкового стану." },
  "Changes to {file}": { en: "Changes to {file}", uk: "Зміни у файлі {file}" },
  "Nothing running right now.": { en: "Nothing running right now.", uk: "Зараз нічого не виконується." },
  "Your Claude Code sessions show up here.": { en: "Your Claude Code sessions show up here.", uk: "Тут відображаються сесії Claude Code." },
  "Dev test request · deny only": { en: "Dev test request · deny only", uk: "Тестовий запит Dev · лише відхилення" },
  "This synthetic request cannot be allowed or answered.": { en: "This synthetic request cannot be allowed or answered.", uk: "Цей синтетичний запит не можна дозволити чи підтвердити." },
  "Session finished": { en: "Session finished", uk: "Сесію завершено" },
  "Nothing written in this session yet.": { en: "Nothing written in this session yet.", uk: "У цій сесії ще немає повідомлень." },
  "The turn ended without a word.": { en: "The turn ended without a word.", uk: "Хід завершився без відповіді." },
  "Launched": { en: "Launched", uk: "Запущено" },
  "needs me": { en: "needs me", uk: "потребує моєї уваги" },
  "Other…": { en: "Other…", uk: "Інше…" },
  "Read reply": { en: "Read reply", uk: "Прочитати відповідь" },
  "Give me a sec — back to work in three seconds.": { en: "Give me a sec — back to work in three seconds.", uk: "Зачекайте мить — повернуся до роботи за три секунди." },
  "Too many hits at once.": { en: "Too many hits at once.", uk: "Забагато подій одночасно." },
  "The rest of this edit is in Claude Code": { en: "The rest of this edit is in Claude Code", uk: "Продовження редагування — у Claude Code" },
  "a subagent may be asking": { en: "a subagent may be asking", uk: "субагент може очікувати на відповідь" },
  "No system battery": { en: "No system battery", uk: "Системної батареї немає" },
  "Battery status unknown": { en: "Battery status unknown", uk: "Стан батареї невідомий" },
  "Connect charger": { en: "Connect charger", uk: "Підключіть зарядний пристрій" },
  "Low battery": { en: "Low battery", uk: "Низький заряд батареї" },
  "Critical battery": { en: "Critical battery", uk: "Критично низький заряд" },
  "Dismiss": { en: "Dismiss", uk: "Зрозуміло" },
  "Dev event simulator": { en: "Dev event simulator", uk: "Симулятор подій Dev" },
  "Two-alert controller idle. Start creates two deny-only requests through nook-hook-dev and Dev IPC.": { en: "Two-alert controller idle. Start creates two deny-only requests through nook-hook-dev and Dev IPC.", uk: "Контролер двох запитів очікує. Кнопка «Почати» створює два запити лише з відхиленням через nook-hook-dev і Dev IPC." },
  "Two-alert controller idle.": { en: "Two-alert controller idle.", uk: "Контролер двох запитів очікує." },
  "Synthetic events only. Permission buttons are local UI simulation; no agent or command is connected.": { en: "Synthetic events only. Permission buttons are local UI simulation; no agent or command is connected.", uk: "Лише синтетичні події. Кнопки дозволів імітують інтерфейс; агент чи команда не запускаються." },
  "Start Claude": { en: "Start Claude", uk: "Запустити Claude" },
  "Start Codex": { en: "Start Codex", uk: "Запустити Codex" },
  "Start both": { en: "Start both", uk: "Запустити обох" },
  "Claude: prompt + tool": { en: "Claude: prompt + tool", uk: "Claude: запит і інструмент" },
  "Codex: prompt + tool": { en: "Codex: prompt + tool", uk: "Codex: запит і інструмент" },
  "Claude: permission (8 s)": { en: "Claude: permission (8 s)", uk: "Claude: запит дозволу (8 с)" },
  "Codex: permission (8 s)": { en: "Codex: permission (8 s)", uk: "Codex: запит дозволу (8 с)" },
  "Stop Claude turn": { en: "Stop Claude turn", uk: "Зупинити хід Claude" },
  "Stop Codex turn": { en: "Stop Codex turn", uk: "Зупинити хід Codex" },
  "End Claude session": { en: "End Claude session", uk: "Завершити сесію Claude" },
  "End Codex session": { en: "End Codex session", uk: "Завершити сесію Codex" },
  "Clear simulated sessions": { en: "Clear simulated sessions", uk: "Очистити тестові сесії" },
  "Battery alerts - local Dev fixture": { en: "Battery alerts - local Dev fixture", uk: "Сповіщення батареї — локальний приклад Dev" },
  "These controls feed synthetic samples into the same Dev battery monitor. They do not create sessions or change Windows power status. Reset returns to live read-only Windows status.": { en: "These controls feed synthetic samples into the same Dev battery monitor. They do not create sessions or change Windows power status. Reset returns to live read-only Windows status.", uk: "Ці кнопки передають синтетичні значення тому самому монітору батареї Dev. Вони не створюють сесій і не змінюють стан живлення Windows. Скидання повертає поточний стан Windows лише для читання." },
  "Start at 55%": { en: "Start at 55%", uk: "Почати з 55%" },
  "Set 20%": { en: "Set 20%", uk: "Встановити 20%" },
  "Set 10%": { en: "Set 10%", uk: "Встановити 10%" },
  "Charging": { en: "Charging", uk: "Заряджається" },
  "Not charging": { en: "Not charging", uk: "Не заряджається" },
  "Battery {percent} percent, not charging": { en: "Battery {percent} percent, not charging", uk: "Заряд батареї: {percent}%, не заряджається" },
  "Battery charging": { en: "Battery charging", uk: "Батарея заряджається" },
  "Battery not charging": { en: "Battery not charging", uk: "Батарея не заряджається" },
  "100% full": { en: "100% full", uk: "Повний заряд 100%" },
  "Reset to Windows": { en: "Reset to Windows", uk: "Повернути стан Windows" },
  "Two pending alerts — real Dev IPC": { en: "Two pending alerts — real Dev IPC", uk: "Два запити дозволу — справжній Dev IPC" },
  "Creates two synthetic sessions and deny-only permission cards through nook-hook-dev. No agent or command runs. Use Status to distinguish pending, resolved and completed; Cleanup ends only this run's two IDs.": { en: "Creates two synthetic sessions and deny-only permission cards through nook-hook-dev. No agent or command runs. Use Status to distinguish pending, resolved and completed; Cleanup ends only this run's two IDs.", uk: "Створює дві синтетичні сесії та картки дозволу лише з відхиленням через nook-hook-dev. Агент чи команда не запускаються. У статусі розрізняються очікування, результат і завершення; очищення завершує лише два ID цього запуску." },
  "Start two alerts": { en: "Start two alerts", uk: "Створити два запити" },
  "Status": { en: "Status", uk: "Стан" },
  "Cleanup this run": { en: "Cleanup this run", uk: "Очистити цей запуск" },
  "Run: {runId}": { en: "Run: {runId}", uk: "Запуск: {runId}" },
  "Pending requests: {count}": { en: "Pending requests: {count}", uk: "Запити в очікуванні: {count}" },
  "{agent} {sessionId}: {request}; session {session}": { en: "{agent} {sessionId}: {request}; session {session}", uk: "{agent} {sessionId}: {request}; сесія: {session}" },
  "Cleanup errors: none": { en: "Cleanup errors: none", uk: "Помилок очищення немає" },
  "Cleanup errors: {errors}": { en: "Cleanup errors: {errors}", uk: "Помилки очищення: {errors}" },
  "{label} failed: {error}": { en: "{label} failed: {error}", uk: "Не вдалося виконати «{label}»: {error}" },
  "1 of 3 chosen": { en: "1 of 3 chosen", uk: "Вибрано 1 із 3" },
  "{count} of 3 chosen": { en: "{count} of 3 chosen", uk: "Вибрано {count} із 3" },
  "A part of Nook that Codex talks to is missing, so connecting now would not work. Restarting Nook puts it back.": { en: "A part of Nook that Codex talks to is missing, so connecting now would not work. Restarting Nook puts it back.", uk: "Компонент Nook, потрібний Codex, відсутній, тому підключення зараз не спрацює. Перезапустіть Nook, щоб відновити його." },
  "A part of Nook that Cursor talks to is missing, so connecting now would not work. Restarting Nook puts it back.": { en: "A part of Nook that Cursor talks to is missing, so connecting now would not work. Restarting Nook puts it back.", uk: "Компонент Nook, потрібний Cursor, відсутній, тому підключення зараз не спрацює. Перезапустіть Nook, щоб відновити його." },
  "Click to change": { en: "Click to change", uk: "Натисніть, щоб змінити" },
  "Colors of this window": { en: "Colors of this window", uk: "Кольори цього вікна" },
  "Details": { en: "Details", uk: "Докладніше" },
  "Drag a card to move it, or click it and use the arrow keys. Switch one off to leave it out.": { en: "Drag a card to move it, or click it and use the arrow keys. Switch one off to leave it out.", uk: "Перетягніть картку або виберіть її й пересувайте стрілками. Вимкніть картку, щоб прибрати її." },
  "Fake data": { en: "Fake data", uk: "Тестові дані" },
  "Keeps up to 500 event timings and geometry values in memory. It does not record widget names, session text, settings, or credentials.": { en: "Keeps up to 500 event timings and geometry values in memory. It does not record widget names, session text, settings, or credentials.", uk: "Зберігає в пам’яті до 500 часових і геометричних вимірів подій. Не записує назви віджетів, текст сесій, налаштування чи облікові дані." },
  "Nook": { en: "Nook", uk: "Nook" },
  "Nook's connection to Codex points at an old place. Updating fixes it.": { en: "Nook's connection to Codex points at an old place. Updating fixes it.", uk: "Підключення Nook до Codex веде за застарілим шляхом. Оновіть його." },
  "Nook's connection to Cursor points at an old place. Updating fixes it.": { en: "Nook's connection to Cursor points at an old place. Updating fixes it.", uk: "Підключення Nook до Cursor веде за застарілим шляхом. Оновіть його." },
  "Open source, under the MIT licence.": { en: "Open source, under the MIT licence.", uk: "Відкритий код за ліцензією MIT." },
  "Open the log folder": { en: "Open the log folder", uk: "Відкрити теку журналів" },
  "Pick up to three. Drag a chosen one by its handle to change the order. With none, the island is narrower. Numbers in the island preview are samples.": { en: "Pick up to three. Drag a chosen one by its handle to change the order. With none, the island is narrower. Numbers in the island preview are samples.", uk: "Виберіть до трьох показників. Перетягніть вибраний за маркер, щоб змінити порядок. Без показників острівець буде вужчим. Числа в попередньому перегляді — приклади." },
  "Source: Codex Desktop App Server": { en: "Source: Codex Desktop App Server", uk: "Джерело: Codex Desktop App Server" },
  "The Shelf tab of the island shows these in this order, and you can drag its cards there too. A widget that is off never runs: no timer, no reminder, no camera, nothing is read.": { en: "The Shelf tab of the island shows these in this order, and you can drag its cards there too. A widget that is off never runs: no timer, no reminder, no camera, nothing is read.", uk: "На вкладці Панель ці віджети показано в цьому порядку; там картки також можна перетягувати. Вимкнений віджет не запускається: таймер, нагадування чи камера не працюють, дані не читаються." },
  "The island can show how much of your 5-hour and weekly Claude limits you have used.": { en: "The island can show how much of your 5-hour and weekly Claude limits you have used.", uk: "Острівець може показувати використання п’ятигодинного та тижневого лімітів Claude." },
  "There is no file to back up: it is created.": { en: "There is no file to back up: it is created.", uk: "Файлу для резервної копії ще немає — його буде створено." },
  "What the compact island shows": { en: "What the compact island shows", uk: "Що показує компактний острівець" },
  "Widgets": { en: "Widgets", uk: "Віджети" },
  "With Gullu, Nook's buddy": { en: "With Gullu, Nook's buddy", uk: "Разом із Ґуллу, другом Nook" },
  "Your Claude Code instructions already ask for a reply layout of their own, so Nook leaves them alone.": { en: "Your Claude Code instructions already ask for a reply layout of their own, so Nook leaves them alone.", uk: "В інструкціях Claude Code уже задано власний формат відповіді, тому Nook їх не змінює." },
  "Coming next": { en: "Coming next", uk: "Незабаром" },
  "Every widget is hidden.": { en: "Every widget is hidden.", uk: "Усі віджети приховано." },
  "Turn some on in Settings → Shelf.": { en: "Turn some on in Settings → Shelf.", uk: "Увімкніть віджети в Налаштування → Панель." },
  "Coming up": { en: "Coming up", uk: "Найближчі події" },
  "Nothing coming up": { en: "Nothing coming up", uk: "Нічого не заплановано" },
  "No reminders yet": { en: "No reminders yet", uk: "Нагадувань поки немає" },
  "Reminders fire only while Nook is running. Click a reminder's words or its time to edit.": { en: "Reminders fire only while Nook is running. Click a reminder's words or its time to edit.", uk: "Нагадування спрацьовують, лише коли Nook запущено. Натисніть текст або час нагадування, щоб змінити його." },
  "Notes": { en: "Notes", uk: "Нотатки" },
  "Nothing to do": { en: "Nothing to do", uk: "Немає завдань" },
  "Camera off. It only runs while Mirror is open.": { en: "Camera off. It only runs while Mirror is open.", uk: "Камеру вимкнено. Вона працює лише коли відкрито Дзеркало." },
  "Turn camera on": { en: "Turn camera on", uk: "Увімкнути камеру" },
  "Folders your Claude Code sessions have run in. Nothing is launched but the folder you press.": { en: "Folders your Claude Code sessions have run in. Nothing is launched but the folder you press.", uk: "Теки, у яких працювали сесії Claude Code. Запускається лише вибрана вами тека." },
  "No folders yet. They appear as Claude Code sessions run.": { en: "No folders yet. They appear as Claude Code sessions run.", uk: "Тек поки немає. Вони з’являться після запуску сесій Claude Code." },
  "No folders yet": { en: "No folders yet", uk: "Тек поки немає" },
  "Back to the Shelf (Esc, or swipe right)": { en: "Back to the Shelf (Esc, or swipe right)", uk: "Назад до Панелі (Esc або проведіть праворуч)" },
  "Expand {name}": { en: "Expand {name}", uk: "Розгорнути: {name}" },
  "Nothing is playing": { en: "Nothing is playing", uk: "Нічого не відтворюється" },
  "Play / pause": { en: "Play / pause", uk: "Відтворити / призупинити" },
  "Play or pause": { en: "Play or pause", uk: "Відтворити або призупинити" },
  "Volume": { en: "Volume", uk: "Гучність" },
  "Next track": { en: "Next track", uk: "Наступний трек" },
  "Mark as done": { en: "Mark as done", uk: "Позначити виконаним" },
  "Mark as not done": { en: "Mark as not done", uk: "Позначити невиконаним" },
  "Change the time": { en: "Change the time", uk: "Змінити час" },
  "A time of your own, in minutes": { en: "A time of your own, in minutes", uk: "Власний час у хвилинах" },
  "Custom time in minutes": { en: "Custom time in minutes", uk: "Власний час у хвилинах" },
  "Set": { en: "Set", uk: "Встановити" },
  "Edit": { en: "Edit", uk: "Змінити" },
  "Reminder": { en: "Reminder", uk: "Нагадування" },
  "When": { en: "When", uk: "Коли" },
  "New": { en: "New", uk: "Нове" },
  "Edited": { en: "Edited", uk: "Змінено" },
  "Jump to latest": { en: "Jump to latest", uk: "Перейти до останнього" },
  "Hide its subagents": { en: "Hide its subagents", uk: "Приховати субагентів" },
  "Show its subagents": { en: "Show its subagents", uk: "Показати субагентів" },
  "Waiting for an answer…": { en: "Waiting for an answer…", uk: "Очікує на відповідь…" },
  "Left unanswered.": { en: "Left unanswered.", uk: "Без відповіді." },
  "Answered in Claude Code.": { en: "Answered in Claude Code.", uk: "Отримано відповідь у Claude Code." },
  "Still running": { en: "Still running", uk: "Ще працює" },
  "Still running · ": { en: "Still running · ", uk: "Ще працює · " },
  "Its result will show here when it finishes.": { en: "Its result will show here when it finishes.", uk: "Результат з’явиться тут після завершення." },
  "Stopped without finishing": { en: "Stopped without finishing", uk: "Зупинено до завершення" },
  "This subagent's steps cannot be told apart on this version of Claude Code.": { en: "This subagent's steps cannot be told apart on this version of Claude Code.", uk: "У цій версії Claude Code неможливо відокремити кроки цього субагента." },
  "Its tool events carry no agent id, so they are in the main journal, among the session's own steps, in the order they happened.": { en: "Its tool events carry no agent id, so they are in the main journal, among the session's own steps, in the order they happened.", uk: "Події його інструментів не містять ID агента, тому вони відображаються в основному журналі серед кроків сесії у фактичному порядку." },
  "Open the main journal": { en: "Open the main journal", uk: "Відкрити основний журнал" },
  "Nothing has happened in this session yet.": { en: "Nothing has happened in this session yet.", uk: "У цій сесії ще нічого не відбулося." },
  "No Claude Code session yet.": { en: "No Claude Code session yet.", uk: "Сесії Claude Code поки немає." },
  "Nothing has happened in this session yet": { en: "Nothing has happened in this session yet", uk: "У цій сесії ще нічого не відбулося" },
  "Claude needs an answer.": { en: "Claude needs an answer.", uk: "Claude очікує на відповідь." },
  "Leave this question unanswered": { en: "Leave this question unanswered", uk: "Залишити запитання без відповіді" },
  "Skip": { en: "Skip", uk: "Пропустити" },
  "Sound": { en: "Sound", uk: "Звук" },
  "Settings categories": { en: "Settings categories", uk: "Розділи налаштувань" },
  "Clear the search": { en: "Clear the search", uk: "Очистити пошук" },
  "Clear (Esc)": { en: "Clear (Esc)", uk: "Очистити (Esc)" },
  "Search settings (/ )": { en: "Search settings (/ )", uk: "Пошук у налаштуваннях (/ )" },
  "Press the new keys…": { en: "Press the new keys…", uk: "Натисніть нове сполучення клавіш…" },
  "+ a key…": { en: "+ a key…", uk: "+ клавіша…" },
  "Move {name}. Use the up and down arrows.": { en: "Move {name}. Use the up and down arrows.", uk: "Перемістити «{name}». Скористайтеся стрілками вгору та вниз." },
  "Drag to reorder": { en: "Drag to reorder", uk: "Перетягніть, щоб змінити порядок" },
  "Close after, in seconds": { en: "Close after, in seconds", uk: "Згортати через (секунди)" },
  "seconds, from 2 to 120": { en: "seconds, from 2 to 120", uk: "секунд, від 2 до 120" },
  "Colours of this window": { en: "Colours of this window", uk: "Кольори цього вікна" },
  "Open Settings…": { en: "Open Settings…", uk: "Відкрити налаштування…" },
  "Pending": { en: "Pending", uk: "Очікує" },
  "Resolved (ExplicitDeny)": { en: "Resolved (ExplicitDeny)", uk: "Завершено (явне відхилення)" },
  "Active": { en: "Active", uk: "Активна" },
  "Completed (SessionEnd delivered through Dev IPC)": { en: "Completed (SessionEnd delivered through Dev IPC)", uk: "Завершена (SessionEnd доставлено через Dev IPC)" },
  "Completed": { en: "Completed", uk: "Завершено" },
  "Where the island sits on your screen, when it gets out of the way, and what it shows.": { en: "Where the island sits on your screen, when it gets out of the way, and what it shows.", uk: "Розташування острівця, умови його згортання та вміст." },
  "Gullu's colour, the colours of this window, and how lively things are.": { en: "Gullu's colour, the colours of this window, and how lively things are.", uk: "Колір Ґуллу, оформлення цього вікна та анімація." },
  "Key combinations that work from any app. Click one, then press the new keys.": { en: "Key combinations that work from any app. Click one, then press the new keys.", uk: "Сполучення клавіш, доступні в будь-якому застосунку. Натисніть поле та введіть нове сполучення." },
  "The small tools in the island's Shelf tab: which ones are on, and their order.": { en: "The small tools in the island's Shelf tab: which ones are on, and their order.", uk: "Віджети на вкладці Панель: які ввімкнено та в якому порядку." },
  "Nook keeps everything on this computer. Here is where, and who made it.": { en: "Nook keeps everything on this computer. Here is where, and who made it.", uk: "Nook зберігає всі дані на цьому комп’ютері. Тут можна дізнатися, де саме та ким створено застосунок." },
  "Click one, then press the new keys.": { en: "Click one, then press the new keys.", uk: "Натисніть поле, а потім введіть нове сполучення клавіш." },
  "Start Nook with your computer": { en: "Start Nook with your computer", uk: "Запускати Nook разом із Windows" },
  "Show the island on": { en: "Show the island on", uk: "Де показувати острівець" },
  "Main screen": { en: "Main screen", uk: "Основний екран" },
  "Screen with the pointer": { en: "Screen with the pointer", uk: "Екран із вказівником" },
  "Screen edge": { en: "Screen edge", uk: "Край екрана" },
  "Close the open island after": { en: "Close the open island after", uk: "Згортати розгорнутий острівець через" },
  "Hide the compact island after": { en: "Hide the compact island after", uk: "Приховувати компактний острівець через" },
  "Keep it showing while a session is busy": { en: "Keep it showing while a session is busy", uk: "Не приховувати, поки сесія працює" },
  "Hide during full-screen apps": { en: "Hide during full-screen apps", uk: "Приховувати в повноекранних застосунках" },
  "Show the island on the main screen": { en: "Show the island on the main screen", uk: "Показувати острівець на основному екрані" },
  "For example: sound, dark, bottom, startup or shortcut.": { en: "For example: sound, dark, bottom, startup or shortcut.", uk: "Наприклад: звук, темна тема, знизу, запуск або сполучення клавіш." },
  "Search settings": { en: "Search settings", uk: "Пошук у налаштуваннях" },
  "Set a keyboard shortcut for the list": { en: "Set a keyboard shortcut for the list", uk: "Призначити сполучення клавіш для списку" },
  "Shelf resize diagnostics (Dev only)": { en: "Shelf resize diagnostics (Dev only)", uk: "Діагностика зміни розміру Панелі (лише Dev)" },
  "Start UI trace": { en: "Start UI trace", uk: "Почати запис UI trace" },
  "Copy UI trace": { en: "Copy UI trace", uk: "Копіювати UI trace" },
  "Stop UI trace": { en: "Stop UI trace", uk: "Зупинити UI trace" },
  "Island and Home render diagnostics (Dev only)": { en: "Island and Home render diagnostics (Dev only)", uk: "Діагностика відображення Острівця та Home (лише Dev)" },
  "Start the trace, open and close Expanded Home twice, then return here and copy it. Keeps up to 500 event timings, locale tags, mutation counts, and geometry values in memory; never records visible text, session data, settings, or credentials.": { en: "Start the trace, open and close Expanded Home twice, then return here and copy it. Keeps up to 500 event timings, locale tags, mutation counts, and geometry values in memory; never records visible text, session data, settings, or credentials.", uk: "Почніть trace, двічі відкрийте й закрийте розгорнутий Home, потім поверніться сюди та скопіюйте його. У пам’яті зберігаються до 500 часових позначок, локаль, кількість змін DOM і геометрія; видимий текст, дані сесій, налаштування та облікові дані не записуються." },
  "Connect to Claude Code, Cursor and Codex.": { en: "Connect to Claude Code, Cursor and Codex.", uk: "Підключення до Claude Code, Cursor і Codex." },
  "The island itself is always dark.": { en: "The island itself is always dark.", uk: "Острівець завжди має темне оформлення." },
  "No agents running": { en: "No agents running", uk: "Агенти не працюють" },
  "Hide": { en: "Hide", uk: "Приховати" },
  "Hide the agents list": { en: "Hide the agents list", uk: "Приховати список агентів" },
  "5-hour limit": { en: "5-hour limit", uk: "Ліміт на 5 годин" },
  "7-day limit": { en: "7-day limit", uk: "Ліміт на 7 днів" },
  "WAIT": { en: "WAIT", uk: "ОЧІКУЄ" },
  "WORK": { en: "WORK", uk: "ПРАЦЮЄ" },
  "DONE": { en: "DONE", uk: "ГОТОВО" },
  "IDLE": { en: "IDLE", uk: "БЕЗ РОБОТИ" },
  "Setup": { en: "Setup", uk: "Підключення" },
  "Extras": { en: "Extras", uk: "Додатково" },
  "The list": { en: "The list", uk: "Список" },
  "Moving it": { en: "Moving it", uk: "Переміщення та розмір" },
  "Play sounds": { en: "Play sounds", uk: "Відтворювати звуки" },
  "A short sound when a session needs you or has finished.": { en: "A short sound when a session needs you or has finished.", uk: "Короткий звук, коли сесія потребує уваги або завершується." },
  "How loud the sounds are.": { en: "How loud the sounds are.", uk: "Гучність звуків." },
  "Fade when not in use": { en: "Fade when not in use", uk: "Згортати, коли не використовується" },
  "It dims a few seconds after your pointer leaves it, but never while something waits for you.": { en: "It dims a few seconds after your pointer leaves it, but never while something waits for you.", uk: "Список тьмяніє за кілька секунд після того, як вказівник залишає його, але не тоді, коли агент чекає на вас." },
  "How visible when faded": { en: "How visible when faded", uk: "Видимість у згорнутому стані" },
  "How much of the list still shows while it is faded.": { en: "How much of the list still shows while it is faded.", uk: "Наскільки чітко видно список у згорнутому стані." },
  "Move and size it with the mouse": { en: "Move and size it with the mouse", uk: "Переміщення та зміна розміру мишею" },
  "Drag its header to move it. Drag its sides to change its width, and its bottom edge to set how tall it may grow. Double-click its header to put the size back.": { en: "Drag its header to move it. Drag its sides to change its width, and its bottom edge to set how tall it may grow. Double-click its header to put the size back.", uk: "Перетягніть заголовок, щоб перемістити список. Перетягніть краї, щоб змінити ширину, а нижній край — щоб задати максимальну висоту. Двічі клацніть заголовок, щоб відновити розмір." },
  "Each project's state, latest activity and, when available, an estimate of context-window use. Click a row to open its window. The list never takes the keyboard.": { en: "Each project's state, latest activity and, when available, an estimate of context-window use. Click a row to open its window. The list never takes the keyboard.", uk: "Стан кожного проєкту, остання активність і, якщо доступно, приблизне використання контексту. Натисніть рядок, щоб відкрити вікно. Список не перехоплює клавіатуру." },
  "Agents, one row per project": { en: "Agents, one row per project", uk: "Агенти: окремий рядок для кожного проєкту" },
  "Local time": { en: "Local time", uk: "Місцевий час" },
  "Claude": { en: "Claude", uk: "Claude" },
  "Connect Claude Code to Nook: see your sessions in the island and answer them there.": { en: "Connect Claude Code to Nook: see your sessions in the island and answer them there.", uk: "Підключіть Claude Code до Nook, щоб бачити його сесії на острівці та відповідати на запити там." },
  "Show how much of your 5-hour and weekly Claude limits you have used.": { en: "Show how much of your 5-hour and weekly Claude limits you have used.", uk: "Показувати використання п’ятигодинного та тижневого лімітів Claude." },
  "Reply layout": { en: "Reply layout", uk: "Формат відповіді" },
  "Codex quota diagnostics": { en: "Codex quota diagnostics", uk: "Діагностика квот Codex" },
  "Codex's sessions appear in the island with a Codex mark. Off, they are not followed at all, and Codex asks for permission in its own window.": { en: "Codex's sessions appear in the island with a Codex mark. Off, they are not followed at all, and Codex asks for permission in its own window.", uk: "Сесії Codex відображаються на острівці зі значком Codex. Якщо вимкнути цей параметр, Nook не відстежуватиме їх; Codex показуватиме запити дозволу у власному вікні." },
  "Off by default. When enabled, Nook Dev starts Codex Desktop's App Server using the inherited CODEX_HOME (or its normal user profile). It may read Codex configuration, make network requests, and update Codex service files. Nook does not copy credentials or call login/logout.": { en: "Off by default. When enabled, Nook Dev starts Codex Desktop's App Server using the inherited CODEX_HOME (or its normal user profile). It may read Codex configuration, make network requests, and update Codex service files. Nook does not copy credentials or call login/logout.", uk: "Вимкнено за замовчуванням. Після ввімкнення Nook Dev запускає Codex Desktop App Server із успадкованим CODEX_HOME або звичайним профілем користувача. Сервер може читати конфігурацію Codex, звертатися до мережі та оновлювати службові файли Codex. Nook не копіює облікові дані й не виконує вхід або вихід." },
  "Codex quota provider": { en: "Codex quota provider", uk: "Постачальник квот Codex" },
  "Cursor's sessions appear in the island with a Cursor mark. Off, they are not followed at all.": { en: "Cursor's sessions appear in the island with a Cursor mark. Off, they are not followed at all.", uk: "Сесії Cursor відображаються на острівці зі значком Cursor. Якщо вимкнути цей параметр, Nook не відстежуватиме їх." },
  "Sessions": { en: "Sessions", uk: "Сесії" },
  "A short sound when an agent needs you or has finished.": { en: "A short sound when an agent needs you or has finished.", uk: "Короткий звук, коли агент потребує уваги або завершує роботу." },
  "Show Codex sessions": { en: "Show Codex sessions", uk: "Показувати сесії Codex" },
  "Show Cursor sessions": { en: "Show Cursor sessions", uk: "Показувати сесії Cursor" },
  "Allow Codex quota access": { en: "Allow Codex quota access", uk: "Дозволити доступ до квот Codex" },
  "Allow Nook to read Codex quota windows from its local App Server.": { en: "Allow Nook to read Codex quota windows from its local App Server.", uk: "Дозволити Nook читати вікна квот Codex через локальний App Server." },
  "Clipboard unavailable. Try again while the Settings window is focused.": { en: "Clipboard unavailable. Try again while the Settings window is focused.", uk: "Буфер обміну недоступний. Спробуйте ще раз, коли вікно налаштувань активне." },
  "Start Shelf trace": { en: "Start Shelf trace", uk: "Почати запис діагностики Панелі" },
  "Copy Shelf trace": { en: "Copy Shelf trace", uk: "Копіювати діагностику Панелі" },
  "Stop Shelf trace": { en: "Stop Shelf trace", uk: "Зупинити запис діагностики Панелі" },
  "Check now": { en: "Check now", uk: "Перевірити зараз" },
  "Get it…": { en: "Get it…", uk: "Завантажити…" },
  "Check for updates every day": { en: "Check for updates every day", uk: "Щодня перевіряти оновлення" },
  "Once a day, Nook asks GitHub whether a newer version is out, and tells you here and in the island. It sends nothing about you. Off, Nook never connects to the internet by itself.": { en: "Once a day, Nook asks GitHub whether a newer version is out, and tells you here and in the island. It sends nothing about you. Off, Nook never connects to the internet by itself.", uk: "Раз на день Nook запитує GitHub про нову версію та повідомляє вас тут і на острівці. Дані про вас не надсилаються. Якщо вимкнути перевірку, Nook самостійно не підключатиметься до інтернету." },
  "Updates": { en: "Updates", uk: "Оновлення" },
  "Nook sends nothing anywhere, and tracks nothing. It uses the internet for one thing only, and only if you ask: checking whether a newer version is out. Everything else stays on this computer.": { en: "Nook sends nothing anywhere, and tracks nothing. It uses the internet for one thing only, and only if you ask: checking whether a newer version is out. Everything else stays on this computer.", uk: "Nook нічого не надсилає та не відстежує. Інтернет використовується лише на ваш запит — щоб перевірити наявність нової версії. Усе інше залишається на цьому комп’ютері." },
  "Where your things are kept": { en: "Where your things are kept", uk: "Де зберігаються дані" },
  "Made by": { en: "Made by", uk: "Автор" },
  "Nothing here is read from or written to this machine.": { en: "Nothing here is read from or written to this machine.", uk: "З цього комп’ютера нічого не зчитується й на нього нічого не записується." },
  "Needs a restart": { en: "Needs a restart", uk: "Потрібен перезапуск" },
  "Needs an update": { en: "Needs an update", uk: "Потрібне оновлення" },
  "Can't be changed": { en: "Can't be changed", uk: "Не вдалося змінити" },
  "You have your own": { en: "You have your own", uk: "Ви вже маєте власний формат" },
  "The check could not be made.": { en: "The check could not be made.", uk: "Не вдалося виконати перевірку." },
  "Window not found": { en: "Window not found", uk: "Вікно не знайдено" },
  "Reset": { en: "Reset", uk: "Скинути" },
  "Every file this session changed": { en: "Every file this session changed", uk: "Усі файли, змінені цією сесією" },
  "Back to the main session": { en: "Back to the main session", uk: "Назад до головної сесії" },
  "Changes": { en: "Changes", uk: "Зміни" },
  "Show sessions of": { en: "Show sessions of", uk: "Показувати сесії" },
  "Other sessions waiting for an answer": { en: "Other sessions waiting for an answer", uk: "Інші сесії очікують на відповідь" },
  "Home: your sessions": { en: "Home: your sessions", uk: "Головна: ваші сесії" },
  "Shelf: your widgets": { en: "Shelf: your widgets", uk: "Панель: ваші віджети" },
  "Mute": { en: "Mute", uk: "Вимкнути звук" },
  "‹ Previous": { en: "‹ Previous", uk: "‹ Назад" },
  "Camera preview": { en: "Camera preview", uk: "Попередній перегляд камери" },
  "Camera off": { en: "Camera off", uk: "Камеру вимкнено" },
  "Nothing is recorded or saved. The camera stops the moment you leave this view.": { en: "Nothing is recorded or saved. The camera stops the moment you leave this view.", uk: "Відео не записується та не зберігається. Камера вимикається, щойно ви залишаєте цей екран." },
  "Project folders": { en: "Project folders", uk: "Теки проєктів" },
  "Reminders": { en: "Reminders", uk: "Нагадування" },
  "Time": { en: "Time", uk: "Час" },
  "Presets": { en: "Presets", uk: "Швидкий вибір" },
  "min": { en: "min", uk: "хв" },
  "Notes…": { en: "Notes…", uk: "Нотатки…" },
  "Reply": { en: "Reply", uk: "Відповісти" },
  "Send": { en: "Send", uk: "Надіслати" },
  "Send (Enter)": { en: "Send (Enter)", uk: "Надіслати (Enter)" },
  "Nook types it into the window this session runs in, and the conversation carries on there. In a terminal with tabs, this session's tab has to be the one showing.": { en: "Nook types it into the window this session runs in, and the conversation carries on there. In a terminal with tabs, this session's tab has to be the one showing.", uk: "Nook вводить відповідь у вікно цієї сесії, де й продовжується розмова. У терміналі з вкладками потрібна активна вкладка цієї сесії." },
  "Send a reply": { en: "Send a reply", uk: "Надіслати відповідь" },
  "Stop": { en: "Stop", uk: "Зупинити" },
  "Battery status": { en: "Battery status", uk: "Стан батареї" },
  "Note": { en: "Note", uk: "Примітка" },
  "Tip": { en: "Tip", uk: "Порада" },
  "Important": { en: "Important", uk: "Важливо" },
  "Caution": { en: "Caution", uk: "Обережно" },
  "Off": { en: "Off", uk: "Вимкнено" },
  "On": { en: "On", uk: "Увімкнено" },
  "Previous": { en: "Previous", uk: "Назад" },
  "Previous track": { en: "Previous track", uk: "Попередній трек" },
  "Island": { en: "Island", uk: "Острівець" },
  "Sessions and approvals": { en: "Sessions and approvals", uk: "Сесії та запити дозволу" },
  "Your sessions and what they ask, your usage limits, and how replies are laid out.": { en: "Your sessions and what they ask, your usage limits, and how replies are laid out.", uk: "Ваші сесії та їхні запити, ліміти використання й формат відповідей." },
  "Its sessions, and Allow or Deny for what it asks permission for.": { en: "Its sessions, and Allow or Deny for what it asks permission for.", uk: "Сесії Codex і можливість дозволити або відхилити його запити дозволу." },
  "Shows your Codex sessions in the island too, and lets you allow or deny what Codex asks permission for.": { en: "Shows your Codex sessions in the island too, and lets you allow or deny what Codex asks permission for.", uk: "Показує сесії Codex на острівці та дає змогу дозволяти чи відхиляти його запити дозволу." },
  "Shows your Cursor agent sessions in the island too. Nook can only show them: it can't answer anything in Cursor.": { en: "Shows your Cursor agent sessions in the island too. Nook can only show them: it can't answer anything in Cursor.", uk: "Також показує сесії агентів Cursor на острівці. Nook лише відображає їх і не може відповідати на запити Cursor." },
  "Asks Claude Code to lay out its answers the same way each time — a summary first, then what it needs you to decide, its warnings and its tips — so Nook can point them out.": { en: "Asks Claude Code to lay out its answers the same way each time — a summary first, then what it needs you to decide, its warnings and its tips — so Nook can point them out.", uk: "Просить Claude Code оформлювати відповіді однаково: спершу підсумок, потім рішення для вас, застереження та поради. Так Nook може окремо їх показати." },
  "Nook adds a short block, between two marker lines, to your CLAUDE.md (the instructions Claude Code reads in every session). Nothing outside the block is touched. Applies to new sessions.": { en: "Nook adds a short block, between two marker lines, to your CLAUDE.md (the instructions Claude Code reads in every session). Nothing outside the block is touched. Applies to new sessions.", uk: "Nook додає короткий блок між двома позначками у CLAUDE.md — інструкціях, які Claude Code читає в кожній сесії. Решта файлу не змінюється. Діє для нових сесій." },
  "Updating replaces what is between the two marker lines in your CLAUDE.md, and nothing else. Applies to new sessions.": { en: "Updating replaces what is between the two marker lines in your CLAUDE.md, and nothing else. Applies to new sessions.", uk: "Оновлення замінює лише текст між двома позначками у CLAUDE.md. Решта файлу не змінюється. Діє для нових сесій." },
  "Enter sends, Shift+Enter starts a new line.": { en: "Enter sends, Shift+Enter starts a new line.", uk: "Enter надсилає відповідь, Shift+Enter додає новий рядок." },
  "{name} is reset.": { en: "{name} is reset.", uk: "«{name}» скинуто." },
  "Click again to reset {name}.": { en: "Click again to reset {name}.", uk: "Натисніть ще раз, щоб скинути «{name}»." },
  "{count} more": { en: "{count} more", uk: "Ще {count}" },
  "Context {percent}%": { en: "Context {percent}%", uk: "Контекст: {percent}%" },
  "Resets {time} (local time)": { en: "Resets {time} (local time)", uk: "Скидання о {time} (місцевий час)" },
  "Last successful update: {time}": { en: "Last successful update: {time}", uk: "Останнє успішне оновлення: {time}" },
  "Failure reason: {reason}": { en: "Failure reason: {reason}", uk: "Причина помилки: {reason}" },
  "{count} of {total} chosen": { en: "{count} of {total} chosen", uk: "Вибрано {count} із {total}" },
  "{shown} of {total} on": { en: "{shown} of {total} on", uk: "Увімкнено {shown} із {total}" },
  "Copied {count} trace events.": { en: "Copied {count} trace events.", uk: "Скопійовано подій діагностики: {count}." },
  "{name}: {place}. Opens in your browser.": { en: "{name}: {place}. Opens in your browser.", uk: "{name}: {place}. Відкривається у браузері." },
  "Not receiving Claude Code events: {reason}": { en: "Not receiving Claude Code events: {reason}", uk: "Події Claude Code не надходять: {reason}" },
  "In {section}. Open it.": { en: "In {section}. Open it.", uk: "Розділ «{section}». Відкрити." },
  "Open {section}": { en: "Open {section}", uk: "Відкрити: {section}" },
  "{percent} used": { en: "{percent} used", uk: "Використано {percent}" },
  "Lines found in {file}": { en: "Lines found in {file}", uk: "Знайдені рядки у файлі {file}" },
  "Nothing would change: {file} already says this.": { en: "Nothing would change: {file} already says this.", uk: "Змін не буде: у файлі {file} уже вказано потрібне." },
  "{action} Nothing is changed until you click below.": { en: "{action} Nothing is changed until you click below.", uk: "{action}. Зміни набудуть чинності лише після натискання нижче." },
  "{count} trace events": { en: "{count} trace events", uk: "Подій діагностики: {count}" },
  "Preview of the compact island, with sample values: {metrics}": { en: "Preview of the compact island, with sample values: {metrics}", uk: "Попередній вигляд компактного острівця зі зразками: {metrics}" },
  "Gullu · sessions — no numbers, so the island is narrower": { en: "Gullu · sessions — no numbers, so the island is narrower", uk: "Ґуллу · сесії — без показників острівець вужчий" },
  "Reply to {session}…": { en: "Reply to {session}…", uk: "Відповісти сесії «{session}»…" },
  "Sending to {session}…": { en: "Sending to {session}…", uk: "Надсилаємо до сесії «{session}»…" },
  "Enter sends, Shift+Enter starts a new line. {details}": { en: "Enter sends, Shift+Enter starts a new line. {details}", uk: "Enter надсилає відповідь, Shift+Enter додає рядок. {details}" },
  "+{count} waiting": { en: "+{count} waiting", uk: "+{count} очікують" },
  "1 of {count}": { en: "1 of {count}", uk: "1 із {count}" },
  "{count} requests are waiting: the oldest first": { en: "{count} requests are waiting: the oldest first", uk: "Очікують запити: {count}. Спершу показано найстаріший." },
  "Too long to review here. Answer it in {agent}.": { en: "Too long to review here. Answer it in {agent}.", uk: "Запит завеликий для перегляду тут. Відповідайте у вікні {agent}." },
  "Answer in {agent}": { en: "Answer in {agent}", uk: "Відповісти у {agent}" },
  "Next: {who} · {what}": { en: "Next: {who} · {what}", uk: "Далі: {who} · {what}" },
  "({kind}) of": { en: "({kind}) of", uk: "({kind}) проєкту" },
  "A {kind} of": { en: "A {kind} of", uk: "{kind} проєкту" },
  "{count} seconds": { en: "{count} seconds", uk: "{count} с" },
  "Auto-close · {seconds}s": { en: "Auto-close · {seconds}s", uk: "Автозгортання · {seconds} с" },
  "{count} folder{plural}": { en: "{count} folder{plural}", uk: "Тек: {count}{plural}" },
  "{count} coming up": { en: "{count} coming up", uk: "Найближчих подій: {count}" },
  "{minutes} min": { en: "{minutes} min", uk: "{minutes} хв" },
  "{left} to do · {done} done": { en: "{left} to do · {done} done", uk: "Залишилося {left} · виконано {done}" },
  "Remove {name}": { en: "Remove {name}", uk: "Прибрати «{name}»" },
  "Battery {percent} percent, charging": { en: "Battery {percent} percent, charging", uk: "Заряд батареї: {percent}%, заряджається" },
  "Battery {percent} percent": { en: "Battery {percent} percent", uk: "Заряд батареї: {percent}%" },
  "{percent}%. Connect the charger.": { en: "{percent}%. Connect the charger.", uk: "{percent}%. Підключіть зарядний пристрій." },
  "No step of this kind in this {kind}{suffix}.": { en: "No step of this kind in this {kind}{suffix}.", uk: "У цій {kind} таких кроків немає{suffix}." },
  "No step yet.": { en: "No step yet.", uk: "Кроків поки немає." },
  "1 file changed": { en: "1 file changed", uk: "Змінено 1 файл" },
  "{count} files changed": { en: "{count} files changed", uk: "Змінено файлів: {count}" },
  "Usage limits": { en: "Usage limits", uk: "Ліміти використання" },
  "Zubair Bin Shaukat's links": { en: "Zubair Bin Shaukat's links", uk: "Посилання Zubair Bin Shaukat" },
  "The island": { en: "The island", uk: "Острівець" },
  "Show the agents list": { en: "Show the agents list", uk: "Показувати список агентів" },
  "Which screen it appears on, when you have more than one.": { en: "Which screen it appears on, when you have more than one.", uk: "На якому екрані показувати острівець, якщо їх кілька." },
  "The island sits along this edge of the screen, clear of the taskbar. On the left or right it stands upright.": { en: "The island sits along this edge of the screen, clear of the taskbar. On the left or right it stands upright.", uk: "Острівець розташовується біля цього краю екрана, не перекриваючи панель завдань. Біля лівого чи правого краю він стає вертикальним." },
  "Nook opens by itself when you sign in.": { en: "Nook opens by itself when you sign in.", uk: "Nook запускається автоматично після входу у Windows." },
  "How long it stays open once your pointer has left it.": { en: "How long it stays open once your pointer has left it.", uk: "Як довго острівець залишається розгорнутим після того, як вказівник залишив його." },
  "How long the small, closed island stays once your pointer has left it. It comes back when you point at its edge, or when a session does something.": { en: "How long the small, closed island stays once your pointer has left it. It comes back when you point at its edge, or when a session does something.", uk: "Як довго компактний острівець залишається видимим після відведення вказівника. Він з’явиться знову, коли ви наведете на його край або сесія надішле подію." },
  "The hide timer starts only once no session is working, thinking or asking.": { en: "The hide timer starts only once no session is working, thinking or asking.", uk: "Таймер приховування запускається, лише коли жодна сесія не працює, не обробляє запит і не очікує на вас." },
  "Stays out of the way of videos, games and presentations. Questions and permission requests still show.": { en: "Stays out of the way of videos, games and presentations. Questions and permission requests still show.", uk: "Не заважає відео, іграм і презентаціям. Запитання та дозволи й далі відображаються." },
  "Gullu follows your mouse and reacts to clicks. Off, Gullu only shows how your sessions are doing.": { en: "Gullu follows your mouse and reacts to clicks. Off, Gullu only shows how your sessions are doing.", uk: "Ґуллу рухається за вказівником і реагує на натискання. Якщо вимкнути анімацію, він лише показуватиме стан сесій." },
  "Playful Gullu": { en: "Playful Gullu", uk: "Жвавий Ґуллу" },
  "This window": { en: "This window", uk: "Це вікно" },
  "Motion": { en: "Motion", uk: "Анімація" },
  "Reduce motion": { en: "Reduce motion", uk: "Зменшити анімацію" },
  "Things in Nook change at once, without sliding or fading.": { en: "Things in Nook change at once, without sliding or fading.", uk: "Елементи Nook змінюються одразу, без зсувів і згасання." },
  "Shelf widgets, in their order": { en: "Shelf widgets, in their order", uk: "Віджети Панелі в заданому порядку" },
  "Needs you": { en: "Needs you", uk: "Потребує уваги" },
  "at rest": { en: "at rest", uk: "неактивна" },
  "working": { en: "working", uk: "працює" },
  "thinking": { en: "thinking", uk: "обмірковує" },
  "searching": { en: "searching", uk: "шукає" },
  "needs permission": { en: "needs permission", uk: "потребує дозволу" },
  "is asking you": { en: "is asking you", uk: "очікує на вашу відповідь" },
  "stopped on an error": { en: "stopped on an error", uk: "зупинилася через помилку" },
  "finished": { en: "finished", uk: "завершила роботу" },
  "rate limited": { en: "rate limited", uk: "досягла ліміту запитів" },
  "asleep": { en: "asleep", uk: "спить" },
  "dizzy": { en: "dizzy", uk: "розгублена" },
  "is asking a question": { en: "is asking a question", uk: "ставить запитання" },
  "is asking a test question": { en: "is asking a test question", uk: "показує тестове запитання" },
  "is waiting for you": { en: "is waiting for you", uk: "очікує на вас" },
  "at work": { en: "at work", uk: "працює" },
  "needs you · ": { en: "needs you · ", uk: "потребує уваги · " },
  "needs you": { en: "needs you", uk: "потребує уваги" },
  "running": { en: "running", uk: "виконується" },
  "waiting for your answer": { en: "waiting for your answer", uk: "очікує на вашу відповідь" },
  "Every tracked session — Claude Code, Codex or Cursor.": { en: "Every tracked session — Claude Code, Codex or Cursor.", uk: "Усі відстежувані сесії Claude Code, Codex і Cursor." },
  "Solid dot: Claude Code or Codex · Ringed dot: Cursor": { en: "Solid dot: Claude Code or Codex · Ringed dot: Cursor", uk: "Заповнена крапка: Claude Code або Codex · Кільце: Cursor" },
  "{agent} · {label} — {state}": { en: "{agent} · {label} — {state}", uk: "{agent} · {label} — {state}" },
  "{agent} · {label} — {state}\n{legend}": { en: "{agent} · {label} — {state}\n{legend}", uk: "{agent} · {label} — {state}\n{legend}" },
  "{label} — {state}": { en: "{label} — {state}", uk: "{label} — {state}" },
  "{label} — {state}\n{legend}": { en: "{label} — {state}\n{legend}", uk: "{label} — {state}\n{legend}" },
  "{window}: {percent}% used. {source}": { en: "{window}: {percent}% used. {source}", uk: "{window}: використано {percent}%. {source}" },
  "{window}: {percent}% used · {countdown}. {source}": { en: "{window}: {percent}% used · {countdown}. {source}", uk: "{window}: використано {percent}% · {countdown}. {source}" },
  "1 decision further down": { en: "1 decision further down", uk: "Ще одне рішення нижче" },
  "{count} decisions further down": { en: "{count} decisions further down", uk: "Нижче ще рішень: {count}" },
  "1 more line": { en: "1 more line", uk: "Ще 1 рядок" },
  "{count} more lines": { en: "{count} more lines", uk: "Ще рядків: {count}" },
  "{agent} — {status}. Open its steps.": { en: "{agent} — {status}. Open its steps.", uk: "{agent} — {status}. Відкрити кроки." },
  "Back to {folder} (the main session)": { en: "Back to {folder} (the main session)", uk: "Назад до {folder} (головна сесія)" },
  "{agent} — {folder} — {title}{model} — {status}{children}": { en: "{agent} — {folder} — {title}{model} — {status}{children}", uk: "{agent} — {folder} — {title}{model} — {status}{children}" },
  "{count} subagents: {running} running{waiting}": { en: "{count} subagents: {running} running{waiting}", uk: "Субагентів: {count}; працюють: {running}{waiting}" },
  "{tip} (Ctrl+Enter)": { en: "{tip} (Ctrl+Enter)", uk: "{tip} (Ctrl+Enter)" },
  "Focus {app}": { en: "Focus {app}", uk: "Перейти до {app}" },
  "Focus {app} window": { en: "Focus {app} window", uk: "Перейти до вікна {app}" },
  "Opens {app}, tab: {tab}": { en: "Opens {app}, tab: {tab}", uk: "Відкриває {app}, вкладка: {tab}" },
  "No step of this kind in this subagent yet.": { en: "No step of this kind in this subagent yet.", uk: "У цього субагента ще немає таких кроків." },
  "No step of this kind in this session yet.": { en: "No step of this kind in this session yet.", uk: "У цієї сесії ще немає таких кроків." },
  "1 request is waiting: the oldest first": { en: "1 request is waiting: the oldest first", uk: "Очікує 1 запит. Спершу показано найстаріший." },
  "Nothing matches “{query}”. Try a simpler word.": { en: "Nothing matches “{query}”. Try a simpler word.", uk: "За запитом «{query}» нічого не знайдено. Спробуйте простіше слово." },
  "reset": { en: "reset", uk: "скинути" },
  "Window reset": { en: "Window reset", uk: "Ліміт скинуто" },
  "5 h": { en: "5 h", uk: "5 год" },
  "7 d": { en: "7 d", uk: "7 дн." },
  "Codex 5h": { en: "Codex 5h", uk: "Codex 5 год" },
  "Codex 7d": { en: "Codex 7d", uk: "Codex 7 дн." },
  "{percent}% used": { en: "{percent}% used", uk: "Використано {percent}%" },
  "Resets at {time} (local time)": { en: "Resets at {time} (local time)", uk: "Скидання {time} за місцевим часом" },
  "Resets": { en: "Resets", uk: "Скидання" },
  "Search settings (/)": { en: "Search settings (/)", uk: "Пошук у налаштуваннях (/)" },
  "Agents list": { en: "Agents list", uk: "Список агентів" },
  "{agent}: {percent}% used{countdown}. {source}": { en: "{agent}: {percent}% used{countdown}. {source}", uk: "{agent}: використано {percent}%{countdown}. {source}" },
  "{count} decision further down": { en: "{count} decision further down", uk: "Ще {count} рішення нижче" },
  "{count} more line": { en: "{count} more line", uk: "Ще {count} рядок" },
  "{count} running": { en: "{count} running", uk: "Виконується: {count}" },
  "{count} running, {waiting} waiting for you": { en: "{count} running, {waiting} waiting for you", uk: "Виконується: {count}, очікує на вас: {waiting}" },
  "{name}{model} — {status}": { en: "{name}{model} — {status}", uk: "{name}{model} — {status}" },
  "{count} session": { en: "{count} session", uk: "{count} сесія" },
  "{count} sessions": { en: "{count} sessions", uk: "{count} сесій" },
  "{count} subagent": { en: "{count} subagent", uk: "{count} субагент" },
  "{count} subagents": { en: "{count} subagents", uk: "{count} субагентів" },
  "{count} file": { en: "{count} file", uk: "{count} файл" },
  "{count} files": { en: "{count} files", uk: "{count} файлів" },
  "{count} waiting for you": { en: "{count} waiting for you", uk: "{count} очікує на вас" },
  ", {count} waiting for you": { en: ", {count} waiting for you", uk: ", очікує на вас: {count}" },
  "{summary}: {running} running{waiting}": { en: "{summary}: {running} running{waiting}", uk: "{summary}: виконується {running}{waiting}" },
  "{percent}%. Підключіть зарядний пристрій.": { en: "{percent}%. Connect the charger.", uk: "{percent}%. Підключіть зарядний пристрій." },
  "Manage Claude Code and Codex integrations.": { en: "Manage Claude Code and Codex integrations.", uk: "Керуйте інтеграціями Claude Code та Codex." },
  "5-hour usage limit": { en: "5-hour usage limit", uk: "Ліміт за 5 годин" },
  "Weekly usage limit": { en: "Weekly usage limit", uk: "Тижневий ліміт" },
  "5-hour": { en: "5-hour", uk: "5 год" },
  "Weekly": { en: "Weekly", uk: "Тиждень" },
  "Open the island large, or shrink it": { en: "Open the island large, or shrink it", uk: "Розгорнути або згорнути острівець" },
  "Opens the session panel at full size, or shrinks it back.": { en: "Opens the session panel at full size, or shrinks it back.", uk: "Відкриває панель сесії на весь розмір або повертає її до компактного вигляду." },
  "Open the session panel": { en: "Open the session panel", uk: "Відкрити панель сесії" },
  "Opens the panel at its normal size. Press Space to make it large.": { en: "Opens the panel at its normal size. Press Space to make it large.", uk: "Відкриває панель у звичайному розмірі. Натисніть пробіл, щоб розгорнути її." },
  "Jump to the session that needs you": { en: "Jump to the session that needs you", uk: "Перейти до сесії, що чекає на вас" },
  "Brings forward the window of the session that is asking for something, or has stopped on an error.": { en: "Brings forward the window of the session that is asking for something, or has stopped on an error.", uk: "Виводить на передній план вікно сесії, що чекає на відповідь або зупинилася через помилку." },
  "Hide or show the island": { en: "Hide or show the island", uk: "Приховати або показати острівець" },
  "Hides the island completely, or brings it back. It still shows itself for a request, and hides again once all are answered.": { en: "Hides the island completely, or brings it back. It still shows itself for a request, and hides again once all are answered.", uk: "Повністю приховує острівець або повертає його. Під час запиту він усе одно з’явиться та знову сховається після відповіді на всі запити." },
  "Show or hide the agents list": { en: "Show or hide the agents list", uk: "Показати або приховати список агентів" },
  "Works only while the agents list is turned on.": { en: "Works only while the agents list is turned on.", uk: "Працює, лише коли список агентів увімкнено." },
  "What is playing, with play and skip.": { en: "What is playing, with play and skip.", uk: "Що відтворюється, з кнопками відтворення та перемикання." },
  "To-do": { en: "To-do", uk: "Завдання" },
  "Your latest items, and a field to add one.": { en: "Your latest items, and a field to add one.", uk: "Останні завдання та поле, щоб додати нове." },
  "A countdown you can start and pause.": { en: "A countdown you can start and pause.", uk: "Таймер зворотного відліку, який можна запускати й призупиняти." },
  "The next reminder, and a quick add.": { en: "The next reminder, and a quick add.", uk: "Наступне нагадування та швидке додавання." },
  "A button that opens the camera view.": { en: "A button that opens the camera view.", uk: "Кнопка відкриває зображення з камери." },
  "Recent folders, to open in your editor.": { en: "Recent folders, to open in your editor.", uk: "Нещодавні папки, які можна відкрити у редакторі." },
  "This is exactly what Nook will change in Claude Code's settings file. Your own hooks and settings stay as they are.": { en: "This is exactly what Nook will change in Claude Code's settings file. Your own hooks and settings stay as they are.", uk: "Саме ці зміни Nook внесе у файл налаштувань Claude Code. Ваші hooks та інші параметри залишаться без змін." },
  "This removes Nook's entries only. Your own hooks and settings stay as they are.": { en: "This removes Nook's entries only. Your own hooks and settings stay as they are.", uk: "Це видалить лише записи Nook. Ваші hooks та інші параметри залишаться без змін." },
  "Open a new Claude Code session for the change to take effect.": { en: "Open a new Claude Code session for the change to take effect.", uk: "Щоб зміни набули чинності, відкрийте нову сесію Claude Code." },
  "This is exactly what will change in Claude Code's settings file: its status line (the statusLine key), and nothing else. A status line you already have keeps working: Nook runs it for you — it is the long word after --previous — and turning this off puts it back as it was.": { en: "This is exactly what will change in Claude Code's settings file: its status line (the statusLine key), and nothing else. A status line you already have keeps working: Nook runs it for you — it is the long word after --previous — and turning this off puts it back as it was.", uk: "Зміниться лише status line у налаштуваннях Claude Code (ключ statusLine). Наявний status line продовжить працювати: Nook запускає його після власної команди, переданої параметру --previous. Після вимкнення все повернеться до попереднього стану." },
  "This takes Nook out of the status line only. The status line you had before comes back exactly as it was; with none, the key is removed.": { en: "This takes Nook out of the status line only. The status line you had before comes back exactly as it was; with none, the key is removed.", uk: "Nook буде вилучено лише зі status line. Попередній status line повернеться без змін; якщо його не було, ключ буде видалено." },
  "Claude Code picks the change up when it reloads its settings; a new session always does.": { en: "Claude Code picks the change up when it reloads its settings; a new session always does.", uk: "Claude Code застосує зміни після повторного завантаження налаштувань; нова сесія застосує їх у будь-якому разі." },
  "This is exactly what will change in your CLAUDE.md, Claude Code's instructions file: the block between Nook's two marker lines, and nothing outside them.": { en: "This is exactly what will change in your CLAUDE.md, Claude Code's instructions file: the block between Nook's two marker lines, and nothing outside them.", uk: "У CLAUDE.md, файлі інструкцій Claude Code, зміниться лише блок між двома маркерами Nook." },
  "This removes Nook's two marker lines, what is between them, and the blank line Nook added before them. Everything else in your CLAUDE.md stays as it is.": { en: "This removes Nook's two marker lines, what is between them, and the blank line Nook added before them. Everything else in your CLAUDE.md stays as it is.", uk: "Буде видалено два маркери Nook, текст між ними та порожній рядок перед ними. Решта CLAUDE.md залишиться без змін." },
  "New sessions use it.": { en: "New sessions use it.", uk: "Це застосовується до нових сесій." },
  "This is exactly what will change in Cursor's hooks.json: Nook's entries, and nothing else. Your own hooks and any other key stay as they are.": { en: "This is exactly what will change in Cursor's hooks.json: Nook's entries, and nothing else. Your own hooks and any other key stay as they are.", uk: "У hooks.json Cursor зміняться лише записи Nook. Ваші hooks та інші ключі залишаться без змін." },
  "This removes Nook's entries only. Your own hooks stay as they are.": { en: "This removes Nook's entries only. Your own hooks stay as they are.", uk: "Це видалить лише записи Nook. Ваші hooks залишаться без змін." },
  "Cursor reloads hooks.json when it is saved. If its sessions do not show up, restart Cursor.": { en: "Cursor reloads hooks.json when it is saved. If its sessions do not show up, restart Cursor.", uk: "Cursor перечитує hooks.json після збереження. Якщо його сесії не з’являться, перезапустіть Cursor." },
  "This is exactly what will change in Codex's hooks.json: Nook's entries, and nothing else. Your own hooks and any other key stay as they are.": { en: "This is exactly what will change in Codex's hooks.json: Nook's entries, and nothing else. Your own hooks and any other key stay as they are.", uk: "У hooks.json Codex зміняться лише записи Nook. Ваші hooks та інші ключі залишаться без змін." },
  "Nook is configured to receive Codex session events. Real Codex CLI and VS Code hook delivery has not been verified.": { en: "Nook is configured to receive Codex session events. Real Codex CLI and VS Code hook delivery has not been verified.", uk: "Nook налаштовано для отримання подій сесій Codex. Доставку hooks від Codex CLI та розширення VS Code ще не перевірено." },
  "Synthetic Codex events have been checked in Nook Dev. Real Codex CLI and VS Code hook delivery has not been verified; Codex remains the source of truth for permission decisions.": { en: "Synthetic Codex events have been checked in Nook Dev. Real Codex CLI and VS Code hook delivery has not been verified; Codex remains the source of truth for permission decisions.", uk: "Синтетичні події Codex перевірено в Nook Dev. Доставку подій від Codex CLI та VS Code ще не перевірено; рішення щодо дозволів поки приймайте в Codex." },
  "Nook Dev does not read or change your global Claude settings. Use the isolated scratch launcher for Dev-only SessionStart and SessionEnd checks.": { en: "Nook Dev does not read or change your global Claude settings. Use the isolated scratch launcher for Dev-only SessionStart and SessionEnd checks.", uk: "Nook Dev не читає та не змінює глобальні налаштування Claude. Для перевірки SessionStart і SessionEnd використовуйте ізольований scratch launcher." },
  "The isolated lifecycle launcher does not send prompts, run tools, or test permissions.": { en: "The isolated lifecycle launcher does not send prompts, run tools, or test permissions.", uk: "Ізольований launcher життєвого циклу не надсилає запитів, не запускає інструментів і не перевіряє дозволи." },
  "Codex events in the Dev simulator are synthetic. Real Codex CLI and VS Code hook delivery has not been verified; Nook Dev does not install global Codex hooks.": { en: "Codex events in the Dev simulator are synthetic. Real Codex CLI and VS Code hook delivery has not been verified; Nook Dev does not install global Codex hooks.", uk: "Події Codex у симуляторі Dev синтетичні. Доставку hooks від Codex CLI та VS Code ще не перевірено; Nook Dev не встановлює глобальні hooks Codex." },
  "Show synthetic Codex sessions in Nook Dev.": { en: "Show synthetic Codex sessions in Nook Dev.", uk: "Показувати синтетичні сесії Codex у Nook Dev." },
  "Create the file": { en: "Create the file", uk: "Створити файл" },
  "Save a backup and apply": { en: "Save a backup and apply", uk: "Зберегти резервну копію та застосувати" },
  "Save a backup and remove": { en: "Save a backup and remove", uk: "Зберегти резервну копію та видалити" },
  "Recording. Esc cancels.": { en: "Recording. Esc cancels.", uk: "Запис комбінації. Esc скасовує." },
  "Works from any app": { en: "Works from any app", uk: "Працює в будь-якій програмі" },
  "Not registered": { en: "Not registered", uk: "Не зареєстровано" },
  "The compact island stays visible until you hide it or close Nook.": { en: "The compact island stays visible until you hide it or close Nook.", uk: "Компактний острівець залишається видимим, доки ви його не приховаєте або не закриєте Nook." },
  "Follows your computer, which is set to light right now. The island itself is always dark.": { en: "Follows your computer, which is set to light right now. The island itself is always dark.", uk: "Відповідає світлій темі Windows. Сам острівець завжди має темну тему." },
  "Recording · {count} events": { en: "Recording · {count} events", uk: "Запис · подій: {count}" },
  "{count} events retained in memory": { en: "{count} events retained in memory", uk: "У пам’яті збережено подій: {count}" },
  "This version": { en: "This version", uk: "Ця версія" },
  "You have version {version}": { en: "You have version {version}", uk: "У вас версія {version}" },
  "Reply layout: {name}. Opens in your browser.": { en: "Reply layout: {name}. Opens in your browser.", uk: "Формат відповіді: {name}. Відкривається у браузері." },
  "Version {version}": { en: "Version {version}", uk: "Версія {version}" },
  "{count} settings found.": { en: "{count} settings found.", uk: "Знайдено налаштувань: {count}" },
  "Reset this section": { en: "Reset this section", uk: "Скинути цей розділ" },
  "Codex runs new hooks only once you trust them: start Codex and review them once with /hooks.": { en: "Codex runs new hooks only once you trust them: start Codex and review them once with /hooks.", uk: "Codex запускає нові hooks лише після підтвердження довіри. Відкрийте Codex і перегляньте їх командою /hooks." },
  "A part of Nook that Claude Code talks to is missing, so your sessions can't reach Nook. Restarting Nook puts it back.": { en: "A part of Nook that Claude Code talks to is missing, so your sessions can't reach Nook. Restarting Nook puts it back.", uk: "Відсутній компонент Nook, потрібний для зв’язку з Claude Code, тому сесії не можуть надсилати події. Перезапустіть Nook, щоб відновити його." },
  "A part of Nook that Claude Code talks to is missing, so connecting now would not work. Restarting Nook puts it back.": { en: "A part of Nook that Claude Code talks to is missing, so connecting now would not work. Restarting Nook puts it back.", uk: "Відсутній компонент Nook, потрібний для підключення Claude Code. Перезапустіть Nook, щоб відновити його." },
  "Nook is connected, but parts of an older version are still there. Updating takes them out.": { en: "Nook is connected, but parts of an older version are still there. Updating takes them out.", uk: "Nook підключено, але залишилися компоненти старої версії. Оновлення їх замінить." },
  "An older version of Nook's connection is still there. Nook can't hear your sessions until it is updated.": { en: "An older version of Nook's connection is still there. Nook can't hear your sessions until it is updated.", uk: "Залишилося підключення старої версії Nook. Поки його не оновити, Nook не отримуватиме події сесій." },
  "On, next to your own status line": { en: "On, next to your own status line", uk: "Увімкнено поруч із вашим status line" },
  "as of last Claude Code activity": { en: "as of last Claude Code activity", uk: "за останньою активністю Claude Code" },
  "as of Codex quota update": { en: "as of Codex quota update", uk: "за останнім оновленням квот Codex" },
  "Claude usage": { en: "Claude usage", uk: "Ліміти Claude" },
  "Codex usage": { en: "Codex usage", uk: "Ліміти Codex" },
  "Light": { en: "Light", uk: "Світла" },
  "Dark": { en: "Dark", uk: "Темна" },
  "Match computer": { en: "Match computer", uk: "Як у Windows" },
  "Cream": { en: "Cream", uk: "Вершковий" },
  "Peach": { en: "Peach", uk: "Персиковий" },
  "Mint": { en: "Mint", uk: "М’ятний" },
  "Lilac": { en: "Lilac", uk: "Бузковий" },
  "Sky": { en: "Sky", uk: "Небесний" },
  "Cocoa": { en: "Cocoa", uk: "Какао" },
  "Turn on the agents list first.": { en: "Turn on the agents list first.", uk: "Спочатку увімкніть список агентів." },
  "Turn on fading first.": { en: "Turn on fading first.", uk: "Спочатку увімкніть згасання." },
  "{count}m ago": { en: "{count}m ago", uk: "{count} хв тому" },
  "{count}h ago": { en: "{count}h ago", uk: "{count} год тому" },
  "{count}d ago": { en: "{count}d ago", uk: "{count} дн тому" },
  "1 subagent running": { en: "1 subagent running", uk: "Працює 1 субагент" },
  "{count} subagents running": { en: "{count} subagents running", uk: "Працюють субагенти: {count}" },
  "agent · {state}": { en: "agent · {state}", uk: "агент · {state}" },
  "Enter sends, Shift+Enter starts a new line. Nook types it into the window this session runs in, and the conversation carries on there. In a terminal with tabs, this session's tab has to be the one showing.": { en: "Enter sends, Shift+Enter starts a new line. Nook types it into the window this session runs in, and the conversation carries on there. In a terminal with tabs, this session's tab has to be the one showing.", uk: "Enter надсилає повідомлення, Shift+Enter починає новий рядок. Nook вводить текст у вікно сесії, і розмова продовжується там. У терміналі з вкладками має бути відкрита вкладка цієї сесії." },
  "No step of this kind in this session.": { en: "No step of this kind in this session.", uk: "У цій сесії ще немає такого кроку." },
  "No step of this kind in this subagent.": { en: "No step of this kind in this subagent.", uk: "У цього субагента ще немає такого кроку." },
  "Nothing has come from this session for 10 minutes. It may be over: Claude Code does not always say when a turn ends.": { en: "Nothing has come from this session for 10 minutes. It may be over: Claude Code does not always say when a turn ends.", uk: "Від цієї сесії немає подій уже 10 хвилин. Можливо, вона завершилася: Claude Code не завжди повідомляє про кінець ходу." },
  "New activity": { en: "New activity", uk: "Нова активність" },
  "Its last reply has something marked IMPORTANT. The mark goes once that reply has been read whole here, or when you answer it.": { en: "Its last reply has something marked IMPORTANT. The mark goes once that reply has been read whole here, or when you answer it.", uk: "В останній відповіді є позначка IMPORTANT. Вона зникне, коли ви прочитаєте всю відповідь тут або відповісте на неї." },
  "{app} · new file": { en: "{app} · new file", uk: "{app} · новий файл" },
  "{app} · {path}": { en: "{app} · {path}", uk: "{app} · {path}" },
  "{app} · Paused": { en: "{app} · Paused", uk: "{app} · на паузі" },
  "{app} · Playing": { en: "{app} · Playing", uk: "{app} · відтворюється" },
  "No answer yet. If no question appeared, allow the camera for Nook in Windows Settings → Privacy & security → Camera, then go back and try again.": { en: "No answer yet. If no question appeared, allow the camera for Nook in Windows Settings → Privacy & security → Camera, then go back and try again.", uk: "Відповіді ще немає. Якщо запит не з’явився, дозвольте Nook доступ до камери: Параметри Windows → Конфіденційність і безпека → Камера. Потім поверніться та спробуйте ще раз." },
  "Windows may be asking for permission.": { en: "Windows may be asking for permission.", uk: "Можливо, Windows очікує на дозвіл." },
  "{time} · paused": { en: "{time} · paused", uk: "{time} · призупинено" },
  "{time} · running": { en: "{time} · running", uk: "{time} · працює" },
  "Gullu · sessions · {metrics}": { en: "Gullu · sessions · {metrics}", uk: "Gullu · сесії · {metrics}" },
  "no numbers": { en: "no numbers", uk: "значень немає" },
  "Move Reply layout. Use the up and down arrows.": { en: "Move Reply layout. Use the up and down arrows.", uk: "Перемістити «Формат відповіді». Скористайтеся стрілками вгору та вниз." },
  "{name} {state}": { en: "{name} {state}", uk: "{name} {state}" },
  "{name} {state} — {attention}": { en: "{name} {state} — {attention}", uk: "{name} {state} — {attention}" },
  "{name} {state}{attention}": { en: "{name} {state}{attention}", uk: "{name} {state}{attention}" },
  "new activity": { en: "new activity", uk: "нова активність" },
  " — {attention}": { en: " — {attention}", uk: " — {attention}" },
  "{agent} — {folder} — {title}{model} — {state}{children}": { en: "{agent} — {folder} — {title}{model} — {state}{children}", uk: "{agent} — {folder} — {title}{model} — {state}{children}" },
  " — {count} subagents, {running} running": { en: " — {count} subagents, {running} running", uk: " — субагентів: {count}, виконується: {running}" },
  "{tool} · {path}{created}": { en: "{tool} · {path}{created}", uk: "{tool} · {path}{created}" },
  " · new file": { en: " · new file", uk: " · новий файл" },
  "{count} folder": { en: "{count} folder", uk: "Папка: {count}" },
  "{count} folders": { en: "{count} folders", uk: "Папок: {count}" },
  "Claude Code sessions and permission requests can appear in the island. Live permission decisions have not been verified in this test cycle.": { en: "Claude Code sessions and permission requests can appear in the island. Live permission decisions have not been verified in this test cycle.", uk: "Сесії Claude Code та запити дозволу можуть з’являтися на острівці. Передавання рішень щодо дозволів у цьому циклі перевірок не підтверджено." },
  "Connect Claude Code to show its sessions and permission requests in the island. Live permission decisions have not been verified in this test cycle.": { en: "Connect Claude Code to show its sessions and permission requests in the island. Live permission decisions have not been verified in this test cycle.", uk: "Підключіть Claude Code, щоб бачити його сесії та запити дозволу на острівці. Передавання рішень щодо дозволів у цьому циклі перевірок не підтверджено." },
  "Connect Claude Code to show sessions and permission requests in the island. Live permission decisions have not been verified in this test cycle.": { en: "Connect Claude Code to show sessions and permission requests in the island. Live permission decisions have not been verified in this test cycle.", uk: "Підключіть Claude Code, щоб бачити його сесії та запити дозволу на острівці. Передавання рішень щодо дозволів у цьому циклі перевірок не підтверджено." },
  "For Codex CLI, review new hooks with /hooks before trusting them. Hook behavior in Codex CLI and VS Code has not been verified in this test cycle.": { en: "For Codex CLI, review new hooks with /hooks before trusting them. Hook behavior in Codex CLI and VS Code has not been verified in this test cycle.", uk: "У Codex CLI перегляньте нові hooks командою /hooks, перш ніж довіряти їм. Роботу hooks у Codex CLI та VS Code у цьому циклі перевірок не підтверджено." },
  "Codex sessions and quota status.": { en: "Codex sessions and quota status.", uk: "Сесії Codex і стан квот." },
  "Sessions and permissions": { en: "Sessions and permissions", uk: "Сесії та запити дозволу" },
  "Not connected": { en: "Not connected", uk: "Не підключено" },
  "Needs repair": { en: "Needs repair", uk: "Потрібне виправлення" },
  "Configured": { en: "Configured", uk: "Налаштовано" },
  "Receiving events": { en: "Receiving events", uk: "Отримує події" },
  "Waiting for activity": { en: "Waiting for activity", uk: "Очікує на активність" },
  "Waiting for Codex activity": { en: "Waiting for Codex activity", uk: "Очікування активності Codex" },
  "No events received": { en: "No events received", uk: "Подій ще не отримано" },
  "Original Nook hooks were found. Review a migration preview to move them safely.": { en: "Original Nook hooks were found. Review a migration preview to move them safely.", uk: "Знайдено hooks оригінального Nook. Перегляньте попередній перегляд міграції." },
  "Nook Dev hooks were found. They are left untouched unless you approve each scope.": { en: "Nook Dev hooks were found. They are left untouched unless you approve each scope.", uk: "Знайдено hooks Nook Dev. Їх не буде змінено без окремого підтвердження для кожної області." },
  "Connect to receive sessions and permission requests.": { en: "Connect to receive sessions and permission requests.", uk: "Підключіть, щоб отримувати сесії та запити дозволу." },
  "Some Nook hooks point to a missing relay or need repair.": { en: "Some Nook hooks point to a missing relay or need repair.", uk: "Деякі hooks Nook посилаються на відсутній relay або потребують виправлення." },
  "Hooks are configured. Delivery is reported separately.": { en: "Hooks are configured. Delivery is reported separately.", uk: "Hooks налаштовано. Доставку подій показано окремо." },
  "A configuration could not be read safely. No changes will be made to it.": { en: "A configuration could not be read safely. No changes will be made to it.", uk: "Не вдалося безпечно прочитати конфігурацію. Її не буде змінено." },
  "CLI detected on PATH": { en: "CLI detected on PATH", uk: "CLI знайдено в PATH" },
  "CLI not detected on PATH": { en: "CLI not detected on PATH", uk: "CLI не знайдено в PATH" },
  "No real hook event received yet": { en: "No real hook event received yet", uk: "Реальних подій hooks ще не отримано" },
  "Last event: {event}{time}": { en: "Last event: {event}{time}", uk: "Остання подія: {event}{time}" },
  "Preview only in this build. Agent configuration files will not be changed.": { en: "Preview only in this build. Agent configuration files will not be changed.", uk: "У цій збірці доступний лише перегляд. Файли конфігурації агентів не змінюватимуться." },
  "Standalone relay is not installed yet. Install the standalone Nook build before connecting.": { en: "Standalone relay is not installed yet. Install the standalone Nook build before connecting.", uk: "Relay Standalone ще не встановлено. Перед підключенням установіть збірку Nook Standalone." },
  "Connection change preview": { en: "Connection change preview", uk: "Попередній перегляд змін підключення" },
  "{operation} preview": { en: "{operation} preview", uk: "Попередній перегляд: {operation}" },
  "Review these changes. Nothing is written until you confirm.": { en: "Review these changes. Nothing is written until you confirm.", uk: "Перевірте зміни. Запис відбудеться лише після підтвердження." },
  "No owned entries": { en: "No owned entries", uk: "Немає власних записів" },
  "Ownership: {owners}": { en: "Ownership: {owners}", uk: "Власник: {owners}" },
  "Fingerprint: {fingerprint}{backup}": { en: "Fingerprint: {fingerprint}{backup}", uk: "Відбиток стану: {fingerprint}{backup}" },
  "Backup: {path}": { en: "Backup: {path}", uk: "Резервна копія: {path}" },
  "required": { en: "required", uk: "потрібна" },
  "No file changes.": { en: "No file changes.", uk: "Змін файлу немає." },
  "This file has a conflict that needs review.": { en: "This file has a conflict that needs review.", uk: "У цьому файлі є конфлікт, який потрібно перевірити." },
  "This preview contains a conflict that needs review.": { en: "This preview contains a conflict that needs review.", uk: "У цьому попередньому перегляді є конфлікт, який потрібно перевірити." },
  "Duplicate events: {events}": { en: "Duplicate events: {events}", uk: "Дублікати подій: {events}" },
  "I approve migrating Original Nook hooks.": { en: "I approve migrating Original Nook hooks.", uk: "Підтверджую перенесення hooks оригінального Nook." },
  "I approve removing Nook Dev hooks from {scope}.": { en: "I approve removing Nook Dev hooks from {scope}.", uk: "Підтверджую видалення hooks Nook Dev з області: {scope}." },
  "I understand Codex may ask me to trust these hooks in its own prompt.": { en: "I understand Codex may ask me to trust these hooks in its own prompt.", uk: "Розумію, що Codex може окремо попросити підтвердити довіру до цих hooks." },
  "Standalone Safe Apply": { en: "Standalone Safe Apply", uk: "Безпечне застосування в Standalone" },
  "Project statusLine overrides Claude usage in: {paths}": { en: "Project statusLine overrides Claude usage in: {paths}", uk: "Проєктний statusLine має пріоритет над квотами Claude: {paths}" },
  "Project statusLine already uses Standalone: {path}": { en: "Project statusLine already uses Standalone: {path}", uk: "У проєкті вже використовується statusLine Standalone: {path}" },
  "Could not check project statusLine: {path}": { en: "Could not check project statusLine: {path}", uk: "Не вдалося перевірити проєктний statusLine: {path}" },
  "A managed Claude Code policy can also override or disable a local status line.": { en: "A managed Claude Code policy can also override or disable a local status line.", uk: "Політика організації Claude Code також може замінити або вимкнути локальний statusLine." },
  "Preview only in this build. Apply is available in standalone Nook.": { en: "Preview only in this build. Apply is available in standalone Nook.", uk: "У цій збірці доступний лише перегляд. Застосування доступне в Nook Standalone." },
  "Confirm disconnect": { en: "Confirm disconnect", uk: "Підтвердити відключення" },
  "Confirm repair": { en: "Confirm repair", uk: "Підтвердити виправлення" },
  "Confirm connect": { en: "Confirm connect", uk: "Підтвердити підключення" },
  "Planned hook changes: {added} added, {replaced} replaced, {removed} removed.": { en: "Planned hook changes: {added} added, {replaced} replaced, {removed} removed.", uk: "Заплановані hooks: додати — {added}, замінити — {replaced}, видалити — {removed}." },
  "Scopes: {scopes}. Backups: {backups}.": { en: "Scopes: {scopes}. Backups: {backups}.", uk: "Області: {scopes}. Резервних копій: {backups}." },
  "none": { en: "none", uk: "немає" },
  "Third-party and unknown entries preserved: {count}.": { en: "Third-party and unknown entries preserved: {count}.", uk: "Сторонніх і невідомих записів буде збережено: {count}." },
  "This preview migrates Original Nook hooks to Standalone.": { en: "This preview migrates Original Nook hooks to Standalone.", uk: "Цей план переносить hooks з Original Nook → Standalone." },
  "Add Standalone hook": { en: "Add Standalone hook", uk: "Додати hook Standalone" },
  "Replace {owner} hook": { en: "Replace {owner} hook", uk: "Замінити hook {owner}" },
  "Remove {owner} hook": { en: "Remove {owner} hook", uk: "Видалити hook {owner}" },
  "Keep {owner} hook": { en: "Keep {owner} hook", uk: "Зберегти hook {owner}" },
  "{event}: {action}": { en: "{event}: {action}", uk: "{event}: {action}" },
  "Technical diff": { en: "Technical diff", uk: "Технічний diff" },
  "Copy changes": { en: "Copy changes", uk: "Скопіювати зміни" },
  "Copied changes.": { en: "Copied changes.", uk: "Зміни скопійовано." },
  "Configuration changed since this preview. Apply is blocked; review a fresh preview.": { en: "Configuration changed since this preview. Apply is blocked; review a fresh preview.", uk: "Конфігурація змінилася після перегляду. Застосування заблоковано; перегляньте новий план." },
  "The configuration changed or could not be saved. No changes were applied. Review a fresh preview before trying again.": { en: "The configuration changed or could not be saved. No changes were applied. Review a fresh preview before trying again.", uk: "Конфігурація змінилася або її не вдалося зберегти. Зміни не застосовано. Перед повторною спробою перегляньте новий план." },
  "Review fresh preview": { en: "Review fresh preview", uk: "Переглянути новий план" },
  "Review Dev scope removal…": { en: "Review Dev scope removal…", uk: "Переглянути видалення hooks Dev…" },
  "User scope": { en: "User scope", uk: "Область користувача" },
  "Scope": { en: "Scope", uk: "Область" },
  "Current relay": { en: "Current relay", uk: "Поточний relay" },
  "None": { en: "None", uk: "Немає" },
  "Original statusLine found": { en: "Original statusLine found", uk: "Знайдено statusLine оригінального Nook" },
  "Another statusLine is set": { en: "Another statusLine is set", uk: "Налаштовано інший statusLine" },
  "Claude usage is connected through the Standalone statusLine.": { en: "Claude usage is connected through the Standalone statusLine.", uk: "Статистика Claude надходить через statusLine Standalone." },
  "Claude sessions reach Nook, but Claude usage is still routed through Original Nook.": { en: "Claude sessions reach Nook, but Claude usage is still routed through Original Nook.", uk: "Сесії Claude надходять у Nook, але статистика Claude досі спрямована до оригінального Nook." },
  "Migrate the user statusLine to Standalone to send Claude 5-hour and weekly usage to this Nook.": { en: "Migrate the user statusLine to Standalone to send Claude 5-hour and weekly usage to this Nook.", uk: "Перенесіть користувацький statusLine до Standalone, щоб передавати сюди статистику Claude за 5 годин і тиждень." },
  "The preview shows the exact change and backup. A separate confirmation is required for Original Nook migration.": { en: "The preview shows the exact change and backup. A separate confirmation is required for Original Nook migration.", uk: "Попередній перегляд показує точну зміну й резервну копію. Для перенесення з оригінального Nook потрібне окреме підтвердження." },
  "Any user statusLine already wrapped by Original Nook is kept and can be restored when Standalone usage is turned off.": { en: "Any user statusLine already wrapped by Original Nook is kept and can be restored when Standalone usage is turned off.", uk: "Наявний statusLine, збережений усередині оригінального Nook, не втрачається й відновиться після вимкнення статистики Standalone." },
  "Reads the usage numbers Claude Code already passes to its status line (the statusLine key of settings.json). Nothing leaves this computer. Numbers appear on subscription plans, and update only while a session runs.": { en: "Reads the usage numbers Claude Code already passes to its status line (the statusLine key of settings.json). Nothing leaves this computer. Numbers appear on subscription plans, and update only while a session runs.", uk: "Читає дані використання, які Claude Code передає у statusLine (ключ statusLine у settings.json). Дані не залишають цей комп’ютер. Вони доступні для планів із підпискою та оновлюються лише під час роботи сесії." },
  "Claude Code hands the numbers to Nook, which then runs the status line you already had, so it keeps showing. Turning this off puts it back exactly as it was.": { en: "Claude Code hands the numbers to Nook, which then runs the status line you already had, so it keeps showing. Turning this off puts it back exactly as it was.", uk: "Claude Code передає дані Nook, а Nook запускає ваш попередній statusLine, тож він продовжує працювати. Після вимкнення він відновлюється без змін." },
  "Nook prints no status line of its own. {hints}": { en: "Nook prints no status line of its own. {hints}", uk: "Nook не додає власного тексту до statusLine. {hints}" },
  "Claude Code hides its keyboard hints (\"? for shortcuts\") while any status line is set.": { en: "Claude Code hides its keyboard hints (\"? for shortcuts\") while any status line is set.", uk: "Claude Code приховує підказки клавіш (\"? for shortcuts\"), поки налаштовано будь-який statusLine." },
  "You have a status line: Nook runs it after reading the numbers, so it keeps showing, and turning this off puts it back exactly.": { en: "You have a status line: Nook runs it after reading the numbers, so it keeps showing, and turning this off puts it back exactly.", uk: "У вас уже є statusLine: Nook запускає його після читання даних, тому він продовжує працювати. Після вимкнення все точно відновиться." },
  "You have no status line: Nook prints none. {hints}": { en: "You have no status line: Nook prints none. {hints}", uk: "У вас немає statusLine: Nook нічого не виводитиме. {hints}" },
  "Claude already has another statusLine. The preview will show how Nook keeps it working and restores it when disconnected.": { en: "Claude already has another statusLine. The preview will show how Nook keeps it working and restores it when disconnected.", uk: "У Claude вже налаштовано інший statusLine. Попередній перегляд покаже, як Nook збереже його роботу й відновить після відключення." },
  "The current statusLine points to Nook Dev. It will be preserved as the previous statusLine in the preview.": { en: "The current statusLine points to Nook Dev. It will be preserved as the previous statusLine in the preview.", uk: "Поточний statusLine вказує на Nook Dev. Попередній перегляд покаже, як зберегти його як попередній statusLine." },
  "The current Nook statusLine owner is unknown. Review the preview carefully; it is preserved as the previous statusLine.": { en: "The current Nook statusLine owner is unknown. Review the preview carefully; it is preserved as the previous statusLine.", uk: "Власника поточного Nook statusLine не вдалося визначити. Уважно перевірте попередній перегляд: цей statusLine буде збережено як попередній." },
  "Current statusLine relay: {relay}": { en: "Current statusLine relay: {relay}", uk: "Поточний relay statusLine: {relay}" },
  "New Standalone relay: {relay}": { en: "New Standalone relay: {relay}", uk: "Новий relay Standalone: {relay}" },
  "Scope: {scope} — {path}": { en: "Scope: {scope} — {path}", uk: "Область: {scope} — {path}" },
  "The existing statusLine is kept as the previous command and restored when disconnected.": { en: "The existing statusLine is kept as the previous command and restored when disconnected.", uk: "Наявний statusLine буде збережено як попередню команду й відновлено після відключення." },
  "Disconnect restores the statusLine value saved before Standalone was connected.": { en: "Disconnect restores the statusLine value saved before Standalone was connected.", uk: "Після відключення відновиться значення statusLine, яке було до підключення Standalone." },
  "This replaces the Original Nook statusLine after your separate confirmation.": { en: "This replaces the Original Nook statusLine after your separate confirmation.", uk: "Після окремого підтвердження цей statusLine замінить statusLine оригінального Nook." },
  "I approve migrating the Original Nook statusLine to Standalone.": { en: "I approve migrating the Original Nook statusLine to Standalone.", uk: "Підтверджую перенесення statusLine оригінального Nook до Standalone." },
  "Connect Claude statistics…": { en: "Connect Claude statistics…", uk: "Підключити статистику Claude…" },
  "Migrate Original statusLine…": { en: "Migrate Original statusLine…", uk: "Перенести statusLine оригінального Nook…" },
  "Turn off…": { en: "Turn off…", uk: "Вимкнути…" },
  "Original Claude statusLine migration requires separate confirmation.": { en: "Original Claude statusLine migration requires separate confirmation.", uk: "Для перенесення Claude statusLine з оригінального Nook потрібне окреме підтвердження." },
  "Could not write: {reason}": { en: "Could not write: {reason}", uk: "Не вдалося зберегти: {reason}" },
  "Only the Claude Code statusLine setting will change. Any existing statusLine is kept and can be restored when disconnected.": { en: "Only the Claude Code statusLine setting will change. Any existing statusLine is kept and can be restored when disconnected.", uk: "Зміниться лише параметр statusLine у Claude Code. Наявний statusLine буде збережено й відновлено після відключення." },
  "Only the Claude Code statusLine setting will be restored to its saved previous value.": { en: "Only the Claude Code statusLine setting will be restored to its saved previous value.", uk: "Буде відновлено попереднє збережене значення параметра statusLine Claude Code." },
  "Claude Code reads the updated statusLine after reloading settings; a new session always does.": { en: "Claude Code reads the updated statusLine after reloading settings; a new session always does.", uk: "Claude Code застосує statusLine після повторного завантаження налаштувань; нова сесія завжди підхоплює зміни." },
  "Backup saved as": { en: "Backup saved as", uk: "Резервну копію збережено:" },
  "Claude settings changed after preview. Nothing was written; review a fresh preview.": { en: "Claude settings changed after preview. Nothing was written; review a fresh preview.", uk: "Налаштування Claude змінилися після попереднього перегляду. Змін не внесено; перегляньте новий план." },
  "The existing statusLine cannot be read safely. Nothing was changed.": { en: "The existing statusLine cannot be read safely. Nothing was changed.", uk: "Не вдалося безпечно прочитати наявний statusLine. Змін не внесено." },
  "Claude Usage could not be updated. Nothing was changed. Technical detail: {detail}": { en: "Claude Usage could not be updated. Nothing was changed. Technical detail: {detail}", uk: "Не вдалося оновити статистику Claude. Змін не внесено. Технічні подробиці: {detail}" },
  "Project scope": { en: "Project scope", uk: "Область проєкту" },
  "Original Nook": { en: "Original Nook", uk: "Оригінальний Nook" },
  "Nook Dev": { en: "Nook Dev", uk: "Nook Dev" },
  "Standalone Nook": { en: "Standalone Nook", uk: "Nook Standalone" },
  "Third-party": { en: "Third-party", uk: "Сторонній інструмент" },
  "Developed by": { en: "Developed by", uk: "Розробник" },
  "Nook Personal Edition · With Gullu, Nook's buddy": { en: "Nook Personal Edition · With Gullu, Nook's buddy", uk: "Nook Personal Edition · Разом із Ґуллу, другом Nook" },
  "Nook does not send personal data or track you. Agent connections and settings stay on this computer.": { en: "Nook does not send personal data or track you. Agent connections and settings stay on this computer.", uk: "Nook не надсилає персональні дані й не відстежує вас. Підключення агентів і налаштування залишаються на цьому комп’ютері." },
  "Valentyn Fetisov. Open source, under the MIT licence.": { en: "Valentyn Fetisov. Open source, under the MIT licence.", uk: "Валентин Фетісов. Відкритий код, ліцензія MIT." },
  "Valentyn Fetisov": { en: "Valentyn Fetisov", uk: "Валентин Фетісов" },
  "Show how much of your Claude limits you have used.": { en: "Show how much of your Claude limits you have used.", uk: "Показати, яку частину лімітів Claude вже використано." },
  "Codex sessions appear in the island with a Codex mark.": { en: "Codex sessions appear in the island with a Codex mark.", uk: "Сесії Codex з’являються на Острівці з позначкою Codex." },
  "Nook Dev's separate Codex quota provider.": { en: "Nook Dev's separate Codex quota provider.", uk: "Окреме джерело квот Codex у Nook Dev." },
  "{agent} connection": { en: "{agent} connection", uk: "Підключення: {agent}" },
} as const satisfies Record<string, Message>;

const reverse = new Map<string, string>(Object.entries(MESSAGES).map(([key, value]) => [value.uk, key]));
const templates = Object.entries(MESSAGES)
  .filter(([key]) => /\{[a-zA-Z][\w]*\}/.test(key))
  // A placeholder-only template matches every sentence. Keep it out of the
  // runtime matcher; rank the remaining templates by their literal wording.
  .filter(([key]) => key.replace(/\{[a-zA-Z][\w]*\}/g, "").trim().length > 0)
  .sort(([a], [b]) => b.replace(/\{[a-zA-Z][\w]*\}/g, "").length - a.replace(/\{[a-zA-Z][\w]*\}/g, "").length)
  .flatMap(([key, value]) => {
    const compile = (phrase: string) => {
      const names: string[] = [];
      const pattern = new RegExp(`^${phrase.split(/(\{[a-zA-Z][\w]*\})/).map((part) => {
        const match = part.match(/^\{([a-zA-Z][\w]*)\}$/);
        if (match) { names.push(match[1]!); return "([\\s\\S]+?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("")}$`);
      return { pattern, names };
    };
    const en = compile(key);
    const uk = compile(value.uk);
    return [
      { value, ...en },
      { value, ...uk },
    ];
  });
const LOCALIZED_TEMPLATE_SLOTS = new Set(["state", "status", "legend", "section", "action", "kind", "source", "summary", "waiting"]);
let activeLanguage: Language = detectSystemLanguage();
const textSource = new WeakMap<Text, { source: string; rendered: string }>();
const attrSource = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();

export function detectSystemLanguage(locale = typeof navigator === "undefined" ? "en" : navigator.language): Language {
  return locale.toLowerCase().startsWith("uk") ? "uk" : "en";
}

export function resolveLanguage(preference: LanguagePreference | string | null | undefined, systemLocale?: string): Language {
  return preference === "uk" || preference === "en" ? preference : detectSystemLanguage(systemLocale);
}

export function currentLanguage(): Language { return activeLanguage; }

/** Translate a source phrase and interpolate named display-only values. */
export function message(source: string, values: Record<string, string | number> = {}): string {
  let rendered = translate(source);
  for (const [key, value] of Object.entries(values)) {
    const displayValue = LOCALIZED_TEMPLATE_SLOTS.has(key) ? translate(String(value)) : String(value);
    rendered = rendered.replaceAll(`{${key}}`, displayValue);
  }
  return rendered;
}

/** Uses the same dictionary as the UI so native tray labels follow the selected locale. */
export function trayMenuLabels(): TrayMenuLabels {
  return {
    openNook: message("Open Nook"),
    hideIsland: message("Hide island"),
    showIsland: message("Show island"),
    showAgentsList: message("Show agents list"),
    hideAgentsList: message("Hide agents list"),
    settings: message("Settings…"),
    pause: message("Pause"),
    quit: message("Quit"),
  };
}

function translate(source: string): string {
  const mapped = MESSAGES[source as keyof typeof MESSAGES];
  // Exact phrases must win over permissive templates such as `{name}`.
  // Otherwise the first catch-all template can match a whole UI sentence and
  // return it unchanged before its explicit translation is considered.
  if (mapped) return activeLanguage === "uk" ? mapped.uk : mapped.en;
  const exactReverse = reverse.get(source);
  if (exactReverse) return activeLanguage === "uk" ? source : exactReverse;
  const resetEnglish = source.match(/^resets in (?:(\d+)d)?(?:\s*(\d+)h)?(?:\s*(\d+)m|\s*<1m)?$/i);
  if (resetEnglish) {
    const [, days, hours, minutes] = resetEnglish;
    const lessThanMinute = /<1m$/i.test(source);
    if (!days && !hours && !minutes && !lessThanMinute) return source;
    const parts = [days && `${days} дн.`, hours && `${hours} год`, minutes && `${minutes} хв`].filter(Boolean);
    return activeLanguage === "uk" ? `Скидання через ${parts.length ? parts.join(" ") : "менше хвилини"}` : `Resets in ${source.slice("resets in ".length)}`;
  }
  const resetUkrainian = source.match(/^скидання через (?:(\d+) дн\.)?(?:\s*(\d+) год)?(?:\s*(\d+) хв|\s*менше хвилини)?$/i);
  if (resetUkrainian) {
    const [, days, hours, minutes] = resetUkrainian;
    const lessThanMinute = /менше хвилини$/i.test(source);
    if (!days && !hours && !minutes && !lessThanMinute) return source;
    return activeLanguage === "en"
      ? `Resets in ${days ? `${days}d` : ""}${hours ? `${days ? " " : ""}${hours}h` : ""}${minutes ? `${days || hours ? " " : ""}${minutes}m` : lessThanMinute ? `${days || hours ? " " : ""}<1m` : ""}`
      : `Скидання через ${[days && `${days} дн.`, hours && `${hours} год`, minutes && `${minutes} хв`].filter(Boolean).join(" ") || "менше хвилини"}`;
  }
  const template = templates.find((entry) => entry.pattern.test(source));
  if (template) {
    const captures = source.match(template.pattern)!.slice(1);
    const values = new Map(template.names.map((name, index) => [name, captures[index]!]));
    return template.value[activeLanguage].replace(/\{([a-zA-Z][\w]*)\}/g, (token, key: string) => {
      const value = values.get(key);
      return value == null ? token : LOCALIZED_TEMPLATE_SLOTS.has(key) ? translate(value) : value;
    });
  }
  const batteryAlert = source.match(/^(.+)%\. Підключіть зарядний пристрій\.$/);
  if (batteryAlert) return activeLanguage === "uk"
    ? source
    : `${batteryAlert[1]}%. Connect the charger.`;
  const searchEmpty = source.match(/^Nothing matches “(.+)”\. Try a simpler word\.$/);
  if (searchEmpty && activeLanguage === "uk") return `За запитом «${searchEmpty[1]}» нічого не знайдено. Спробуйте простіше слово.`;
  const foundCount = source.match(/^(\d+) settings found\.$/);
  if (foundCount && activeLanguage === "uk") {
    const count = Number(foundCount[1]);
    return plural(count, { one: "Знайдено {count} налаштування.", few: "Знайдено {count} налаштування.", many: "Знайдено {count} налаштувань.", other: "Знайдено {count} налаштування." }, "uk");
  }
  const changesTo = source.match(/^Changes to (.+)$/);
  if (changesTo && activeLanguage === "uk") return `Зміни у файлі ${changesTo[1]}`;
  const restUk = source.match(/^(\d+) сесія зараз неактивна\. Вона з’явиться тут, коли відновить роботу\.$|^(\d+) сесії зараз неактивні\. Вони з’являться тут, коли відновлять роботу\.$|^(\d+) сесій зараз неактивні\. Вони з’являться тут, коли відновлять роботу\.$/);
  if (restUk && activeLanguage === "en") {
    const count = Number(restUk[1] ?? restUk[2] ?? restUk[3]);
    return plural(count, {
      one: "{count} session is at rest. It will appear here when it works again.",
      other: "{count} sessions are at rest. They will appear here when they work again.",
    }, "en");
  }
  const rest = source.match(/^(\d+) session is at rest\. It will appear here when it works again\.$|^(\d+) sessions are at rest\. They will appear here when they work again\.$/);
  if (rest) {
    const count = Number(rest[1] ?? rest[2]);
    return activeLanguage === "uk"
      ? plural(count, {
          one: "{count} сесія зараз неактивна. Вона з’явиться тут, коли відновить роботу.",
          few: "{count} сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
          many: "{count} сесій зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
          other: "{count} сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
        }, "uk")
      : plural(count, {
          one: "{count} session is at rest. It will appear here when it works again.",
          other: "{count} sessions are at rest. They will appear here when they work again.",
        }, "en");
  }
  return source;
}

function sourceAndSpace(source: string): { lead: string; core: string; tail: string } {
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return { lead: match[1]!, core: match[2]!, tail: match[3]! };
}

// Agent output, project/session metadata and code are content, not interface copy.
// Exact phrase translations must never rewrite a user's or agent's own words.
const USER_CONTENT_SELECTOR = [
  "code", "pre", "[data-i18n-off]", ".sess-said", ".sess-asked",
  ".sess-tool", ".sess-sub-task", ".sess-model", ".sess-result-text",
  ".hf-doing", ".gh-diff", ".gh-row-title", ".proj-name", ".hb-who .name",
  ".jr-q", ".jr-asked", ".q-prompt", ".q-title", ".q-row", ".q-opt", ".q-chip",
  ".rb-note", ".media-title", ".media-artist", ".rem-text", ".next-text",
  ".who-proj", ".who-asker .n", ".sess-asked",
].join(",");
function isUserContent(element: Element | null): boolean {
  return !!element?.closest(USER_CONTENT_SELECTOR);
}

function translateTextNode(node: Text) {
  if (isUserContent(node.parentElement)) return;
  const existing = textSource.get(node);
  const source = existing && node.data === existing.rendered ? existing.source : node.data;
  if (!source.trim()) return;
  const { lead, core, tail } = sourceAndSpace(source);
  const rendered = `${lead}${translate(core)}${tail}`;
  textSource.set(node, { source, rendered });
  if (node.data !== rendered) {
    if (__NOOK_DEV_BUILD__ && isShelfTraceSourceRecording() && node.parentElement?.closest(".home")) {
      const classes = [...(node.parentElement.classList ?? [])].filter((name) => /^[a-z0-9_-]+$/i.test(name)).slice(0, 3).join(".") || "node";
      shelfTrace("home-translation", { locale: activeLanguage, source: `i18n.${classes}`, mutationType: "text", changed: true, count: 1 });
    }
    node.data = rendered;
  }
}

const LOCALIZED_ATTRIBUTES = ["title", "aria-label", "aria-description", "placeholder", "alt"] as const;
function translateAttributes(element: Element) {
  if (isUserContent(element)) return;
  let records = attrSource.get(element);
  for (const attribute of LOCALIZED_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const value = element.getAttribute(attribute) ?? "";
    records ??= new Map();
    const existing = records.get(attribute);
    const source = existing && value === existing.rendered ? existing.source : value;
    const rendered = translate(source);
    records.set(attribute, { source, rendered });
    if (value !== rendered) {
      if (__NOOK_DEV_BUILD__ && isShelfTraceSourceRecording() && element.closest(".home")) {
        const classes = [...element.classList].filter((name) => /^[a-z0-9_-]+$/i.test(name)).slice(0, 3).join(".") || element.tagName.toLowerCase();
        shelfTrace("home-translation", { locale: activeLanguage, source: `i18n.${classes}`, mutationType: attribute, changed: true, count: 1 });
      }
      element.setAttribute(attribute, rendered);
    }
  }
  if (records) attrSource.set(element, records);
}

function translateTree(root: Node) {
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { translateTextNode(node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName;
    if (["SCRIPT", "STYLE"].includes(tag) || isUserContent(element)) return;
    translateAttributes(element);
    for (const child of Array.from(element.childNodes)) visit(child);
  };
  visit(root);
}

/** Synchronously localizes a detached or not-yet-visible subtree before its first paint. */
export function localizeSubtree(root: Node) {
  translateTree(root);
}

const observer = typeof MutationObserver !== "undefined" && typeof document !== "undefined"
  ? new MutationObserver((records) => {
      const traceHome = __NOOK_DEV_BUILD__ && isShelfTraceSourceRecording();
      const homeGroups = traceHome ? new Map<string, { target: string; type: string; count: number }>() : null;
      let homeMutationRecords = 0;
      for (const record of records) {
        if (traceHome) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest(".home")) {
            homeMutationRecords++;
            const classes = [...target.classList].filter((name) => /^[a-z0-9_-]+$/i.test(name)).slice(0, 2);
            const label = classes.length ? classes.join(".") : target.tagName.toLowerCase();
            const key = `${label}|${record.type}`;
            const group = homeGroups?.get(key);
            if (group) group.count++;
            else homeGroups?.set(key, { target: label, type: record.type, count: 1 });
          }
        }
        if (record.type === "characterData" && record.target instanceof Text) translateTextNode(record.target);
        else if (record.type === "attributes" && record.target instanceof Element) translateAttributes(record.target);
        else for (const node of Array.from(record.addedNodes)) translateTree(node);
      }
      if (homeMutationRecords) shelfTrace("home-mutation-observer", { source: "MutationObserver", count: homeMutationRecords });
      if (homeGroups) {
        for (const group of homeGroups.values()) {
          shelfTrace("home-mutation", { source: group.target, mutationType: group.type, count: group.count });
        }
      }
    })
  : null;
if (observer && typeof document !== "undefined" && document.documentElement) {
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...LOCALIZED_ATTRIBUTES] });
  translateTree(document.documentElement);
}

/** Updates current UI text and accessible labels in place; it does not rebuild stateful views. */
export function setLanguage(language: Language, source = "unspecified") {
  const previous = activeLanguage;
  activeLanguage = language;
  if (__NOOK_DEV_BUILD__ && previous !== language) {
    shelfTrace("locale-runtime-change", { previousLocale: previous, newLocale: language, locale: language, source });
  }
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = language;
    translateTree(document.documentElement);
  }
}

export interface PluralForms { one: string; few?: string; many?: string; other: string }
export function plural(count: number, forms: PluralForms, language = activeLanguage): string {
  const category = new Intl.PluralRules(language).select(count);
  const form = category === "one" ? forms.one : category === "few" ? (forms.few ?? forms.other) : category === "many" ? (forms.many ?? forms.other) : forms.other;
  return form.replaceAll("{count}", new Intl.NumberFormat(language).format(count));
}
