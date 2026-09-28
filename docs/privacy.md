# kose Privacy Policy

Last updated: 2026-09-28

kose is a Chrome extension that rewrites text you select into good Japanese or good English. This policy explains what data kose handles. (日本語は下にあります。)

## Summary

- kose has **no server of its own**. The developer does not receive, collect or sell any of your data. There is no analytics or telemetry.
- Your text is sent outside your browser **only when you select a cloud AI provider** (Claude or OpenAI) on the options page, and then only to that provider.
- Everything kose stores stays in your browser.

## What is sent, and where

| AI provider | What is sent | Where |
| --- | --- | --- |
| Chrome built-in AI (default) | Nothing leaves your device. Processing runs in Chrome on your computer. | — |
| Claude (Anthropic API) | The text you run kose on, its rewrites, the chosen mode and situation, your nuance-chat messages, and the language for explanations | `api.anthropic.com`, using your own API key |
| OpenAI API | Same as above | `api.openai.com`, using your own API key |

- Data is sent only when you run kose, press “Show explanation”, send a chat message, or enable automatic explanations for cloud providers.
- The page URL is never sent. Text on the page outside your selection is never sent.
- The provider handles the data under its own terms and privacy policy ([Anthropic](https://www.anthropic.com/legal/privacy), [OpenAI](https://openai.com/policies/privacy-policy)). You are billed by the provider for your API usage.
- kose never switches to a cloud provider automatically.

## What is stored in your browser

| Data | Where | How long |
| --- | --- | --- |
| Settings, including API keys | `chrome.storage.local` (not encrypted) | Until you change them or remove the extension. Delete API keys with “Delete API key” on the options page. |
| Mistake notes: short wrong and corrected phrases (40 characters or less), their explanation, language, counts and review schedule | `chrome.storage.local` | Until you delete them on the options page (one by one or “Delete all”) or remove the extension. The full text and the page URL are never stored; phrases containing URLs, e-mail addresses or file paths are not recorded, and such strings in explanations are replaced with “…”. |
| Reviews (the selected text, rewrites, explanations, chat) and the free-input draft, with the tab title | `chrome.storage.session` (in memory, not written to disk) | Until the tab is closed or the browser exits |
| Position and size of the kose window | `chrome.storage.local` | Until you remove the extension |

- “Copy JSON for debugging” copies the displayed review and settings (without API keys) to your clipboard only when you press it.
- “Export JSON” on the options page saves your mistake notes to a file only when you press it.

## Permissions

- `activeTab`, `scripting`: read the selected text (with line breaks) from the tab where you run kose, only at that moment. No content scripts run on pages otherwise.
- `clipboardRead`: read the clipboard only when you open kose's launch page (`launch.html`, e.g. from a Windows shortcut) to run kose on text copied in another application. The text is handled like free input.
- `contextMenus`: the right-click menu item.
- `storage`: the data described above.
- `https://api.anthropic.com/*`, `https://api.openai.com/*` (optional): requested only when you select that provider, and removed when you switch away.

## Contact

Questions and reports: https://github.com/ko1/kose/issues

---

# kose プライバシーポリシー

最終更新日: 2026-09-28

kose は、選択した文章をよい日本語・よい英語に改善する Chrome 拡張機能です。このポリシーは、kose が扱うデータについて説明します。

## 概要

- kose は**独自のサーバーを持ちません**。開発者があなたのデータを受け取ったり、収集・販売したりすることはありません。利用状況の解析や計測もしていません。
- 文章がブラウザーの外に送られるのは、設定画面で**クラウドの AI（Claude または OpenAI）を選んだときだけ**で、送り先はその事業者だけです。
- kose が保存するものは、すべてあなたのブラウザーの中にあります。

## 送信するもの・送信先

| AI の選択 | 送信するもの | 送信先 |
| --- | --- | --- |
| Chrome 内蔵 AI（既定） | 端末の外には何も送りません。お使いのパソコンの Chrome の中で処理します。 | — |
| Claude（Anthropic API） | kose にかけた文章、改稿文、選んだ機能と用途、ニュアンス相談のメッセージ、解説に使う言語 | `api.anthropic.com`（あなた自身の API キーを使用） |
| OpenAI API | 同上 | `api.openai.com`（あなた自身の API キーを使用） |

- 送信するのは、kose を実行したとき、「解説を見る」を押したとき、相談を送ったとき、クラウドでの解説の自動生成をオンにしているときだけです。
- ページの URL は送りません。選択範囲以外のページの文章も送りません。
- 送信したデータは、各事業者の規約とプライバシーポリシー（[Anthropic](https://www.anthropic.com/legal/privacy)、[OpenAI](https://openai.com/policies/privacy-policy)）に従って扱われます。API の利用料金は各事業者からあなたに請求されます。
- kose が自動でクラウドの AI に切り替えることはありません。

## ブラウザーに保存するもの

| データ | 保存先 | 保存期間 |
| --- | --- | --- |
| 設定（API キーを含む） | `chrome.storage.local`（暗号化されません） | 変更するか、拡張機能を削除するまで。API キーは設定画面の「APIキーを削除」で消せます。 |
| 間違いメモ：誤った語句と直した語句（それぞれ40字以内）、その解説、言語、回数、復習の予定 | `chrome.storage.local` | 設定画面で削除する（1件ずつ、または「すべて削除」）か、拡張機能を削除するまで。原文全体とページの URL は保存しません。URL・メールアドレス・ファイルパスを含む語句は記録せず、解説の中のそれらは「…」に置き換えます。 |
| レビュー（選択した文章、改稿文、解説、相談）と自由入力の下書き、タブのタイトル | `chrome.storage.session`（メモリ上のみ。ディスクには書きません） | タブを閉じるか、ブラウザーを終了するまで |
| kose ウィンドウの位置と大きさ | `chrome.storage.local` | 拡張機能を削除するまで |

- 「デバッグ用にJSONをコピー」は、押したときだけ、表示中のレビューと設定（API キーを除く）をクリップボードにコピーします。
- 設定画面の「JSONに書き出す」は、押したときだけ、間違いメモをファイルに保存します。

## 権限

- `activeTab`、`scripting`：kose を実行したタブから、そのときだけ選択中の文章を（改行を保ったまま）読み取ります。それ以外のときにページでスクリプトを動かすことはありません。
- `clipboardRead`：kose の起動用ページ（`launch.html`。Windows のショートカットなどから開く）を開いたときだけ、ほかのアプリでコピーした文章を読み取ります。読み取った文章は自由入力と同じように扱います。
- `contextMenus`：右クリックメニューの項目です。
- `storage`：上に書いたデータの保存です。
- `https://api.anthropic.com/*`、`https://api.openai.com/*`（任意）：その AI を選んだときだけ許可を求め、選択をやめると許可を返します。

## お問い合わせ

質問や報告: https://github.com/ko1/kose/issues
