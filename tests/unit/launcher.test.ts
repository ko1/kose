import { describe, expect, it } from 'vitest';
import { launchCommand, windowsSetupScript } from '../../src/shared/launcher';

describe('launchCommand', () => {
  const url = 'chrome-extension://abc/launch.html';

  it('OS ごとに、起動用ページを開くコマンドを作る', () => {
    expect(launchCommand('win', url)).toBe(
      String.raw`"C:\Program Files\Google\Chrome\Application\chrome.exe" "chrome-extension://abc/launch.html"`,
    );
    expect(launchCommand('mac', url)).toBe('open -a "Google Chrome" "chrome-extension://abc/launch.html"');
    expect(launchCommand('linux', url)).toBe('google-chrome "chrome-extension://abc/launch.html"');
  });

  it('Windows のセットアップ用スクリプトは、起動用ページを開く exe を WindowsApps に作る', () => {
    const script = windowsSetupScript(url);
    expect(script).toContain(String.raw`System.Diagnostics.Process.Start(@"$chrome", "\"chrome-extension://abc/launch.html\"");`);
    expect(script).toContain(String.raw`-OutputAssembly "$env:LOCALAPPDATA\Microsoft\WindowsApps\kose.exe" -OutputType WindowsApplication`);
    // here-string の終わりは行頭に置く必要がある
    expect(script.split('\n')).toContain('"@');
  });
});
