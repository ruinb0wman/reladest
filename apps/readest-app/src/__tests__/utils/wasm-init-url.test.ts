import { beforeEach, describe, expect, test, vi } from 'vitest';

// The jieba wasm-bindgen glue defaults to `new URL('<name>_bg.wasm', import.meta.url)`,
// which the bundler always emits and Tauri embeds. Passing a `/vendor/...` URL
// instead needs a published copy: it either ships the WASM twice (#6368) or,
// once the published copy is gone, 404s at runtime.
const jiebaInit = vi.fn();
vi.mock('jieba-wasm', () => ({ default: jiebaInit, cut: vi.fn() }));

describe('WASM init uses the bundler-emitted file', () => {
  beforeEach(() => {
    vi.resetModules();
    jiebaInit.mockReset();
  });

  test('jieba', async () => {
    const { initJieba } = await import('@/utils/jieba');
    await initJieba();
    expect(jiebaInit).toHaveBeenCalledWith();
  });
});
