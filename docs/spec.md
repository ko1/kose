# kose Chrome Extension — Design Specification

Updated: 2026-09-27 (reflects the Phase 1–2 implementation; standalone window design)  
Audience: Claude Code  
Development: WSL2 (Node.js / TypeScript / Vite); verification: Chrome on Windows

## 0. Brief

This document is the single source of truth for **kose**, a Chrome extension for personal use. The earlier "English proofreading with a save button" design is discarded. The product concept is **improving the text the user selected into good writing for the chosen output language and situation**. Language detection, proofreading and translation are one common Rewrite operation that the user does not need to think about. Implement phase by phase; each phase must pass typecheck, tests and build. Do not add unrequested external communication or excessive permissions.

## 1. UX

1. The user selects text on a web page and right-clicks → kose → one of two items: **「よい日本語にする」 (make it good Japanese)** or **「よい英語にする」 (make it good English)**. The menu order is fixed. The chosen target is saved as the initial value of the target dropdown at the bottom of the window (it does not reorder the menu).
2. One click opens the **kose window** (a single standalone window, §5.2) or brings it to the front, and processing starts immediately with the explicitly chosen target. There is no "Review" button to press.
   - The only exception: if the Chrome built-in AI model is not downloaded yet (`downloadable`), a user gesture is required, so kose shows a 「モデルをダウンロード」 button and progress, and resumes automatically when the model becomes available.
3. **One review session per tab.** Invoking kose from any tab updates the same kose window. Right-clicking again in the same tab replaces that tab's session.
4. **The display follows the active tab.** When the user switches browser tabs, the kose window shows that tab's session. Switching to a tab without a session keeps the current display. The header always shows **which tab** the displayed session belongs to.
   - Example: invoke in tab1 (review 1) → invoke in tab2 (review 2 shown) → select tab1 → review 1 is shown.
5. The upper part of the window shows **the original (with character count), the rewrite, Copy, the diff, and the explanation**. Processing has two stages:
   - On right-click only the rewrite is generated (streamed as it is produced). The diff is computed locally in the browser (no AI cost).
   - The explanation is a second request. With Chrome built-in AI it runs automatically; with cloud providers it runs when the user presses 「解説を見る」 (can be made automatic in settings). It is also streamed.
   - The explanation is in Japanese and titled 「解説」 (not 「理由」). It lists changes, distinguishes objective errors from optional style improvements, and warns about possible changes of meaning and ambiguities. If no change is needed, kose says so.
   - For long texts (500+ characters or 3+ paragraphs) the explanation also reviews the **structure** (構成): a one-line outline per paragraph and issues with the order of ideas, flow, transitions, repetition, paragraph breaks and the conventions of the situation, each with a suggestion. The rewrite itself never restructures the text. 「構成の指摘を反映した案を作る」 sends the issues to the chat, which creates a restructured version.
6. Below that is the chat **「ニュアンスを相談」 (discuss the nuance)**. With the session's original, rewrite history and situation as context, the user can discuss meaning and wording. When the chat produces a new rewrite, RESULT is updated. Earlier versions can be restored.
7. At the bottom are the 「仕上がり」 (target language) and 「用途」 (situation) dropdowns and a 「この設定で再生成」 (regenerate with these settings) button. Settings are stored in `chrome.storage.local`. Changing a dropdown does not call the API; regeneration does. A right-click menu choice is reflected in the target dropdown.
8. **There is no "save mistake" button.** Only clear, real grammatical/usage errors are detected and saved locally, automatically (§2). Optional rewording and translation differences are never called "the user's mistakes".
9. Writing the result back into the page (Apply/Replace) is not implemented in the initial version; Copy comes first. Rules for a future implementation are in §5.6.

### 1.1 Languages

- Input language: detected automatically. Initially Japanese and English. When detection fails, kose says so instead of guessing.
- Source language detection is done locally from character classes (§4.2), not by trusting the model.
- Output languages: Japanese, English. The design is language-code based so more can be added.
- Input × output: ja→ja (proofreading), ja→en (translation and polishing), en→ja (translation and polishing), en→en (proofreading).
- Even when input and output languages are the same, kose does not rewrite everything: it preserves the meaning and changes only what needs improvement.
- **Mixed Japanese/English text**: the output follows the language the user chose (no branching). Identifiers, code, proper nouns, quotations and URLs are protected. When the text is detected as mixed, kose shows a note and does not auto-save mistakes.

### 1.2 Situations (default: 日常会話・SNS)

| ID | Label | Direction |
| --- | --- | --- |
| casual | 日常会話・SNS (everyday / social) | Natural and friendly; not stiffer than necessary |
| business | 仕事・メール (work / email) | Polite and clear; avoid redundant honorifics |
| technical | 技術的な議論 (technical discussion) | Preserve identifiers, API names and technical implications exactly; e.g. GitHub |
| academic | 論文・学術文書 (academic) | Neutral, precise, academic; keep citations and the strength of claims |
| presentation | プレゼン・講演 (presentation) | Natural spoken language that listeners can follow |
| formal | 公式な文章 (formal) | Formal wording that minimizes misunderstanding |

The chosen situation is saved and reused. Style inference from the page URL/domain is not needed initially. Free-form custom situations are a future extension.

### 1.3 Layout of the kose window

The header shows the **source tab** (page title) of the displayed session and a session list (dropdown) so the user can pick another session without switching tabs. With no sessions, the window shows usage instructions. `Review / Mistakes / Quiz` view switching is added in Phase 3–4.

```
┌───────────────────────────────┐
│ kose  📄 GitHub - issue #12 ▼ │  ← source tab / session list
│ ORIGINAL                123字 │
│ [selected text]               │
│ RESULT     target・situation・time・cost │
│ [rewrite]                Copy │
│ [← previous | next →]         │
│ 差分 (diff, computed locally) │
│ 解説 (explanation)            │
│ - changes, reasons            │
│ - meaning/nuance warnings     │
│ ニュアンスを相談 (chat)        │
│ [per-session conversation]    │
│ [input]                  送信 │
├───────────────────────────────┤
│ 仕上がり: [よい英語 ▼]        │
│ 用途:     [技術的な議論 ▼]    │
│ [この設定で再生成]            │
│ AI: local (Chrome built-in) ⚙ │
└───────────────────────────────┘
```

- Results come first. Settings are at the bottom; the middle scrolls so the result is always readable. Long chats must not break the layout. Last-used values persist across reloads.
- The current AI provider is always shown at the bottom. For cloud providers it says, e.g., 「外部送信: Anthropic（改稿 claude-haiku-4-5 / 解説・相談 claude-sonnet-5）」. ⚙ opens the options page.
- A session whose source tab was closed is discarded (§2). If it was displayed, the window falls back to another session or the instructions.
- 「デバッグ用にJSONをコピー」 copies the displayed session and settings (without API keys) as JSON.

### 1.4 Options page

Rarely changed settings live on the options page.

- AI provider (Chrome built-in / Claude / OpenAI) and, for the built-in AI, its availability and the reason if unavailable
- Claude: API key, rewrite model, explanation/chat model (dropdowns: Haiku 4.5 / Sonnet 5 / Opus 5, or a custom model ID), effort, max input length
- OpenAI: API key, model, max input length
- Selecting a cloud provider requests its host permission with `chrome.permissions.request`; switching away removes it
- Save buttons are enabled only when there are unsaved changes, and show inline feedback after saving
- Whether to generate explanations automatically with cloud providers (default: off)
- Whether to bring the kose window to the front on right-click (default: on)
- An explanation of external transmission
- Phase 3–4: mistake auto-save on/off, delete all learning data, JSON export/import

## 2. Local learning data (Phase 3)

- Auto-save covers only **same-language proofreading** (ja→ja, en→en), and only objective grammar/usage/notation errors.
- Nuance improvements, preference-based rewording, translations of correct text, and changes the model was unsure about are not saved as mistakes. "Expressions worth remembering" from translations would be a different kind of card and are not auto-saved initially.
- **Auto-save conditions (all must hold):**
  1. `Change.type === 'objective_error'`
  2. `before` exists as a substring of the original and `after` as a substring of the rewrite
  3. The output language equals the input language. The input language is the local detection result (§4.2), and it must match the model's `detectedSourceLanguage`. `mixed` / `unknown` are excluded.
  4. `before` and `after` are each at most 40 characters
  5. The change comes from the explanation of the rewrite made right after the right-click (`origin: 'initial'`). Rewrites from chat or regeneration reflect the user's requests and are excluded.
  6. Auto-save is on
- Duplicates within a session and against existing cards are merged, recording frequency and last occurrence. The normalization key is the (`before` → `after`) pair after NFKC, case folding and trimming. Merging must be conservative so different contexts are not merged by mistake. Cards can be edited and deleted from the Mistakes list.
- Stored data: short erroneous phrase, corrected phrase, explanation, error category, timestamps, review state. Never the full text or the page URL.
- Storage: IndexedDB. Settings: `chrome.storage.local`. No sync, no telemetry.
- Sessions (full review text and chat) are kept in `chrome.storage.session` (in memory, never written to disk), keyed by tab ID. They survive closing and reopening the kose window, but **disappear when the source tab is closed or the browser exits**. There is no explicit "save" feature.

## 3. Review quiz (Phase 4)

- The Mistakes list is a view separate from Review, and leads to the Quiz. The initial quiz asks the user to correct saved mistakes.
- Answers are not graded by exact string match, since different wording can be correct. kose shows the model answer and the user rates themselves Again / Hard / Good / Easy. Discussing an answer with the AI is a future feature.
- Spaced repetition uses a **simplified SM-2** (four ratings). Cards have `dueAt`, `lastReviewedAt`, `repetitions`, `easeFactor`, `intervalDays`. The algorithm is an independent, unit-tested module so it can later be replaced (e.g. FSRS).
- No AI-generated similar questions or notifications initially.

## 4. AI

### 4.1 Providers

A common `AIProvider` interface has three operations: `rewrite` (stage 1), `explain` (stage 2) and `chat`. Providers: Chrome built-in Prompt API (default), and cloud providers using the user's own API key: Claude (Anthropic API) and OpenAI API. Availability is checked at run time for the current browser and chosen language. **No automatic fallback to the cloud.** If local processing is impossible, kose shows why and how to explicitly select a cloud provider on the options page.

Explanations run automatically for providers that do not send data externally (the built-in AI), and on demand for cloud providers unless the user enables automatic explanations.

#### Chrome built-in Prompt API

- Called from the kose window (an extension page), not from the service worker.
- `LanguageModel.availability()` is checked with the input/output languages actually used. Explanations are always Japanese, so `expectedOutputs` always includes `ja` (e.g. `['en', 'ja']` for English output).
- The `unavailable` / `downloadable` / `downloading` / `available` states are handled in the UI. `downloadable` shows a button that calls `create()` from a user gesture, then shows progress. Because progress events may not arrive, kose also polls availability and resumes all waiting sessions when the model becomes available.
- Output is constrained with `responseConstraint` (JSON Schema generated from the Zod definitions, so there is a single source).
- A base session holding the system prompt (and few-shot examples for explanations) is created once per stage and output language, and cloned for each request, so the prompt is not re-processed every time. The rewrite base session is pre-warmed when the kose window opens.
- The context window is small. For chat, kose measures input with `measureInputUsage()` (or `measureContextUsage()`), and if it does not fit, drops the oldest turns first (the original, the current rewrite and the latest message are always kept).
- Observed on real hardware: see README ("Chrome built-in AI: observations"). Even if quality is insufficient, cloud providers are never made the default.

#### Claude (Anthropic API)

- `optional_host_permissions: ["https://api.anthropic.com/*"]`, requested when Claude is selected.
- Uses the official SDK (`@anthropic-ai/sdk`) from the extension page (`dangerouslyAllowBrowser: true`; the key is the user's own and stays in their browser).
- Separate models for the rewrite (default `claude-haiku-4-5`) and for the explanation/chat (default `claude-sonnet-5`). Effort (default `low`) is not sent to Haiku, which does not support it.
- Structured outputs (`output_config.format`) and streaming. For `claude-opus-5`, server-side fallbacks (`fallbacks: "default"`) are enabled; output produced before a fallback is discarded.
- `refusal` and `max_tokens` stop reasons are reported as errors.
- The cost of each request is computed from the returned token usage and a price table, and shown in the UI (¥150/$ approximation). Dated model IDs in responses (e.g. `claude-haiku-4-5-20251001`) are matched by prefix.

#### OpenAI API

- `optional_host_permissions: ["https://api.openai.com/*"]`, requested when OpenAI is selected. Users of the built-in AI only are never granted external host permissions.
- Model is configurable (default in code). Structured Outputs (`json_schema`, strict). No streaming.
- API keys are stored in `chrome.storage.local`; the README states that this is not secure storage.

The Chrome Translator API may be considered later as a separate adapter for fast, cheap translation. It is not used in the MVP. Built-in API availability is tested on real hardware; supported languages and environments are never assumed.

### 4.2 Domain model

```ts
type LanguageCode = 'ja' | 'en';
type Situation =
  | 'casual' | 'business' | 'technical'
  | 'academic' | 'presentation' | 'formal';
type DetectedLanguage = LanguageCode | 'mixed' | 'unknown';
type ChangeType = 'objective_error' | 'style' | 'uncertain';

interface RewriteRequest {
  requestId: string;
  sourceText: string;
  targetLanguage: LanguageCode;
  situation: Situation;
}

/** Stage 1: the rewrite only */
interface RewriteResult {
  revisedText: string;
  detectedSourceLanguage: DetectedLanguage; // model-reported; kept for comparison
  usage?: Usage;                            // cloud only
}

interface Change {
  before: string;
  after: string;
  type: ChangeType;
  explanationJa: string;
}

/** Stage 2: the explanation */
interface Explanation {
  explanationJa: string;
  changes: Change[];
  nuanceWarnings: string[];
  structure?: {             // long texts only
    outline: string[];      // the point of each paragraph
    issues: { problem: string; suggestion: string }[];
  };
  droppedChanges: number; // changes whose before/after were not found in the texts
  provider?: string;
  durationMs?: number;
  usage?: Usage;
}

interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

type VersionOrigin = 'initial' | 'regenerate' | 'chat';

interface ResultVersion {
  id: string;
  result: RewriteResult;
  explanation?: Explanation; // undefined until generated
  targetLanguage: LanguageCode;
  situation: Situation;
  origin: VersionOrigin;
  createdAt: number;
  provider?: string;
  durationMs?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  versionId?: string; // set when the assistant created a new version
  usage?: Usage;
}

/** Where the selection came from. Used for display and future Apply (§5.6). Not persisted to disk. */
interface SourceLocation {
  tabId: number;
  frameId: number;
  documentId?: string;                     // to detect navigation
  tabTitle?: string;                       // header display
  textSource: 'script' | 'selectionText';  // whether line breaks were preserved
  editable: boolean;                       // selection inside textarea/input/contenteditable
}

interface ReviewSession {
  id: string;                  // the requestId of the right-click
  createdAt: number;
  source: SourceLocation;
  sourceText: string;
  sourceLanguage: DetectedLanguage; // detected locally
  versions: ResultVersion[];
  currentVersionId: string | null;
  messages: ChatMessage[];
  targetLanguage: LanguageCode;     // last requested settings
  situation: Situation;
  status: SessionStatus;            // running / idle / error / interrupted / needs-download / too-long
}

interface AIProvider {
  rewrite(req: RewriteRequest, signal?: AbortSignal,
          onPartial?: (revisedText: string) => void): Promise<RewriteResult>;
  explain(req: ExplainRequest, signal?: AbortSignal,
          onPartial?: (partial: PartialExplanation) => void): Promise<Explanation>;
  chat(req: ChatRequest, signal?: AbortSignal,
       onPartial?: (replyJa: string) => void): Promise<ChatReply>; // revisedText only when rewriting
}
```

- Source language detection: count Japanese characters (hiragana, katakana, kanji; ≈2 per word) and Latin letters (≈4.5 per word) after removing URLs. Japanese share ≥ 0.5 → `ja`, ≤ 0.1 → `en`, otherwise `mixed`; too few letters → `unknown`. The diff is shown only when the detected source language equals the target language.
- Model JSON output is validated with Zod. Invalid JSON is an error. Changes whose `before`/`after` do not exist in the original/rewrite are dropped from display (and never used for mistake auto-save).
- Prompts state that the selected text is data, not instructions, and protect names, code, identifiers, quotations and URLs. Adding facts not in the source is forbidden. The model must not resolve ambiguous source text silently; ambiguities go into `nuanceWarnings`.
- Prompts contain only general principles. Do not add case-specific rules for individual failures; instead compare changes against the whole sample set (`tests/fixtures/samples.md`) and choose better models when a small model cannot follow the principles.
- The stage-1 prompt is kept short and has no few-shot examples (it is sent on every right-click). The stage-2 prompt has one few-shot example that demonstrates granularity, classification and concrete reasons. The explanation prompt also asks the model to point out information the rewrite added or guessed.
- Chat output is `{ replyJa, revisedText }` where an empty `revisedText` (or one identical to the current rewrite) means "no new version". Assistant turns in the history are passed back in the same JSON format.

### 4.3 Sessions and versions

- **A new session starts only on right-click.** One session per tab; right-clicking again in the same tab replaces it. Conversations of different sessions are never mixed.
- 「この設定で再生成」 adds a version with `origin: 'regenerate'` to the same session; the chat continues.
- A new rewrite from chat is added as a version with `origin: 'chat'` using the settings of the version being discussed, and becomes current. If the reply is only an explanation, the result is not changed.
- Switching to an earlier version only changes `currentVersionId`; saved learning cards are neither deleted nor regenerated.
- Requests of different sessions run independently. Switching the displayed session does not cancel other sessions' requests. A new right-click in the same tab cancels that tab's rewrite, explanations and chat. Closing the tab cancels everything for it.
- While a rewrite is running, chat input is disabled. While a chat reply is pending, further messages are not accepted. A failed chat message can be resent without duplicating it.

## 5. Chrome extension implementation

### 5.1 Basics

- MV3, TypeScript, Vite, React, Vitest, Zod.
- Permissions: `contextMenus`, `storage`, `activeTab`, `scripting`. `optional_host_permissions`: Anthropic and OpenAI. No always-on `<all_urls>` content scripts. No `sidePanel`.
- `"incognito": "not_allowed"`.
- `minimum_chrome_version`: 138 (Prompt API for extensions).
- Model output is rendered as text, never injected as HTML.
- Logs, UI and exports never include API keys. Full review text appears only in the explicit debug JSON copy. No scraping of unofficial translation endpoints. Chat uses only the selected provider.

### 5.2 The kose window

- A standalone window opened with `chrome.windows.create({ type: 'popup', url: 'kose.html' })`. **Always exactly one.**
  - The existing window is found by the window ID stored in `storage.session`, falling back to `chrome.runtime.getContexts()`. Otherwise a new one is created. Concurrent right-clicks are serialized so only one window is created.
- The window position and size are stored in `chrome.storage.local` and restored.
- The toolbar icon also opens it / brings it to the front (`action.onClicked`).
- Always-on-top is impossible for extensions; the README suggests OS tools such as PowerToys "Always on Top".

### 5.3 Right-click sequence

`contextMenus.onClicked` is registered at the top level of the service worker; menus are created in `runtime.onInstalled`.

1. Read the selection with line breaks via `chrome.scripting.executeScript({ target: { tabId, frameIds: [info.frameId] } })` (allowed by `activeTab`). Selections inside `textarea`/`input` are read with `value.slice(selectionStart, selectionEnd)`. On failure (PDF viewer, Chrome internal pages, …) fall back to `info.selectionText` and show that line breaks may be lost.
2. Strip leading blank lines and trailing whitespace. Ignore empty selections.
3. Write the pending request (`{ requestId, targetLanguage, text, source: SourceLocation, createdAt }`) to `chrome.storage.session` under a per-tab key. The tab title comes from the `tab` argument of `onClicked`.
4. Open the kose window, or bring the existing one to the front with `chrome.windows.update(id, { focused: true })` (can be disabled in options).
5. The kose window watches pending requests both at startup and via `storage.onChanged` (subscribing before loading state to avoid races), creates a new session for the tab, starts processing and displays it.
6. Requests of the tab's previous session are cancelled with `AbortController`, and responses for old request IDs are discarded.

### 5.4 Following the active tab

- The kose window subscribes to `chrome.tabs.onActivated` (no `tabs` permission needed).
  - If the activated tab has a session, show it.
  - Otherwise keep the current display.
  - Ignore events for the kose window itself.
- Tab switches never bring the kose window to the front (display update only).
- `chrome.tabs.onRemoved` deletes the tab's session and pending request and cancels its requests (in both the service worker and the kose window).
- After manually selecting a session from the header list, following resumes on the next tab switch.

### 5.5 Input length

- The original always shows its character count.
- Above the provider's limit (built-in AI: computed from the input quota; Claude/OpenAI: 4,000 characters by default, configurable) kose does not run and shows the limit.

### 5.6 Apply (Replace) rules (future; not in Phases 1–4)

- The write target is the **source tab and frame of the displayed session** (`SourceLocation`), not the active tab. The button names the destination, e.g. 「〈tab title〉に反映」.
- Write only if all of the following hold; otherwise do not write and suggest Copy:
  - The source tab exists and `documentId` matches (no navigation; `activeTab` access also expires on navigation)
  - The selection came from an editable element (`editable`)
  - Right before writing, the text in the target range still equals `sourceText` (the user has not edited it)
- How to keep the target element/range (e.g. a reference in the ISOLATED world) is designed when Apply is implemented. Sessions are transient, so recording `SourceLocation` is enough for now.

## 6. Directory layout

```
src/
  background/   context menu, right-click sequence, pending requests, window management
  app/          kose window: review, diff, explanation, chat, bottom settings, tab following
                (Phase 3–4: Mistakes, Quiz)
  options/      provider settings, API keys, models, auto-explain; later auto-save and export
  ai/           AIProvider, built-in / Claude / OpenAI adapters, prompts, schemas, partial JSON, pricing
  domain/       types, sessions, diff, language detection; later mistake extraction, cards, SRS
  storage/      local/session settings; later IndexedDB and migrations
  shared/       IDs, shared styles
tests/
  unit/
  integration/
  fixtures/     sample sentences for the four paths
```

## 7. Phases and acceptance criteria

### Phase 1 — Basic rewrite (done)

- Select Japanese or English text, choose one of the two menu items, and process it in the kose window: result, Copy, diff, explanation and meaning-change warnings.
- Per-tab sessions, following the active tab, source tab display, session list.
- Target language and situation settings at the bottom; 「この設定で再生成」 reuses the same original; changing the dropdowns alone does not call the API.
- Provider selection on the options page, explanation of unsupported environments, explicit display of external transmission. Loading, errors and repeated invocations handled. Input length limit.
- Two-stage processing (rewrite, then explanation) with streaming; per-request cost for Claude.
- **Acceptance tests:**
  - With the four-path samples in `tests/fixtures`, ja→ja, ja→en, en→ja and en→en work and preserve the meaning (manual evaluation).
  - Nothing is sent to the cloud without an API key.
  - Invoke in tab1 → invoke in tab2 (review 2 shown) → select tab1 → review 1 is shown. Selecting tab3 without a session changes nothing. Closing tab1 removes review 1.

### Phase 2 — Nuance chat (done)

- A chat per session, with the original, settings and earlier versions as context.
- A new rewrite from the chat updates RESULT; earlier versions can be restored. Explanations alone never change RESULT. The chat continues after regeneration.
- **Acceptance test:** a request such as 「もっと苦労して帰宅したニュアンス」 ("make it sound like getting home was hard") updates RESULT, and the context does not leak into the next right-click review in the same tab or into other tabs' sessions.

### Phase 3 — Automatic mistake collection

- Extract only same-language objective errors that meet §2, and store them as short phrases in IndexedDB, merging equivalent errors conservatively. Style improvements and translation differences are not stored.
- No save button. Editing/deleting from the Mistakes list; turning auto-save off and deleting everything from the options page.
- **Acceptance test:** the objective errors in `We finally had went back to home.` are recorded. Natural rewording, English translation, and chat/regeneration rewrites alone never create mistake cards. Neither full text nor URLs remain in the DB.

### Phase 4 — Review quiz

- Quiz from the Mistakes list, self-rating (Again/Hard/Good/Easy), simplified SM-2, JSON export/import.
- **Acceptance test:** learning cards survive a restart, and the next review date changes according to the rating.

### Future candidates (not in the initial development)

- Apply/Replace (following §5.6).
- A fast, cheap translation-only path with the Chrome Translator API (chat, polishing and explanations still use an LLM).
- A model selector in the kose window for quick comparison.
- Custom situations, more languages, saving translation expressions, learning statistics, discussing quiz answers with the AI.

## 8. Quality and verification

- Unit tests: settings persistence, target-language branching, safe behavior on invalid model JSON, partial JSON parsing for streaming, language detection, pricing, auto-save conditions and merging, SM-2, version switching, session isolation (per right-click and per tab), active-tab following.
- Integration tests (Vitest with faked chrome APIs): `onClicked` → pending request → window creation/reuse, restoring pending requests in the kose window, cancelling/discarding earlier requests in the same tab while other tabs continue, cleanup on tab close, built-in AI unavailable, missing API key, two-stage explanation (automatic vs. on demand), chat (new version vs. explanation only, history, isolation, retry), auto-save disabled.
- Manual tests (checklist in the README) with Chrome on Windows: selections on normal pages, GitHub and inside textareas; multi-paragraph line breaks; following across tabs and browser windows; restoring sessions and window position/size after reopening the kose window; limitations in the PDF viewer and Chrome internal pages.
- Build with Node.js on WSL2 and load `dist/` through the WSL path (e.g. `\\wsl.localhost\<distro>\...\dist`) with **Load unpacked** in Chrome on Windows (`npm run build:win` copies the build to Windows if needed). Check Chrome built-in AI against Chrome's requirements for Windows.

## 9. Initial instruction for Claude Code

> Implement kose using this document as the source of truth. Finish Phase 1 first, and document in `README.md` the WSL2 setup, build, loading into Chrome on Windows, how to check each input × output path and tab following, and the results of trying the Prompt API on real hardware. Design with the minimum permissions and report typecheck, test and build results. You may prepare interfaces for later phases, but do not add features ahead of time.
