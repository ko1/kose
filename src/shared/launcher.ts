/**
 * 外部（ほかのアプリ）から kose を起動するコマンド。launch.html がクリップボードの文章で kose を実行する。
 * OS は chrome.runtime.getPlatformInfo() の os（'win' | 'mac' | 'linux' | 'cros' など）。
 */
export function launchCommand(os: string, launchUrl: string): string {
  switch (os) {
    case 'win':
      return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "${launchUrl}"`;
    case 'mac':
      return `open -a "Google Chrome" "${launchUrl}"`;
    default:
      return `google-chrome "${launchUrl}"`;
  }
}
