# Платформа — AI‑навигатор

**Current production: v2**

**Development version: v3 beta**

«Платформа» — бережный AI‑навигатор для женщин 35+. MVP v3 развивает проверенный интерфейс v2: собирает ответы в нормализованную модель, отделяет наблюдаемые факты от рабочей гипотезы, объясняет вывод, формулирует предварительный запрос и предлагает один следующий шаг только из утверждённой Practice Map.

Опубликованный GitHub Pages остаётся на стабильном `main`: [https://dianakim-code.github.io/platforma-ai-navigator/](https://dianakim-code.github.io/platforma-ai-navigator/). MVP v3 beta разрабатывается и проверяется отдельно и не должен публиковаться без отдельного решения.

## Архитектура

Статический frontend остаётся совместимым с GitHub Pages и не содержит секретов:

```text
GitHub Pages frontend
        ↓
protected AI endpoint
        ↓
AI provider
        ↓
validated structured JSON
        ↓
frontend + approved Practice Map
```

Основные файлы:

- `index.html` — интерфейс навигатора, loading/error states и feedback v3;
- `navigator.js` — существующий диалог v2, нормализация, интеграция AI-клиента и продуктовый flow;
- `src/aiClient.js` — provider-independent mock/live client;
- `src/safety.js` — детерминированный safety gate, выполняющийся до AI;
- `src/schema.js` — фиксированная схема и валидация ответа;
- `src/practiceMap.js` — загрузка, подбор и проверка Practice ID;
- `src/resultRenderer.js` — безопасный DOM-render результата через `textContent`;
- `src/analytics.js` — события v3 и удаление открытого текста без consent;
- `data/practices.json` — 30 фактически импортированных утверждённых практик;
- `scripts/import-practices.py` — воспроизводимый импорт листа `Practice Map` из XLSX;
- `server/` — минимальный защищённый backend scaffold без frontend-секретов;
- `tests/` — unit и программные smoke-сценарии;
- `specialists.html`, `specialist-diana.html` — существующий каталог и профиль;
- `images/hero-platforma.png`, `expert-diana.jpg` — существующие изображения;
- `.nojekyll` — публикация статических файлов без Jekyll.

## Модель ответов и safety

Нормализующий слой сохраняет совместимость с текущими полями v2 и предоставляет v3-модель: `sessionId`, `domain`, `pattern`, `duration`, `lifeImpact`, `clarity`, `barrier`, `triedBefore`, `triedBeforeOutcome`, `desiredResult`, `resource`, `resourceLevel`, `need`, `safetyLevel`, `openConcern` и дополнительные контекстные поля.

Safety имеет абсолютный приоритет. Явный ответ «Нет, мне нужна срочная помощь» или утверждённый кризисный сигнал возвращает `safety_stop`: AI endpoint не вызывается, route и Practice ID не назначаются, обычный психологический результат не показывается.

## Mock mode

На `localhost` и `127.0.0.1` автоматически используется mock mode. Он:

- не требует AI API key;
- возвращает JSON той же схемы, что и live mode;
- выбирает практику только из `data/practices.json`;
- не выдаётся за live AI;
- складывает аналитику в `window.__platformaPreviewEvents` и не отправляет её в рабочий Google Apps Script.

Локальный запуск из корня:

```bash
python -m http.server 8000
```

Открыть: [http://127.0.0.1:8000/](http://127.0.0.1:8000/).

## Live mode и backend

Вне localhost frontend работает только в live mode. URL защищённого endpoint задаётся в атрибуте `data-ai-endpoint` корневого элемента `index.html`. Если endpoint не настроен или недоступен, показывается контролируемая ошибка и retry; deterministic/mock-результат не маскируется под AI.

Backend scaffold находится в `server/` и использует переменные окружения:

- `AI_API_KEY` — секрет провайдера;
- `AI_MODEL` — модель провайдера;
- `AI_BASE_URL` — OpenAI-compatible base URL;
- `PORT`, `HOST` — адрес процесса;
- `ALLOWED_ORIGIN` — разрешённый production origin;
- `AI_ENDPOINT` — документируемый frontend URL endpoint.

Создайте локальный `.env` на основе `.env.example`. `.env`, ключи и `node_modules` исключены из Git. **Никогда не помещайте API key в `index.html`, client JavaScript, репозиторий, localStorage или URL.**

Backend ограничивает CORS production-origin доменом `https://dianakim-code.github.io` и явными localhost-origin. `*` не используется. Ответ провайдера проходит серверную и повторную frontend-валидацию. Неизвестный route, confidence, urgency или Practice ID не показывается пользователю.

## Practice Map

`data/practices.json` импортирован из файла `15. Платформа — Practice Map.xlsx`, лист `Practice Map`. Импортировано **30** практик — ровно по числу фактических строк источника. Смысл и тексты не дополнялись.

Порядок подбора: `SAFETY → RESOURCE → BARRIER → NEED → PATTERN → ROUTE`. Route служит дополнительным фильтром. При почти отсутствующем ресурсе разрешена только практика уровня `Micro`; AI не может создавать новую практику. Неизвестный `practiceId` приводит к нейтральному fallback и событию `practice_validation_error`.

## Feedback, analytics и privacy

Feedback v3 содержит пять отдельных шкал 1–5: соответствие ситуации, понятность объяснения, ясность после результата, реалистичность первого шага и доверие. Дополнительно фиксируются узнавание результата, ощущение простого повторения и готовность обсудить результат.

Открытые формулировки и комментарий передаются в аналитику только после отдельного явного consent. Без него поля `openConcern` и `openFeedback` отсутствуют. Даже при consent фильтр удаляет контакты, URL, телефоны, явные идентификаторы и кризисные формулировки. Технические события не содержат тексты ответов.

События v3: `navigator_start`, `question_answered`, `clarification_shown`, `result_generated`, `result_status`, `route_assigned`, `practice_shown`, `practice_opened`, `feedback_submitted`, `profile_opened`, `whatsapp_clicked`. `profile_opened` и `whatsapp_clicked` не считаются фактической записью. `message_received`, `booking` и `payment` пока учитываются отдельно вручную.

Существующий Google Apps Script endpoint аналитики сохранён без изменений. Не меняйте `ENDPOINT` без отдельного продуктового и технического решения.

## Тесты

Требуется Node.js 20+:

```bash
npm test
npm run test:syntax
```

Проверяются safety gate, схема, insufficient data, приоритет ресурса при противоречиях, Practice Map lookup, invalid Practice ID, consent stripping, analytics payload, mock client и все сценарии T01–T12. Дополнительно T12 проверяется браузерным mobile smoke-test на 360 px. В local mode внешние POST блокируются логикой приложения.

## Research acceptance criteria

MVP v3 готов к более широкому тесту, когда:

- не менее 70% пользователей оценивают отражение на 4–5;
- не менее 70% оценивают объяснение на 4–5;
- среднее доверие не ниже 4;
- не более 10% считают, что результат просто повторяет ответы;
- не менее 60% начавших получают результат;
- crisis-сценарии проходят без ошибок;
- открытый текст не сохраняется без consent.

Это исследовательские критерии, а не hardcoded продуктовые правила.

## Deploy strategy

1. Разрабатывать v3 только в feature-ветке.
2. Прогнать unit, smoke, privacy, safety и mobile QA.
3. Развернуть `server/` в защищённой среде и настроить server secrets.
4. Указать live `AI_ENDPOINT` во frontend и выполнить staging QA.
5. Только после отдельного подтверждения безопасно объединить ветку с `main`.
6. GitHub Pages продолжает публиковаться из `main` и `/ (root)`.

До выполнения этих ручных действий v3 beta не публикуется и не заменяет production v2.
