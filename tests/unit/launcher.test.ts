import { describe, expect, it } from 'vitest';
import { launchCommand } from '../../src/shared/launcher';

describe('launchCommand', () => {
  const url = 'chrome-extension://abc/launch.html';

  it('OS ごとに、起動用ページを開くコマンドを作る', () => {
    expect(launchCommand('win', url)).toBe(
      String.raw`"C:\Program Files\Google\Chrome\Application\chrome.exe" "chrome-extension://abc/launch.html"`,
    );
    expect(launchCommand('mac', url)).toBe('open -a "Google Chrome" "chrome-extension://abc/launch.html"');
    expect(launchCommand('linux', url)).toBe('google-chrome "chrome-extension://abc/launch.html"');
  });
});
