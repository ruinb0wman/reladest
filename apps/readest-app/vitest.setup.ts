import { JSDOM } from 'jsdom';

// jsdom does not implement the CSS namespace; foliate-js TTS uses CSS.escape
// (mark[name="…"] lookups). Provide the standard polyfill so those paths work.
const globalWithCSS = globalThis as { CSS?: { escape?: (value: string) => string } };
if (!globalWithCSS.CSS) globalWithCSS.CSS = {};
if (typeof globalWithCSS.CSS.escape !== 'function') {
  globalWithCSS.CSS.escape = (value: string): string => {
    const string = String(value);
    const length = string.length;
    const firstCodeUnit = string.charCodeAt(0);
    let result = '';
    let index = -1;
    while (++index < length) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += '�';
      } else if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += '\\' + codeUnit.toString(16) + ' ';
      } else if (index === 0 && length === 1 && codeUnit === 0x002d) {
        result += '\\' + string.charAt(index);
      } else if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
      } else {
        result += '\\' + string.charAt(index);
      }
    }
    return result;
  };
}

// matchMedia mock
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom reports these unimplemented methods to its virtual console even when
// the calling test passes. Tests that need media behavior replace them locally.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

// Unit tests never reach the Readest Voice API: a controller built for a
// signed-out reader would otherwise fetch the voice catalog over the network.
// Tests that exercise the request spy on fetch themselves.
if (typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    String(input instanceof Request ? input.url : input).includes('/tts/readest')
      ? Promise.resolve(Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 }))
      : realFetch(input, init);
}

// Node 26 ships its own `localStorage` getter, and it is unusable without
// `--localstorage-file`: it shadows jsdom's implementation, so the global reads
// as `undefined` and every storage-backed suite fails at `localStorage.getItem()`
// — ~750 tests, which buries real failures in noise.
//
// Install a REAL jsdom Storage rather than a hand-rolled Map. A Map loses two
// things the storage tests themselves assert *about*:
//   * `new StorageEvent('storage', { storageArea: localStorage })` is rejected by
//     jsdom's IDL conversion unless the object carries jsdom's own `implSymbol`.
//   * `vi.spyOn(Storage.prototype, 'getItem')` cannot intercept a plain object, so
//     the "storage disabled" paths silently stop being covered.
// jsdom's type check still passes after re-prototyping because `implSymbol` lives
// on the instance itself; pointing the prototype at THIS realm's
// `Storage.prototype` is what makes `vi.spyOn` intercept.
const installStorageGlobals = (): void => {
  const read = (name: 'localStorage' | 'sessionStorage'): Storage | undefined => {
    try {
      return globalThis[name];
    } catch {
      return undefined;
    }
  };
  if (read('localStorage') && read('sessionStorage')) return;

  let win: (Window & typeof globalThis) | undefined;
  try {
    // Lazily constructed, so the extra JSDOM instance is only paid for on Node
    // versions that shadow the global.
    win = new JSDOM('', { url: 'http://localhost/' }).window;
  } catch {
    win = undefined;
  }
  const StorageCtor = globalThis.Storage ?? win?.Storage;

  const mapFallback = (): Storage => {
    const map = new Map<string, string>();
    const fallback = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => void map.set(String(k), String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => void map.clear(),
    };
    return fallback as unknown as Storage;
  };

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (read(name)) continue;
    const storage = win?.[name];
    if (storage && StorageCtor) Object.setPrototypeOf(storage, StorageCtor.prototype);
    Object.defineProperty(globalThis, name, {
      value: storage ?? mapFallback(),
      configurable: true,
      writable: true,
    });
  }
};
installStorageGlobals();
