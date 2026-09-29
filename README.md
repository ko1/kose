# kose

A personal Chrome extension that turns text you select on a web page into good Japanese or good English, tuned to the situation (casual, business, technical, academic, …). Mistakes found while proofreading are collected automatically and reviewed with short quizzes. The full specification is in [docs/spec.md](docs/spec.md).

## Features

- Select text → right-click **kose**, click the kose toolbar button, or press **Alt+K**. kose uses the target you chose last — “Make it good Japanese” or “Make it good English” — and you switch it in the kose window
- Results appear in a standalone **kose window**: the original, the rewrite (streamed as it is generated), Copy, and a word/character diff computed locally
- Two-stage processing to keep cloud costs low:
  1. On invocation, only the rewrite is generated (short prompt, small output)
  2. The explanation (changes with error/style classification and reasons in your browser's language, plus meaning/nuance warnings) is a second request — automatic with Chrome's built-in AI, on demand (“Show explanation”) with cloud providers
- **Structure review** for long texts (500+ characters or 3+ paragraphs): the explanation adds an outline of each paragraph and points out problems in order, flow, transitions, repetition and paragraph breaks. It only points things out; “Create a version that applies the structure suggestions” sends the issues to the chat to get a restructured version.
- **Nuance chat** (“Discuss the nuance”): ask about wording or request changes ("make it sound like getting home was hard"). A requested change becomes a new version of the result; plain questions never change it. Each review has its own conversation.
- **Mistake notes**: when proofreading in the same language (ja→ja, en→en), objective grammar/usage errors from the explanation are saved automatically as short phrase pairs (never the full text or URL). They are recorded only when an explanation is generated (with cloud providers: “Show explanation” or auto-explanation on). When you make a recorded mistake again, the explanation marks it “You made this before (recorded N×)” and the card comes back for review within a day. View, delete, clear and export/import them on the options page.
- **Review quiz**: while you wait for a rewrite, one due mistake is shown as a quiz (fix it → “Show answer” → rate Again / Hard / Good / Easy). The “Review N” button in the window header reviews all due mistakes. Scheduling is a simplified SM-2; a new mistake first comes up the next day.
- **Free input** (“✏️ Free input”): write text directly in the kose window and run kose on it with Ctrl+Enter — handy for text that is not on a page yet. It opens when you invoke kose with nothing selected
- One review per browser tab; the kose window follows the active tab
- Change “Mode” (target language) / “Situation” at the top of the window and regenerate with “Apply”; switch between earlier versions
- **Languages**: the UI is Japanese when Chrome's UI language is Japanese, and English otherwise. Explanations, chat replies and mistake explanations are written in Chrome's UI language (Chrome built-in AI: Japanese, English or Spanish; other languages fall back to English). The examples below use the English UI labels.
- AI providers: Chrome built-in AI (default, nothing leaves the browser), Claude (Anthropic API), OpenAI API. Cloud providers use your own API key and are used only when you explicitly select them.
- Per-request cost is shown for Claude (computed from the token usage returned by the API)
- “Copy JSON for debugging” copies the whole review (without API keys) for debugging

## Requirements

- Google Chrome 138 or later (tested with Chrome 154 on Windows)
- For Chrome built-in AI (Prompt API / Gemini Nano): Chrome's hardware requirements (free disk space, GPU or CPU/RAM). The model (~4 GB) is downloaded on first use.
- To build: Node.js 22 or later (tested with Node.js 24)

## Build

```sh
git clone https://github.com/ko1/kose.git
cd kose
npm install
npm run check        # typecheck + tests + build
```

The extension is built into `dist/`.

## Install into Chrome

1. Open `chrome://extensions` and turn on **Developer mode**
2. Click **Load unpacked** and select the `dist/` directory
3. After changing the code, run `npm run build` and press the reload button on the kose card

### Building on WSL2 for Chrome on Windows

You can load `dist/` directly through the WSL path, e.g. `\\wsl.localhost\<distro>\home\<user>\kose\dist`. If that is unreliable (e.g. Chrome starts before WSL), copy the build to the Windows side instead:

```sh
npm run build:win    # build and copy to %USERPROFILE%\kose-dist
KOSE_WIN_DIR=/mnt/c/Users/<you>/kose-dist npm run build:win   # custom destination
```

## Usage

1. Select text, then right-click → “kose: …”, click the kose toolbar button, or press Alt+K (change the key at `chrome://extensions/shortcuts`). The menu item shows the current target, e.g. “kose: Make it good English”.
2. The kose window opens (or comes to the front) and processing starts immediately
3. “Copy” copies the rewrite. Writing back into the page is not implemented.
4. Change “Mode” (Make it good Japanese / good English) / “Situation” at the top and press “Apply” to regenerate from the same original. The button is enabled only when the dropdowns differ from the displayed version. Changing the dropdowns alone does not call the AI. The chosen “Mode” is used for the next invocation.
5. Ask about the rewrite in “Discuss the nuance”. Enter sends, Shift+Enter inserts a newline (Enter while composing Japanese input does not send).
6. While the rewrite is being generated, a due mistake may appear under “Review while you wait”. Answer it or ignore it; it folds up when the result arrives. “Review N” in the header reviews all due mistakes.
7. With no selection (or on pages kose cannot read), the toolbar button and Alt+K open “✏️ Free input” with the cursor in the text area. Type, then Ctrl+Enter (or “kose”). The result appears below; the draft stays until the browser exits. “✏️ Free input” is always the first item in the header's list. Settings: “⚙ Settings” at the bottom (including “Mistake notes and review”).

### Run from any application (Windows)

kose can also take text from the clipboard, so you can use it outside Chrome (Notepad, Word, Slack, …), whether Chrome is running or not. Opening `chrome-extension://<ID>/launch.html` reads the clipboard, opens the kose window (or brings it to the front) and runs kose on the text as free input; a tab opens for a moment and closes. With an empty clipboard it just opens the free input.

**Win+R → `kose` (recommended).** On the options page, “Run from other applications” shows a setup script with kose's ID. Run it once in Windows PowerShell (`powershell.exe`, not `pwsh`). It compiles a tiny `kose.exe` that only starts Chrome with the launch URL, into `%LOCALAPPDATA%\Microsoft\WindowsApps` (already on the user PATH). Then: select text → Ctrl+C → Win+R → `kose` → Enter. No registry changes, nothing stays running, no console window; delete `kose.exe` to undo.

**Shortcut key.** Alternatively, create a shortcut (right-click the desktop → New → Shortcut) with the command shown on the options page, e.g.

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" "chrome-extension://<ID>/launch.html"
```

and set “Shortcut key” in its Properties (Windows allows only Ctrl+Alt+<key>, e.g. Ctrl+Alt+K; it works for shortcuts on the desktop or in the Start menu).

Both use Chrome's standard location. If Chrome was installed for your user only, it is `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (the setup script checks both); `cmd /c start "" chrome "<URL>"` works regardless of the location but flashes a console window. The unpacked extension's ID stays the same as long as you load it from the same folder.

The kose window is a normal window, so it goes behind Chrome when Chrome is focused. Chrome extensions cannot make a window always-on-top; use an OS tool such as PowerToys "Always on Top" if you want that.

### AI providers

- **Chrome built-in AI** (default): nothing is sent outside the browser. On first use the kose window shows a “Download the model” button. Explanations are generated automatically.
- **Claude (Anthropic API)**: selecting it asks for permission to access `api.anthropic.com`.
  - Settings: API key, rewrite model (default `claude-haiku-4-5`), explanation/chat model (default `claude-sonnet-5`), effort (default `low`; ignored by Haiku), max input length. Models are chosen from a dropdown (Haiku 4.5 / Sonnet 5 / Opus 5) or entered manually.
  - Explanations are generated only when you press “Show explanation” unless “Generate explanations automatically with cloud providers (Claude, OpenAI) too” is on.
  - Measured cost for a ~600-character English paragraph: rewrite with Haiku ≈ $0.0015, explanation with Sonnet ≈ $0.011. The kose window shows the cost of each request in USD.
  - Billed to your Anthropic Console API credits — separate from Claude.ai subscriptions. Create a dedicated API key and set a spend limit in the Console.
  - For `claude-opus-5`, server-side fallbacks (`fallbacks: "default"`) are enabled so that a refused request can be continued by another model.
- **OpenAI API**: selecting it asks for permission to access `api.openai.com`. Settings: API key, model (default `gpt-5-mini`), max input length.
- **Gemini API (Google)**: API key from Google AI Studio; there is a free tier (on the free tier Google may use the content to improve its products). Default model `gemini-2.5-flash`.
- **OpenRouter**: Claude, GPT, Gemini and many others with one account. Press “Log in with OpenRouter” to get a key without copying it (OAuth PKCE; the key is saved in the extension). Usage is paid from your OpenRouter credits and the cost of each request is shown. kose sends `data_collection: "deny"`, so OpenRouter uses only providers that do not store or train on your text (if a model has none, the request fails). Default model `openai/gpt-5-mini`; any model ID from openrouter.ai/models can be entered.
- **Ollama**: a local AI on your computer — free, and the text does not leave your computer. Install Ollama, pull a model (default `qwen3`: `ollama pull qwen3`), and set the environment variable `OLLAMA_ORIGINS=chrome-extension://*` before starting Ollama so the extension may connect. Only `localhost` / `127.0.0.1` servers can be used. Explanations are generated automatically, as with Chrome built-in AI.
- The provider is chosen from a dropdown on the options page; only the chosen provider's settings are shown.
- API keys are stored in `chrome.storage.local`. **This is not encrypted secure storage** — do not use kose with your keys on a shared PC.
- If Chrome built-in AI is unavailable, kose never falls back to a cloud provider automatically.

### Permissions

| Permission | Purpose |
| --- | --- |
| `contextMenus` | The right-click menu |
| `activeTab`, `scripting` | Read the selection (with line breaks) only from the tab where you invoked kose; no always-on content scripts |
| `storage` | Settings and mistake notes (`local`), per-tab reviews (`session`: in memory only, cleared when the browser exits) |
| `identity` | “Log in with OpenRouter” (opens OpenRouter's login page and receives the key) |
| `clipboardRead` | Read the clipboard only when you open `launch.html` (running kose from another application) |
| `https://api.anthropic.com/*` (optional) | Requested only when Claude is selected |
| `https://api.openai.com/*` (optional) | Requested only when OpenAI is selected |
| `https://generativelanguage.googleapis.com/*`, `https://openrouter.ai/*` (optional) | Requested only when Gemini / OpenRouter is selected |
| `http://localhost/*`, `http://127.0.0.1/*` (optional) | Requested only when Ollama is selected |

The Alt+K shortcut is declared with `commands`, which needs no permission.

kose does not run in incognito windows (`"incognito": "not_allowed"`).

### Limitations

- In the PDF viewer and on `chrome://` pages the selection cannot be read by script. The right-click menu then uses the text Chrome passes to it (line breaks may be lost; the kose window shows a note). The toolbar button and Alt+K cannot read the selection there and open the free input instead.
- Reviews and chats disappear when the original tab is closed or the browser exits; the free input and its draft disappear when the browser exits (mistake notes are kept).

## Manual testing

Sample sentences are in [tests/fixtures/samples.md](tests/fixtures/samples.md).

### The four language paths

| Path | Action | What to check |
| --- | --- | --- |
| en → en | “Mode” = “Make it good English”, select English | Only errors are fixed (e.g. `We finally had went back to home.`); the diff is shown; the explanation marks real errors as “Error”. Correct text shows “No change needed.”. |
| ja → ja | “Mode” = “Make it good Japanese”, select Japanese | Only what needs fixing changes; the diff is per character |
| ja → en | “Mode” = “Make it good English”, select Japanese | The meaning (e.g. "getting home was hard") is preserved; the explanation is in the browser language |
| en → ja | “Mode” = “Make it good Japanese”, select English | Natural Japanese; text that contains instructions is translated, not obeyed |

Also check that the “Technical discussion” situation keeps identifiers and URLs, and that “Work / email” and “Casual / social media” give different results.

### Tab following

1. Run kose in tab1 (review 1)
2. Run kose in tab2 → the kose window shows review 2
3. Switch to tab1 → review 1 is shown
4. Switch to tab3 (no review) → review 1 stays
5. Review 2 can be selected from the header dropdown
6. Close tab1 → review 1 disappears from the list

### Nuance chat

1. After a rewrite, ask 「もっと苦労して帰宅したニュアンスにして」 → a new version (“from chat”) is shown in Result
2. Ask a question such as 「went と got の違いは？」 → Result does not change
3. “← Previous” returns to the earlier version
4. Run kose on new text in the same tab, or use another tab → the earlier conversation is not carried over

### Mistake notes and review quiz

1. With “Make it good English”, run kose on `We finally had went back to home.` → after the explanation, the options page lists `had went → went` (and similar objective errors) under “Mistake notes and review”
2. Translating (ja → en), regenerating or chat rewrites add nothing; running the same sentence again shows “You made this before (recorded 2×)” in the explanation and increases the count instead of adding a card
3. A new mistake is not quizzed on the same day. To test sooner, export the JSON, set `review.dueAt` to a past time, clear and import it again
4. With a due mistake, run kose → “Review while you wait” appears while the rewrite is running and folds up when the result arrives; rating it moves “next review” on the options page
5. “Review N” in the header goes through all due mistakes; running kose again returns to the review
6. Deleting one card and “Delete all” on the options page are reflected in the kose window's “Review N”

### Free input

1. Press Alt+K with nothing selected → the kose window shows “✏️ Free input” with the cursor in the text area
2. Type text and press Ctrl+Enter → the result is shown below; the draft stays
3. Switch to a tab with a review and back via the header list → the draft and the result are still there
4. Close and reopen the kose window → the draft is restored; with no reviews at all, the free input is shown

### Other checks

- The right-click menu, the toolbar button and Alt+K all run with the current “Mode”, and the menu item / button title follow a change of “Mode”
- Selections inside a GitHub comment box (textarea), inside iframes (toolbar button / Alt+K) and multi-paragraph selections keep their line breaks
- Closing and reopening the kose window restores its position/size and the other tabs' reviews
- Closing the kose window while a request is running shows “Processing was interrupted.” with a retry button when reopened
- With a cloud provider selected but no API key, nothing is sent and an error is shown

## Chrome built-in AI (Prompt API): observations

Tested on Chrome 154 (Windows), ~600-character English paragraph, academic situation:

- The model download stalled at 0% for a while with "Mismatched version" on `chrome://on-device-internals` (Assets tab), then completed on its own after `chrome://components` updated the component. This is a Chrome-side issue; kose shows the download state and resumes automatically when the model becomes available.
- Rewrite: about 23 s; quality is usable, but it sometimes "completes" unclear terms (e.g. turned `Assistant associate` into `Assistant Associate Professor`).
- Explanation: about 64 s; changes are often coarse, nearly everything is classified as style, and reasons tend to be generic. It also reported the source language as `unknown`; kose therefore detects the source language locally rather than trusting the model.
- Conclusion: the built-in AI is fine for free, private rewrites; for reliable explanations (and therefore for mistake notes) a cloud model such as Claude Sonnet is much better. Claude Haiku rewrote the same text in ~2–4 s and Sonnet explained it in ~9 s.

## Development

```sh
npm run typecheck    # tsc
npm test             # vitest (chrome APIs are faked: tests/fakeChrome.ts)
npm run build        # vite build → dist/
npm run check        # all three
npm run zip          # check, then create release/kose-<version>.zip for the Chrome Web Store
```

```
src/
  background/   context menu, toolbar button, shortcut, reading the selection, kose window management, tab cleanup
  app/          the kose window (React) and its state (controller.ts), quizzes
  options/      the settings page, including the mistake list
  ai/           AIProvider, Chrome built-in / Claude / OpenAI adapters, prompts, output schemas, pricing
  domain/       types, sessions, diff, language detection, mistake extraction, SRS (simplified SM-2)
  storage/      settings and mistake notes (chrome.storage.local), sessions (chrome.storage.session)
  shared/       message catalogs (Japanese / English), UI language, IDs, shared styles
tests/
  unit/         pure logic, storage and providers
  integration/  invocation → pending request → kose window state (with faked chrome APIs)
  fixtures/     sample sentences for manual evaluation
```

UI strings are in message catalogs (`src/shared/messages.ts`, Japanese and English). Code comments are in Japanese.

## Privacy

See [docs/privacy.md](docs/privacy.md). kose has no server of its own; text leaves your browser only when you select Claude or OpenAI, and only to that provider.

## License

Copyright (c) 2026 Koichi Sasada. All rights reserved. See [LICENSE](LICENSE).
