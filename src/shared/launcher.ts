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

/**
 * Windows で Win+R から「kose」で起動できるようにするセットアップ用スクリプト（Windows PowerShell 5.1 で1回実行）。
 * Chrome を引数付きで起動するだけの小さな exe を、最初から PATH に入っている
 * %LOCALAPPDATA%\Microsoft\WindowsApps にコンパイルして置く。レジストリには触らず、常駐もしない。
 * 画面を持たない形式（WindowsApplication）なので、コンソールも出ない。
 */
export function windowsSetupScript(launchUrl: string): string {
  return [
    '$chrome = @("$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe", "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1',
    '$code = @"',
    'public static class Kose {',
    '  public static void Main() {',
    `    System.Diagnostics.Process.Start(@"$chrome", "\\"${launchUrl}\\"");`,
    '  }',
    '}',
    '"@',
    'Add-Type -TypeDefinition $code -OutputAssembly "$env:LOCALAPPDATA\\Microsoft\\WindowsApps\\kose.exe" -OutputType WindowsApplication',
  ].join('\n');
}
