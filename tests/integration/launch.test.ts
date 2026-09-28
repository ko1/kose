import { describe, expect, it } from 'vitest';
import { launchFromClipboard } from '../../src/launch/launch';
import { fakeChrome } from '../fakeChrome';

describe('launchFromClipboard（外部からの起動）', () => {
  it('クリップボードの文章を自由入力に渡し、koseウィンドウを開いて前面に出す', async () => {
    const c = fakeChrome();
    await launchFromClipboard(async () => 'I has a pen.');
    expect(c.storage.session.data.scratchRequest).toEqual({ at: expect.any(Number), text: 'I has a pen.' });
    const windows = [...c.windows.all.values()];
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ url: 'chrome-extension://kose-test/kose.html', focused: true });
  });

  it('既存のkoseウィンドウは再利用する', async () => {
    const c = fakeChrome();
    await launchFromClipboard(async () => 'one');
    await launchFromClipboard(async () => 'two');
    expect(c.windows.all.size).toBe(1);
  });

  it('クリップボードが空、または読めなければ自由入力を開くだけにする', async () => {
    const c = fakeChrome();
    await launchFromClipboard(async () => '  \n');
    expect(c.storage.session.data.scratchRequest).toEqual({ at: expect.any(Number) });
    await launchFromClipboard(async () => {
      throw new Error('denied');
    });
    expect(c.storage.session.data.scratchRequest).toEqual({ at: expect.any(Number) });
  });
});
