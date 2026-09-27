/**
 * 保存の読み込み→変更→書き込みを直列化する。koseウィンドウ・設定画面・service worker は
 * 別々の JS コンテキストなので、同じ拡張機能のページ間で共有される Web Locks を使う。
 * Web Locks が無い環境ではこのコンテキスト内だけで直列化する。
 */
const queues = new Map<string, Promise<unknown>>();

export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  if (locks) return locks.request(`kose:${name}`, fn);
  const run = (queues.get(name) ?? Promise.resolve()).then(fn);
  queues.set(
    name,
    run.catch(() => {}),
  );
  return run;
}
