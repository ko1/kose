# kose Chrome Extension — Design Specification

Updated: 2026-09-27  
Audience: Claude Code  
Development: WSL2 (Node.js / TypeScript / Vite); verification: Chrome on Windows

## 0. Brief

This document is the single source of truth for **kose**, a Chrome extension for personal use. The product concept is **improving the text the user selected into good writing for the chosen output language and situation**. Language detection, proofreading and translation are one common Rewrite operation that the user does not need to think about. Mistakes found while proofreading are collected automatically and reviewed with short quizzes. Every change must pass typecheck, tests and build. Do not add unrequested external communication or excessive permissions.

## 1. UX

1. The user selects text on a web page and invokes kose in one of three ways: the single right-click item **“kose: Make it good Japanese” / “kose: Make it good English”**, the kose toolbar button, or the **Alt+K** shortcut (`commands`, changeable at `chrome://extensions/shortcuts`). All three use the **last chosen target** (`settings.targetLanguage`): **“Make it good Japanese”** or **“Make it good English”**. The user switches the target in the kose window's “Mode” dropdown and regenerates; that choice becomes the target for the next invocation, and the menu item / button title follow it.
   - Only one right-click item exists because Chrome folds two or more top-level items of one extension into a submenu. The target cannot be inferred from the text: English text may need proofreading or translation into Japanese.
   - The toolbar button and shortcut search all frames for a selection. With no selection (or on pages scripts cannot access), they open the kose window on the **free input** (item 11).
2. One click opens the **kose window** (a single standalone window, §5.2) or brings it to the front, and processing starts immediately with the last chosen target. There is no "Review" button to press.
   - The only exception: if the Chrome built-in AI model is not downloaded yet (`downloadable`), a user gesture is required, so kose shows a “Download the model” button and progress, and resumes automatically when the model becomes available.
3. **One review session per tab.** Invoking kose from any tab updates the same kose window. Invoking again in the same tab replaces that tab's session.
4. **The display follows the active tab.** When the user switches browser tabs, the kose window shows that tab's session. Switching to a tab without a session keeps the current display. The header always shows **which tab** the displayed session belongs to.
   - Example: invoke in tab1 (review 1) → invoke in tab2 (review 2 shown) → select tab1 → review 1 is shown.
5. The upper part of the window shows **the original (with character count), the rewrite, Copy, the diff, and the explanation**. Processing has two stages:
   - On invocation only the rewrite is generated (streamed as it is produced). The diff is computed locally in the browser (no AI cost).
   - The explanation is a second request. With Chrome built-in AI it runs automatically; with cloud providers it runs when the user presses “Show explanation” (can be made automatic in settings). It is also streamed.
   - The explanation is written in the browser UI language (§1.4) and titled “Explanation”. It lists changes, distinguishes objective errors from optional style improvements, and warns about possible changes of meaning and ambiguities. If no change is needed, kose says so.
   - For long texts (500+ characters or 3+ paragraphs) the explanation also reviews the **structure** (構成): a one-line outline per paragraph and issues with the order of ideas, flow, transitions, repetition, paragraph breaks and the conventions of the situation, each with a suggestion. The rewrite itself never restructures the text. “Create a version that applies the structure suggestions” sends the issues to the chat, which creates a restructured version.
6. Below that is the chat **“Discuss the nuance”**. With the session's original, rewrite history and situation as context, the user can discuss meaning and wording. When the chat produces a new rewrite, Result is updated. Earlier versions can be restored.
7. At the top (under the header) are the “Mode” (Make it good Japanese / good English, i.e. the target language) and “Situation” dropdowns and a “Apply” (regenerate with these settings) button, enabled only when the dropdowns differ from the displayed version (or, with no version yet, from the last request) It is enabled even while something is running; while a rewrite is running it is compared with the running request's settings. Pressing it cancels every running job of the session — the rewrite, explanations and a pending chat reply — and starts over with the new settings (no need to wait, e.g. when switching from English to Japanese mid-translation). A cancelled explanation can be requested again with “Show explanation”; a chat message whose reply was cancelled stays in the conversation without a reply. A chat reply that arrives while a rewrite is running is discarded. Settings are stored in `chrome.storage.local`. Changing a dropdown does not call the API; regeneration does. The “Mode” value is also the target of the next invocation (item 1).
8. **There is no "save mistake" button.** Only clear, real grammatical/usage errors are detected and saved locally, automatically (§2). Optional rewording and translation differences are never called "the user's mistakes".
9. While the rewrite runs, one due mistake may be shown as a quiz (§3).
10. Writing the result back into the page (Apply/Replace) is not implemented; the result is copied with Copy. Rules for implementing it are in §5.6.
11. **Free input** (“✏️ Free input”, like Emacs's `*scratch*`): a text area in the kose window for text that is not on a page. Ctrl+Enter (or “kose”) runs kose on it with the current “Mode” and “Situation”, exactly like a selection; the result is shown below the text area with the usual review display. The draft is kept after running.
    - Shown when kose is invoked with no selection (the text area gets focus), when there are no sessions (with a one-line hint about the other ways to invoke kose), and when “✏️ Free input” is chosen in the header's session list, where it is always the first item.
    - The free-input review is a session with the special tab ID `SCRATCH_TAB_ID = -1` and `source: { tabId: -1, frameId: 0, tabTitle: <“Free input” in the UI language>, textSource: 'script', editable: false }`. It behaves like a tab's session (one at a time; running again replaces it; waiting-time quiz; mistakes are recorded), but no browser tab closes it, so it lasts until the browser exits.
    - The draft is saved in `chrome.storage.session` (never written to disk), like sessions.
12. **Launch from outside Chrome** (e.g. a Windows shortcut, Ctrl+Alt+K): `chrome.exe "chrome-extension://<ID>/launch.html"` opens a small extension page. It reads the clipboard (`clipboardRead`; `navigator.clipboard.readText()`, falling back to `document.execCommand('paste')`), writes `scratchRequest` with the text, opens the kose window or brings it to the front, and closes its own tab. The kose window replaces the free-input draft with the text and runs it immediately. With an empty or unreadable clipboard it just opens the free input. Windows does not handle `chrome-extension://` itself, so the URL is passed to `chrome.exe`; no resident process is needed.

### 1.1 Languages

- Input language: detected automatically (Japanese and English). When detection fails, kose says so instead of guessing.
- Source language detection is done locally from character classes (§4.2), not by trusting the model.
- Output languages: Japanese, English. The design is language-code based so more can be added.
- Input × output: ja→ja (proofreading), ja→en (translation and polishing), en→ja (translation and polishing), en→en (proofreading).
- Even when input and output languages are the same, kose does not rewrite everything: it preserves the meaning and changes only what needs improvement.
- **Mixed Japanese/English text**: the output follows the language the user chose (no branching). Identifiers, code, proper nouns, quotations and URLs are protected. When the text is detected as mixed, kose shows a note and does not auto-save mistakes.

### 1.2 Situations (default: casual)

| ID | Label (English UI / Japanese UI) | Direction |
| --- | --- | --- |
| casual | Casual / social media / 日常会話・SNS | Natural and friendly; not stiffer than necessary |
| business | Work / email / 仕事・メール | Polite and clear; avoid redundant honorifics |
| technical | Technical discussion / 技術的な議論 | Preserve identifiers, API names and technical implications exactly; e.g. GitHub |
| academic | Academic writing / 論文・学術文書 | Neutral, precise, academic; keep citations and the strength of claims |
| presentation | Presentation / talk / プレゼン・講演 | Natural spoken language that listeners can follow |
| formal | Formal document / 公式な文章 | Formal wording that minimizes misunderstanding |

The chosen situation is saved and reused. The situation is not inferred from the page URL/domain. There are no custom situations.

### 1.3 Layout of the kose window

The header shows the **source tab** (page title) of the displayed session and a session list (dropdown) so the user can pick another session without switching tabs. The list always starts with “✏️ Free input”. With no sessions, the window shows the free input with a one-line hint about the other ways to invoke kose. When mistake cards are due, the header shows a “Review N” button that switches the main area to a quiz over those cards (§3); a new invocation switches back to the review. The list of saved mistakes lives on the options page.

```
┌─────────────────────────────────────────┐
│ kose  📄 GitHub - issue #12 ▼  Review 3 │  ← source tab / session list / due quiz
│ Mode [Make it good English ▼]           │
│ Situation [Technical discussion ▼] [Apply] │
├─────────────────────────────────────────┤
│ Original                      123 chars │
│ [selected text]                         │
│ Review while you wait (quiz, §3)        │
│ Result   target · situation · time · cost │
│ [rewrite]                          Copy │
│ [← Previous | Next →]                   │
│ Diff (computed locally)                 │
│ Explanation                             │
│ - changes, reasons                      │
│ - meaning/nuance warnings               │
│ Discuss the nuance (chat)               │
│ [per-session conversation]              │
│ [input]                            Send │
├─────────────────────────────────────────┤
│ AI: local (Chrome built-in)  ⚙ Settings │
└─────────────────────────────────────────┘
```

- The target language / situation bar is at the top, right under the header, because it also decides the next invocation. The middle scrolls so the result is always readable. Long chats must not break the layout. Last-used values persist across reloads.
- The current AI provider is always shown at the bottom. For cloud providers it says, e.g., “Sent externally: Anthropic (rewrite claude-haiku-4-5 / explanation & chat claude-sonnet-5)”. ⚙ opens the options page.
- A session whose source tab was closed is discarded (§2). If it was displayed, the window falls back to another session or the instructions.
- “Copy JSON for debugging” copies the displayed session and settings (without API keys) as JSON.

### 1.4 UI language and explanation language

- **UI**: all user-visible strings are in message catalogs (`src/shared/messages.ts`). The Japanese catalog is used when the browser UI language (`chrome.i18n.getUILanguage()`) is Japanese; otherwise the English one. The manifest description and the shortcut description use `_locales/en` and `_locales/ja`. This document names UI elements in English; the Japanese UI uses the corresponding Japanese labels (e.g. “Mode” = 機能, “Situation” = 用途, “Apply” = 変更, “Free input” = 自由入力, “Review N” = 復習 N, “Show explanation” = 解説を見る, “Discuss the nuance” = ニュアンスを相談).
- **AI output**: explanations, chat replies and therefore the explanations saved with mistakes are written in the browser UI language. The language is passed to the AI as `explanationLanguage` and named in the prompt (“Explanation language: Japanese”). Chrome built-in AI falls back to English for languages it cannot output (§4.1).
- Language and situation names used in prompts are fixed English names (`domain/labels.ts`), independent of the UI language.

### 1.5 Options page

Rarely changed settings live on the options page.

- AI provider (Chrome built-in / Claude / OpenAI) and, for the built-in AI, its availability and the reason if unavailable
- Claude: API key, rewrite model, explanation/chat model (dropdowns: Haiku 4.5 / Sonnet 5 / Opus 5, or a custom model ID), effort, max input length
- OpenAI: API key, model, max input length
- Selecting a cloud provider requests its host permission with `chrome.permissions.request`; switching away removes it
- Save buttons are enabled only when there are unsaved changes, and show inline feedback after saving
- Whether to generate explanations automatically with cloud providers (default: off)
- Whether to bring the kose window to the front when kose is invoked (default: on)
- An explanation of external transmission
- “Mistake notes and review”:
  - Mistake auto-save on/off (default: on) and waiting-time quiz on/off (default: on)
  - A note that mistakes are recorded from explanations, so they increase only when an explanation is generated. When auto-save is on, a cloud provider is selected and cloud auto-explanation is off, a warning says that mistakes are recorded only after pressing “Show explanation”.
  - The list of saved mistakes (phrase pair, explanation, language, count, last seen, next review), newest first, with per-card delete and delete all (with confirmation). The list follows changes made in the kose window.
  - JSON export/import

## 2. Local learning data

- Auto-save covers only **same-language proofreading** (ja→ja, en→en), and only objective grammar/usage/notation errors.
- Nuance improvements, preference-based rewording, translations of correct text, and changes the model was unsure about are not saved as mistakes. Expressions from translations are not saved.
- Mistakes are extracted from the **explanation** (stage 2), right after it is generated. With cloud providers and auto-explanation off, nothing is recorded until the user presses “Show explanation”.
- **Auto-save conditions (all must hold):**
  1. `Change.type === 'objective_error'`
  2. `before` exists as a substring of the original and `after` as a substring of the rewrite
  3. The output language equals the input language. The input language is the local detection result (§4.2), and it must match the model's `detectedSourceLanguage`. `mixed` / `unknown` are excluded.
  4. `before` and `after` are each at most 40 characters
  5. The change comes from the explanation of the rewrite made right after the invocation (`origin: 'initial'`). Rewrites from chat or regeneration reflect the user's requests and are excluded.
  6. `before` and `after` are both non-empty (pure insertions and deletions cannot be quizzed), are not the whole original / rewrite (short selections), and contain no URL, e-mail address or file path
  7. Auto-save is on
- Duplicates within a session and against existing cards are merged, recording frequency and last occurrence. The normalization key is the (`before` → `after`) pair after NFKC, case folding and trimming. Merging must be conservative so different contexts are not merged by mistake. When a known mistake is detected again in real writing, it counts as forgotten: the card lapses (repetitions and interval reset to 0, ease −0.2, due within one day; `lapse()` in `domain/srs.ts`).
- **Repeated mistakes are shown in the explanation.** A change of type `objective_error` in same-language proofreading that matches a card recorded before this version (same language and key, `createdAt` earlier than the version) gets a badge “You made this before (recorded N×)” (Japanese UI: 前にも同じ誤り（記録 N 回）). The badge is computed when rendering from the saved cards (`knownMistake()` in `domain/mistakes.ts`); nothing extra is stored or sent to the AI. Cards can be deleted from the list on the options page; they cannot be edited.
- Stored data: short erroneous phrase, corrected phrase, explanation (URLs, e-mail addresses and paths in it are replaced with “…”), language, count, timestamps, review state. Never the full text or the page URL. No error category is stored (the explanation does not classify errors beyond `objective_error`).
- Storage: mistake cards and settings are in `chrome.storage.local` (key `mistakes`). Both the kose window and the options page read and write the cards and follow each other through `chrome.storage.onChanged`; the data is short phrases only, so it stays small. Corrupt entries are skipped when reading. Read-modify-write of the cards and of the settings is serialized across the kose window, the options page and the service worker with the Web Locks API (`storage/lock.ts`), so concurrent edits (e.g. deleting on the options page while the kose window records a mistake, or changing “Mode” and “Situation” in quick succession) are not lost. No sync, no telemetry.
- Sessions (full review text and chat) are kept in `chrome.storage.session` (in memory, never written to disk), keyed by tab ID. They survive closing and reopening the kose window, but **disappear when the source tab is closed or the browser exits**. The free-input session (tab ID −1) and its draft (`scratchDraft`) disappear when the browser exits. There is no explicit "save" feature.

## 3. Review quiz

- A quiz card shows the erroneous phrase (`before`), its language and, if it was made more than once, the count. The user thinks of the correction (an input field is available but optional; Enter reveals the answer) → “Show answer” shows `after` and the explanation → the user rates themselves: “Again” / “Hard” / “Good” / “Easy”.
- Answers are not graded by string match, since different wording can be correct. The AI is not involved in quizzes.
- Spaced repetition uses a **simplified SM-2** (`domain/srs.ts`, independent and unit-tested). Cards have `dueAt`, `lastReviewedAt`, `repetitions`, `easeFactor` (initial 2.5, minimum 1.3), `intervalDays`.
  - A new card is due one day after it was created (never quizzed on the same day).
  - Again: repetitions reset to 0, ease −0.2, due again in 10 minutes.
  - Detected again in real writing (§2): lapse — repetitions and interval reset to 0, ease −0.2, due within one day.
  - Hard: interval × 1.2 (at least 1 day), ease −0.15.
  - Good: 1 day, then 3 days, then interval × ease (always at least one day longer).
  - Easy: 3 days for a new card, otherwise the Good interval × 1.3 (at least one day longer), ease +0.15.
- **Waiting-time quiz** (main entry point): the time between invoking kose and seeing the rewrite (a few to a dozen seconds; longer with Chrome built-in AI) is otherwise idle.
  - On each new invocation, one due card (`dueAt <= now`, earliest first, not the card another tab is showing) is assigned to the tab. With no due card, or with the setting off, nothing is shown.
  - The “Review while you wait” panel is open while the rewrite runs and nothing has streamed yet. When the rewrite starts streaming (or the run stops), it collapses to one line (showing the phrase) so the result stays readable; the user can reopen it. It never blocks, and an unanswered card stays due (no rating is recorded).
  - At most one card per invocation. Regeneration and chat rewrites do not assign a card. After rating, the card stays displayed for that session.
- **“Review N”**: when cards are due, the kose window header shows the count. Pressing it reviews all cards that were due at that moment, one after another (“Next” after each rating, “Stop” to stop). A new invocation returns to the review display. The count is refreshed every minute.
- JSON export/import (options page): the export contains all cards with their review state. Import adds only mistakes that are not already saved (same language and normalized key) and keeps the local cards unchanged; a file in another format is rejected.
- No AI-generated questions and no notifications.

## 4. AI

### 4.1 Providers

A common `AIProvider` interface has three operations: `rewrite` (stage 1), `explain` (stage 2) and `chat`. Providers: Chrome built-in Prompt API (default), and cloud providers using the user's own API key: Claude (Anthropic API) and OpenAI API. Availability is checked at run time for the current browser and chosen language. **No automatic fallback to the cloud.** If local processing is impossible, kose shows why and how to explicitly select a cloud provider on the options page.

Explanations run automatically for providers that do not send data externally (the built-in AI), and on demand for cloud providers unless the user enables automatic explanations.

#### Chrome built-in Prompt API

- Called from the kose window (an extension page), not from the service worker.
- `LanguageModel.availability()` is checked with the input/output languages actually used: `expectedOutputs` contains the target language and the explanation language (e.g. `['en', 'ja']` for English output with a Japanese browser). The built-in AI outputs only some languages (`en`, `ja`, `es`); for any other browser language, explanations and chat replies are written in English.
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
- The cost of each request is computed from the returned token usage and a price table, and shown in the UI in USD (two significant digits, e.g. `$0.0015`). Dated model IDs in responses (e.g. `claude-haiku-4-5-20251001`) are matched by prefix.

#### OpenAI API

- `optional_host_permissions: ["https://api.openai.com/*"]`, requested when OpenAI is selected. Users of the built-in AI only are never granted external host permissions.
- Model is configurable (default in code). Structured Outputs (`json_schema`, strict). No streaming.
- API keys are stored in `chrome.storage.local`; the README states that this is not secure storage.

The Chrome Translator API is not used. Built-in API availability is tested on real hardware; supported languages and environments are never assumed.

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
  explanation: string;
}

interface ExplainRequest {
  requestId: string;
  sourceText: string;
  revisedText: string;
  targetLanguage: LanguageCode;
  situation: Situation;
  reviewStructure: boolean;
  explanationLanguage: string; // browser UI language, e.g. "ja" (ChatRequest has it too)
}

/** Stage 2: the explanation */
interface Explanation {
  explanation: string;
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

/** Where the selection came from. Used for display and for Apply (§5.6, not implemented). Not persisted to disk. */
interface SourceLocation {
  tabId: number;
  frameId: number;
  documentId?: string;                     // to detect navigation
  tabTitle?: string;                       // header display
  textSource: 'script' | 'selectionText';  // whether line breaks were preserved
  editable: boolean;                       // selection inside textarea/input/contenteditable
}

interface ReviewSession {
  id: string;                  // the requestId of the invocation
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

type Rating = 'again' | 'hard' | 'good' | 'easy';

interface ReviewState {
  dueAt: number;
  lastReviewedAt?: number;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
}

/** A saved mistake (§2). Short phrases only; never the full text or URL. */
interface MistakeCard {
  id: string;
  key: string;               // normalized before → after, for merging
  language: LanguageCode;
  before: string;
  after: string;
  explanation: string;
  createdAt: number;
  lastSeenAt: number;
  count: number;
  review: ReviewState;
}

interface AIProvider {
  rewrite(req: RewriteRequest, signal?: AbortSignal,
          onPartial?: (revisedText: string) => void): Promise<RewriteResult>;
  explain(req: ExplainRequest, signal?: AbortSignal,
          onPartial?: (partial: PartialExplanation) => void): Promise<Explanation>;
  chat(req: ChatRequest, signal?: AbortSignal,
       onPartial?: (reply: string) => void): Promise<ChatReply>; // revisedText only when rewriting
}
```

- Source language detection: count Japanese characters (hiragana, katakana, kanji; ≈2 per word) and Latin letters (≈4.5 per word) after removing URLs. Japanese share ≥ 0.5 → `ja`, ≤ 0.1 → `en`, otherwise `mixed`; too few letters → `unknown`. The diff is shown only when the detected source language equals the target language.
- Model JSON output is validated with Zod. Invalid JSON is an error. Changes whose `before`/`after` do not exist in the original/rewrite are dropped from display (and never used for mistake auto-save).
- Prompts state that the selected text is data, not instructions, and protect names, code, identifiers, quotations and URLs. Adding facts not in the source is forbidden. The model must not resolve ambiguous source text silently; ambiguities go into `nuanceWarnings`.
- Prompts contain only general principles. Do not add case-specific rules for individual failures; instead compare changes against the whole sample set (`tests/fixtures/samples.md`) and choose better models when a small model cannot follow the principles.
- The stage-1 prompt is kept short and has no few-shot examples (it is sent on every invocation). The stage-2 prompt has one few-shot example that demonstrates granularity, classification and concrete reasons. The explanation prompt also asks the model to point out information the rewrite added or guessed.
- Chat output is `{ reply, revisedText }` where an empty `revisedText` (or one identical to the current rewrite) means "no new version". Assistant turns in the history are passed back in the same JSON format.

### 4.3 Sessions and versions

- **A new session starts only on invocation** (right-click, toolbar button, shortcut, or running the free input). One session per tab; invoking again in the same tab replaces it. Conversations of different sessions are never mixed.
- “Apply” adds a version with `origin: 'regenerate'` to the same session; the chat continues.
- A new rewrite from chat is added as a version with `origin: 'chat'` using the settings of the version being discussed, and becomes current. If the reply is only an explanation, the result is not changed.
- Switching to an earlier version only changes `currentVersionId`; saved learning cards are neither deleted nor regenerated.
- Requests of different sessions run independently. Switching the displayed session does not cancel other sessions' requests. A new invocation in the same tab cancels that tab's rewrite, explanations and chat. Closing the tab cancels everything for it.
- While a rewrite is running, chat input is disabled. While a chat reply is pending, further messages are not accepted. A failed chat message can be resent without duplicating it.

## 5. Chrome extension implementation

### 5.1 Basics

- MV3, TypeScript, Vite, React, Vitest, Zod.
- Permissions: `contextMenus`, `storage`, `activeTab`, `scripting`, `clipboardRead` (only used by `launch.html`). `optional_host_permissions`: Anthropic and OpenAI. No always-on `<all_urls>` content scripts. No `sidePanel`. The shortcut uses `commands` (no permission needed).
- `"incognito": "not_allowed"`.
- `minimum_chrome_version`: 138 (Prompt API for extensions).
- Model output is rendered as text, never injected as HTML.
- Logs, UI and exports never include API keys. Full review text appears only in the explicit debug JSON copy. No scraping of unofficial translation endpoints. Chat uses only the selected provider.

### 5.2 The kose window

- A standalone window opened with `chrome.windows.create({ type: 'popup', url: 'kose.html' })`. **Always exactly one.**
  - The existing window is found by the window ID stored in `storage.session`, falling back to `chrome.runtime.getContexts()`. Otherwise a new one is created. Concurrent invocations are serialized so only one window is created.
- The window position and size are stored in `chrome.storage.local` and restored.
- Always-on-top is impossible for extensions; the README suggests OS tools such as PowerToys "Always on Top".

### 5.3 Invocation sequence

Listeners (`contextMenus.onClicked`, `action.onClicked`, `commands.onCommand` for `run-kose`) are registered at the top level of the service worker. The single menu item (`id: 'kose'`, context `selection`) is created in `runtime.onInstalled` and `runtime.onStartup`, which also set the toolbar button title (`action.setTitle` does not survive a browser restart). Both show the current target, e.g. “kose: Make it good English”, and are updated when `settings.targetLanguage` changes (`storage.onChanged`). Menu creation is awaited; if updating the title fails because the item does not exist yet, the menu is recreated.

1. Read the selection with line breaks via `chrome.scripting.executeScript` with `captureSelection` (allowed by `activeTab`). Selections inside `textarea`/`input` are read with `value.slice(selectionStart, selectionEnd)`.
   - Right-click: only the clicked frame (`frameIds: [info.frameId]`). On failure (PDF viewer, Chrome internal pages, …) fall back to `info.selectionText` and show that line breaks may be lost.
   - Toolbar button / shortcut: all frames (`allFrames: true`); the first frame with a non-empty selection is used. With no selection or on failure, kose writes `scratchRequest` (the current time) to `chrome.storage.session` and opens the kose window (focused).
2. Strip leading blank lines and trailing whitespace. Ignore empty selections.
3. Write the pending request (`{ requestId, targetLanguage, text, source: SourceLocation, createdAt }`) to `chrome.storage.session` under a per-tab key. `targetLanguage` is the current `settings.targetLanguage`. The tab title comes from the `tab` argument of the event.
4. Open the kose window, or bring the existing one to the front with `chrome.windows.update(id, { focused: true })` (can be disabled in options).
5. The kose window watches pending requests both at startup and via `storage.onChanged` (subscribing before loading state to avoid races), creates a new session for the tab, starts processing and displays it.
   - It also takes (reads and removes) `scratchRequest` (`{ at, text? }`) and switches to the free input with focus; with `text` it replaces the draft and runs it. At startup, a `scratchRequest` older than a pending request is ignored, so the newer invocation wins.
   - Running the free input builds the same kind of request (`source` for tab ID −1, current `targetLanguage`, `trimSelection` applied) and passes it to the same code path in the kose window; nothing goes through the service worker.
6. Requests of the tab's previous session are cancelled with `AbortController`, and responses for old request IDs are discarded.

### 5.4 Following the active tab

- The kose window subscribes to `chrome.tabs.onActivated` (no `tabs` permission needed).
  - If the activated tab has a session, show it.
  - Otherwise keep the current display (including the free input).
  - Ignore events for the kose window itself.
- Tab switches never bring the kose window to the front (display update only).
- `chrome.tabs.onRemoved` deletes the tab's session and pending request and cancels its requests (in both the service worker and the kose window).
- After manually selecting a session from the header list, following resumes on the next tab switch.

### 5.5 Input length

- The original always shows its character count.
- Above the provider's limit (built-in AI: computed from the input quota; Claude/OpenAI: 4,000 characters by default, configurable) kose does not run and shows the limit.

### 5.6 Apply (Replace) rules (not implemented)

- The write target is the **source tab and frame of the displayed session** (`SourceLocation`), not the active tab. The button names the destination, e.g. “Apply to 〈tab title〉”.
- Write only if all of the following hold; otherwise do not write and suggest Copy:
  - The source tab exists and `documentId` matches (no navigation; `activeTab` access also expires on navigation)
  - The selection came from an editable element (`editable`)
  - Right before writing, the text in the target range still equals `sourceText` (the user has not edited it)
- How to keep the target element/range (e.g. a reference in the ISOLATED world) is designed together with Apply. Sessions are transient, so recording `SourceLocation` is enough.

## 6. Directory layout

```
src/
  background/   context menu, toolbar button, shortcut, reading the selection, pending requests, window management
  app/          kose window: settings bar, free input, review, diff, explanation, chat, tab following,
                waiting-time quiz and “Review” quiz
  options/      provider settings, API keys, models, auto-explain, saved mistakes (list, delete, export/import)
  ai/           AIProvider, built-in / Claude / OpenAI adapters, prompts, schemas, partial JSON, pricing
  domain/       types, sessions, diff, language detection, mistake extraction/merging, SRS (simplified SM-2)
  storage/      settings, sessions, mistake cards
  shared/       IDs, message catalogs (messages.ts), UI language (locale.ts), shared styles
tests/
  unit/
  integration/
  fixtures/     sample sentences for the four paths
```

## 7. Acceptance criteria

- With the four-path samples in `tests/fixtures`, ja→ja, ja→en, en→ja and en→en work and preserve the meaning (manual evaluation).
- Nothing is sent to the cloud without an API key, and nothing falls back to the cloud automatically.
- Invoke in tab1 → invoke in tab2 (review 2 shown) → select tab1 → review 1 is shown. Selecting tab3 without a session changes nothing. Closing tab1 removes review 1.
- A chat request such as 「もっと苦労して帰宅したニュアンス」 ("make it sound like getting home was hard") updates Result; a question alone does not. The context does not leak into the next review in the same tab or into other tabs' sessions.
- The objective errors in `We finally had went back to home.` are recorded; running it again marks them as repeated in the explanation and increases the count. Natural rewording, translation, and chat/regeneration rewrites never create mistake cards. Neither full text nor URLs are stored.
- Mistake cards survive a restart, and the next review date changes according to the rating. With a due card, a new invocation shows it while the rewrite is running and collapses it when streaming starts; with no due card, or for regeneration/chat, nothing is shown.

### Not implemented

- Apply/Replace (rules in §5.6)
- A translation-only path with the Chrome Translator API
- A model selector in the kose window
- Custom situations, more languages, saving translation expressions, learning statistics, discussing quiz answers with the AI, a due-count badge on the toolbar icon

## 8. Quality and verification

- Unit tests: settings persistence, target-language branching, safe behavior on invalid model JSON, partial JSON parsing for streaming, language detection, pricing, structure review, auto-save conditions and merging, the mistake store (concurrent writes, corrupt entries, change notification, export/import), SM-2, version switching, session isolation (per invocation and per tab), active-tab following.
- Integration tests (Vitest with faked chrome APIs): the single menu item and its title, right-click / toolbar button (all frames; no selection → `scratchRequest`) → pending request → window creation/reuse, free input (shown with no sessions, draft saved in `storage.session` and restored, running it, `scratchRequest` at startup and while open), restoring pending requests in the kose window, cancelling/discarding earlier requests in the same tab while other tabs continue, cleanup on tab close, built-in AI unavailable, missing API key, two-stage explanation (automatic vs. on demand), chat (new version vs. explanation only, history, isolation, retry), mistake recording from the explanation (and not when disabled), waiting-time quiz assignment (one card per tab, none when nothing is due or the setting is off), rating.
- Manual tests (checklist in the README) with Chrome on Windows: selections on normal pages, GitHub and inside textareas; multi-paragraph line breaks; following across tabs and browser windows; restoring sessions and window position/size after reopening the kose window; limitations in the PDF viewer and Chrome internal pages.
- Build with Node.js on WSL2 and load `dist/` through the WSL path (e.g. `\\wsl.localhost\<distro>\...\dist`) with **Load unpacked** in Chrome on Windows (`npm run build:win` copies the build to Windows if needed). Check Chrome built-in AI against Chrome's requirements for Windows.
