# Chrome Web Store listing (draft)

Texts to paste into the Chrome Web Store developer dashboard. Keep them in sync with the extension.

## Store listing

- **Name**: kose
- **Category**: Productivity → Tools (候補: Education)
- **Language**: English (default) and Japanese

### Summary (132 characters max)

- en: `Turn the text you select into good English or good Japanese. Explanations, nuance chat, and quizzes on your own mistakes.` (121)
- ja: `選んだ文章を、よい日本語・よい英語に。変更点の解説、ニュアンスの相談、自分の間違いの復習クイズつき。` (50)

### Description (en)

```
kose rewrites the text you select on any web page into good English or good Japanese, tuned to the situation — casual, work email, technical discussion, academic writing, presentation or formal.

• Right-click “kose”, click the toolbar button, or press Alt+K. kose uses the mode you chose last (Make it good English / Make it good Japanese).
• Proofreading and translation in one: English → English fixes only what needs fixing; Japanese → English translates naturally for the situation.
• See the diff and an explanation of every change: real errors vs. optional style improvements, and warnings where the meaning or nuance might change.
• Discuss the nuance: ask “what's the difference between A and B?” or “make it sound more polite”, and get a new version.
• Long texts get a structure review (order, flow, transitions).
• Your mistakes become a study list automatically. While you wait for the next rewrite, kose quizzes you on a mistake that is due (spaced repetition). When you make the same mistake again, kose tells you.
• Free input: write text directly in the kose window when it is not on a page yet.

Privacy
• Default AI: Chrome's built-in AI — your text never leaves your device.
• Optional: Claude (Anthropic) or OpenAI with your own API key. Text is sent only to the provider you choose.
• No developer server, no analytics. Mistake notes keep only short phrases, never the full text or the page URL.

The UI is in Japanese when Chrome is in Japanese, and in English otherwise. Explanations are written in Chrome's UI language.
```

### Description (ja)

```
kose は、Web ページで選んだ文章を、よい日本語・よい英語に書き直す Chrome 拡張機能です。日常会話・SNS、仕事・メール、技術的な議論、論文、プレゼン、公式な文章など、用途に合わせて整えます。

• 右クリックの「kose」、ツールバーのボタン、Alt+K のどれでも実行できます。最後に選んだ機能（よい英語にする／よい日本語にする）で動きます。
• 校正も翻訳も同じ操作で。英語→英語は必要なところだけ直し、日本語→英語は用途に合った自然な英語にします。
• 差分と、変更点ごとの解説を表示。本当の誤りと、任意の言い回しの改善を区別し、意味やニュアンスが変わりうるところは注意を出します。
• ニュアンスを相談：「A と B の違いは？」「もっと丁寧に」と聞くと、答えや新しい案が返ってきます。
• 長い文章は構成（順序、流れ、つなぎ）も指摘します。
• 自分の間違いが自動で復習リストになります。次の改稿を待つ間に、復習の時期が来た間違いをクイズで出します（間隔反復）。同じ間違いをまたすると教えてくれます。
• 自由入力：ページにない文章も、kose のウィンドウに直接書いて使えます。

プライバシー
• 既定の AI は Chrome 内蔵 AI。文章は端末の外に出ません。
• 任意で Claude（Anthropic）や OpenAI も使えます（ご自身の API キー）。文章は選んだ事業者にだけ送られます。
• 開発者のサーバーはなく、利用状況の計測もしません。間違いメモには短い語句だけを保存し、原文全体やページの URL は保存しません。

Chrome の表示言語が日本語なら日本語、それ以外は英語の画面になります。解説も Chrome の表示言語で書かれます。
```

### Images to prepare

| Item | Size | Suggested content |
| --- | --- | --- |
| Icon | 128×128 | `public/icons/icon128.png` (already in the package) |
| Screenshots (1–5) | 1280×800 or 640×400 | 1. kose window with an English proofreading result, diff and explanation. 2. Japanese → English translation with nuance warnings. 3. Nuance chat creating a new version. 4. “Review while you wait” quiz. 5. Options page (providers, mistake notes). Prepare both English and Japanese UI if listing both languages. |
| Small promo tile | 440×280 | Name + one line, e.g. “Select → kose → good English” |

## Privacy practices tab

- **Single purpose**: `Improve text the user selects (or types) into good English or Japanese for a chosen situation, explain the changes, and help the user review their own mistakes.`
- **Permission justifications**
  - `activeTab`: `Read the text the user selected, only in the tab where the user runs kose (right-click menu, toolbar button or shortcut).`
  - `scripting`: `Inject a one-time function into that tab to read the selection with its line breaks (and from text areas). No content scripts run otherwise.`
  - `clipboardRead`: `Read the clipboard only when the user opens the extension's launch page (e.g. from a desktop shortcut) to run kose on text copied in another application.`
  - `contextMenus`: `Provide the single right-click menu item “kose: Make it good …” for selected text.`
  - `storage`: `Store settings, the user's mistake notes (short phrases only) and the window position locally, and keep reviews in session storage (in memory) until the tab or browser is closed.`
  - Host permissions `https://api.anthropic.com/*`, `https://api.openai.com/*` (optional): `Requested only when the user selects Claude or OpenAI as the AI provider, to send the text the user runs kose on to that API with the user's own API key.`
- **Remote code**: No. All code is in the package; the APIs return JSON data only.
- **Data usage** (what to check)
  - Website content: **yes** — the selected text is transmitted to the AI provider the user chooses (only for cloud providers). Not stored by the developer.
  - Authentication information: **yes** — the user's own API keys are stored locally and sent only to the corresponding API.
  - Personal communications: **decide** — if users proofread e-mails or chat messages, that text is sent to the chosen provider. Checking it is the safer choice.
  - All other categories (personally identifiable info, health, financial, location, web history, user activity): no.
  - Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- **Privacy policy URL**: `https://github.com/ko1/kose/blob/main/docs/privacy.md` (requires the repository to be public)
