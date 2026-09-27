# kose

A personal Chrome extension that turns text you select on a web page into good Japanese or good English, tuned to the situation (casual, business, technical, academic, …). The full specification is in [docs/spec.md](docs/spec.md).

Implemented so far: **Phase 1 (rewrite)** and **Phase 2 (nuance chat)**. Automatic mistake collection (Phase 3) and review quizzes (Phase 4) are not implemented yet.

## Features

- Select text → right-click → **kose** → 「よい日本語にする」 (make it good Japanese) / 「よい英語にする」 (make it good English)
- Results appear in a standalone **kose window**: the original, the rewrite (streamed as it is generated), Copy, and a word/character diff computed locally
- Two-stage processing to keep cloud costs low:
  1. On right-click, only the rewrite is generated (short prompt, small output)
  2. The explanation (changes with error/style classification and reasons in Japanese, plus meaning/nuance warnings) is a second request — automatic with Chrome's built-in AI, on demand (「解説を見る」) with cloud providers
- **Nuance chat** (「ニュアンスを相談」): ask about wording or request changes ("make it sound like getting home was hard"). A requested change becomes a new version of the result; plain questions never change it. Each review has its own conversation.
- One review per browser tab; the kose window follows the active tab
- Change the target language / situation at the bottom and regenerate; switch between earlier versions
- AI providers: Chrome built-in AI (default, nothing leaves the browser), Claude (Anthropic API), OpenAI API. Cloud providers use your own API key and are used only when you explicitly select them.
- Per-request cost is shown for Claude (computed from the token usage returned by the API)
- 「デバッグ用にJSONをコピー」 copies the whole review (without API keys) for debugging

## Requirements

- Google Chrome 138 or later (tested with Chrome 154 on Windows)
- For Chrome built-in AI (Prompt API / Gemini Nano): Chrome's hardware requirements (free disk space, GPU or CPU/RAM). The model (~4 GB) is downloaded on first use.
- Development: Node.js 22+ on WSL2 (tested with Node.js 24)

## Setup and build (WSL2)

```sh
cd /home/ko1/app/kose
npm install
npm run check        # typecheck + tests + build
```

The build output goes to `dist/`.

### Loading into Chrome on Windows

1. Open `chrome://extensions` and turn on **Developer mode**
2. **Load unpacked** and select `\\wsl.localhost\Ubuntu\home\ko1\app\kose\dist`
3. After changing the code, run `npm run build` and press the reload button on the kose card

If loading from the WSL path is unreliable (e.g. Chrome starts before WSL), copy the build to Windows instead:

```sh
npm run build:win    # build and copy to %USERPROFILE%\kose-dist
KOSE_WIN_DIR=/mnt/c/Users/<you>/kose-dist npm run build:win   # custom destination
```

## Usage

1. Select text, right-click → 「kose」 → 「よい日本語にする」 or 「よい英語にする」
2. The kose window opens (or comes to the front) and processing starts immediately
3. 「Copy」 copies the rewrite. Writing back into the page is not implemented.
4. Change 「仕上がり」 (target language) / 「用途」 (situation) and press 「この設定で再生成」 to regenerate from the same original. Changing the dropdowns alone does not call the AI.
5. Ask about the rewrite in 「ニュアンスを相談」. Enter sends, Shift+Enter inserts a newline (Enter while composing Japanese input does not send).
6. The toolbar icon also opens the kose window. Settings: 「⚙ 設定」 at the bottom.

The kose window is a normal window, so it goes behind Chrome when Chrome is focused. Chrome extensions cannot make a window always-on-top; use an OS tool such as PowerToys "Always on Top" if you want that.

### AI providers

- **Chrome built-in AI** (default): nothing is sent outside the browser. On first use the kose window shows a 「モデルをダウンロード」 button. Explanations are generated automatically.
- **Claude (Anthropic API)**: selecting it asks for permission to access `api.anthropic.com`.
  - Settings: API key, rewrite model (default `claude-haiku-4-5`), explanation/chat model (default `claude-sonnet-5`), effort (default `low`; ignored by Haiku), max input length. Models are chosen from a dropdown (Haiku 4.5 / Sonnet 5 / Opus 5) or entered manually.
  - Explanations are generated only when you press 「解説を見る」 unless 「クラウド（Claude・OpenAI）でも解説を自動で生成する」 is on.
  - Measured cost for a ~600-character English paragraph: rewrite with Haiku ≈ $0.0015 (≈ ¥0.2), explanation with Sonnet ≈ $0.011 (≈ ¥1.6). The kose window shows the cost of each request (¥150/$ approximation).
  - Billed to your Anthropic Console API credits — separate from Claude.ai subscriptions. Create a dedicated API key and set a spend limit in the Console.
  - For `claude-opus-5`, server-side fallbacks (`fallbacks: "default"`) are enabled so that a refused request can be continued by another model.
- **OpenAI API**: selecting it asks for permission to access `api.openai.com`. Settings: API key, model (default `gpt-5-mini`), max input length.
- API keys are stored in `chrome.storage.local`. **This is not encrypted secure storage** — do not use kose with your keys on a shared PC.
- If Chrome built-in AI is unavailable, kose never falls back to a cloud provider automatically.

### Permissions

| Permission | Purpose |
| --- | --- |
| `contextMenus` | The right-click menu |
| `activeTab`, `scripting` | Read the selection (with line breaks) only from the tab you right-clicked; no always-on content scripts |
| `storage` | Settings (`local`) and per-tab reviews (`session`: in memory only, cleared when the browser exits) |
| `https://api.anthropic.com/*` (optional) | Requested only when Claude is selected |
| `https://api.openai.com/*` (optional) | Requested only when OpenAI is selected |

kose does not run in incognito windows (`"incognito": "not_allowed"`).

### Limitations

- In the PDF viewer and on `chrome://` pages the selection cannot be read by script, so the text Chrome passes to the context menu is used. Line breaks may be lost; the kose window shows a note when this happens.
- Reviews and chats disappear when the original tab is closed or the browser exits.

## Manual testing

Sample sentences are in [tests/fixtures/samples.md](tests/fixtures/samples.md).

### The four language paths

| Path | Action | What to check |
| --- | --- | --- |
| en → en | Select English → 「よい英語にする」 | Only errors are fixed (e.g. `We finally had went back to home.`); the diff is shown; the explanation marks real errors as 「誤り」. Correct text shows 「変更の必要はありません」. |
| ja → ja | Select Japanese → 「よい日本語にする」 | Only what needs fixing changes; the diff is per character |
| ja → en | Select Japanese → 「よい英語にする」 | The meaning (e.g. "getting home was hard") is preserved; the explanation is in Japanese |
| en → ja | Select English → 「よい日本語にする」 | Natural Japanese; text that contains instructions is translated, not obeyed |

Also check that the 「技術的な議論」 situation keeps identifiers and URLs, and that 「仕事・メール」 and 「日常会話・SNS」 give different results.

### Tab following

1. Run kose in tab1 (review 1)
2. Run kose in tab2 → the kose window shows review 2
3. Switch to tab1 → review 1 is shown
4. Switch to tab3 (no review) → review 1 stays
5. Review 2 can be selected from the header dropdown
6. Close tab1 → review 1 disappears from the list

### Nuance chat

1. After a rewrite, ask 「もっと苦労して帰宅したニュアンスにして」 → a new version (「相談で作成」) is shown in RESULT
2. Ask a question such as 「went と got の違いは？」 → RESULT does not change
3. 「前の案」 returns to the earlier version
4. Right-click new text in the same tab, or use another tab → the earlier conversation is not carried over

### Other checks

- Selections inside a GitHub comment box (textarea) and multi-paragraph selections keep their line breaks
- Closing and reopening the kose window restores its position/size and the other tabs' reviews
- Closing the kose window while a request is running shows 「中断されました」 with a retry button when reopened
- With a cloud provider selected but no API key, nothing is sent and an error is shown

## Chrome built-in AI (Prompt API): observations

Tested on Chrome 154 (Windows), ~600-character English paragraph, academic situation:

- The model download stalled at 0% for a while with "Mismatched version" on `chrome://on-device-internals` (Assets tab), then completed on its own after `chrome://components` updated the component. This is a Chrome-side issue; kose shows the download state and resumes automatically when the model becomes available.
- Rewrite: about 23 s; quality is usable, but it sometimes "completes" unclear terms (e.g. turned `Assistant associate` into `Assistant Associate Professor`).
- Explanation: about 64 s; changes are often coarse, nearly everything is classified as style, and reasons tend to be generic. It also reported the source language as `unknown`, so kose now detects the language locally.
- Conclusion: the built-in AI is fine for free, private rewrites; for reliable explanations (and for Phase 3's error collection) a cloud model such as Claude Sonnet is much better. Claude Haiku rewrote the same text in ~2–4 s and Sonnet explained it in ~9 s.

## Development

```sh
npm run typecheck    # tsc
npm test             # vitest (chrome APIs are faked: tests/fakeChrome.ts)
npm run build        # vite build → dist/
npm run check        # all three
```

```
src/
  background/   context menu, reading the selection, kose window management, tab cleanup
  app/          the kose window (React) and its state (controller.ts)
  options/      the settings page
  ai/           AIProvider, Chrome built-in / Claude / OpenAI adapters, prompts, output schemas, pricing
  domain/       types, sessions, diff, language detection
  storage/      settings (chrome.storage.local), sessions (chrome.storage.session)
tests/
  unit/         pure logic and providers
  integration/  right-click → pending request → kose window state (with faked chrome APIs)
  fixtures/     sample sentences for manual evaluation
```

UI strings and code comments are in Japanese.
