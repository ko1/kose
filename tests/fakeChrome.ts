// テスト用の最小限の chrome.* フェイク。kose が使うAPIだけを実装する。

type Listener<A extends unknown[]> = (...args: A) => unknown;

export class FakeEvent<A extends unknown[]> {
  listeners: Listener<A>[] = [];
  addListener(l: Listener<A>) {
    this.listeners.push(l);
  }
  removeListener(l: Listener<A>) {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
  hasListener(l: Listener<A>) {
    return this.listeners.includes(l);
  }
  dispatch(...args: A) {
    for (const l of [...this.listeners]) l(...args);
  }
}

class FakeStorageArea {
  data: Record<string, unknown> = {};
  constructor(
    private readonly area: string,
    private readonly onChanged: FakeEvent<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>,
  ) {}

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return structuredClone(this.data);
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in this.data) out[k] = structuredClone(this.data[k]);
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
      this.data[k] = structuredClone(v);
    }
    this.onChanged.dispatch(changes, this.area);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (k in this.data) {
        changes[k] = { oldValue: this.data[k] };
        delete this.data[k];
      }
    }
    if (Object.keys(changes).length > 0) this.onChanged.dispatch(changes, this.area);
  }
}

export interface FakeWindow {
  id: number;
  type?: string;
  url?: string;
  focused?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export function createFakeChrome() {
  const storageOnChanged = new FakeEvent<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>();
  const windows = new Map<number, FakeWindow>();
  let nextWindowId = 100;
  const grantedOrigins = new Set<string>();

  const fake = {
    storage: {
      onChanged: storageOnChanged,
      local: new FakeStorageArea('local', storageOnChanged),
      session: new FakeStorageArea('session', storageOnChanged),
    },
    runtime: {
      id: 'kose-test',
      onInstalled: new FakeEvent<[]>(),
      getURL: (path: string) => `chrome-extension://kose-test/${path}`,
      getContexts: async (_filter: unknown) =>
        [...windows.values()]
          .filter((w) => w.url?.endsWith('kose.html'))
          .map((w) => ({ windowId: w.id, tabId: -1, contextType: 'TAB' })),
      openOptionsPage: async () => {},
    },
    contextMenus: {
      created: [] as unknown[],
      onClicked: new FakeEvent<[unknown, unknown]>(),
      create(props: unknown) {
        fake.contextMenus.created.push(props);
      },
      async update(id: string, props: Record<string, unknown>) {
        const item = fake.contextMenus.created.find((m) => (m as { id: string }).id === id);
        if (!item) throw new Error(`Cannot find menu item with id ${id}`);
        Object.assign(item as object, props);
      },
      removeAll(cb?: () => void) {
        fake.contextMenus.created = [];
        cb?.();
      },
    },
    scripting: {
      executeScript: async (_injection: unknown): Promise<{ result: unknown; documentId?: string; frameId?: number }[]> => {
        throw new Error('Cannot access contents of the page');
      },
    },
    windows: {
      all: windows,
      /** koseウィンドウ自身のID（getCurrent の戻り値） */
      currentId: 999,
      onBoundsChanged: new FakeEvent<[FakeWindow]>(),
      async create(opts: Omit<FakeWindow, 'id'>) {
        const w = { ...opts, id: nextWindowId++ };
        windows.set(w.id, w);
        return w;
      },
      async get(id: number) {
        const w = windows.get(id);
        if (!w) throw new Error(`No window with id: ${id}`);
        return w;
      },
      async update(id: number, patch: Partial<FakeWindow>) {
        const w = await fake.windows.get(id);
        Object.assign(w, patch);
        return w;
      },
      async getCurrent() {
        return { id: fake.windows.currentId };
      },
    },
    tabs: {
      activeTabId: undefined as number | undefined,
      onActivated: new FakeEvent<[{ tabId: number; windowId: number }]>(),
      onRemoved: new FakeEvent<[number, unknown]>(),
      async query(_q: unknown) {
        return fake.tabs.activeTabId === undefined ? [] : [{ id: fake.tabs.activeTabId }];
      },
    },
    permissions: {
      granted: grantedOrigins,
      async contains(p: { origins?: string[] }) {
        return (p.origins ?? []).every((o) => grantedOrigins.has(o));
      },
      async request(p: { origins?: string[] }) {
        for (const o of p.origins ?? []) grantedOrigins.add(o);
        return true;
      },
      async remove(p: { origins?: string[] }) {
        for (const o of p.origins ?? []) grantedOrigins.delete(o);
        return true;
      },
    },
    action: {
      title: undefined as string | undefined,
      onClicked: new FakeEvent<[unknown]>(),
      async setTitle({ title }: { title: string }) {
        fake.action.title = title;
      },
    },
  };
  return fake;
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

export function fakeChrome(): FakeChrome {
  return (globalThis as unknown as { chrome: FakeChrome }).chrome;
}
