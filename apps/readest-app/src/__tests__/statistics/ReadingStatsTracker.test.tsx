import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookProgress } from '@/types/book';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  getBookData: vi.fn(() => null as unknown),
  progress: null as BookProgress | null,
  playbackState: null as 'playing' | 'paused' | null,
  db: {
    upsertBook: vi.fn(),
    insertPageEvent: vi.fn(),
    recomputeBookTotals: vi.fn(),
  },
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
  getBookProgress: () => mocks.progress,
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => mocks.getBookData,
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: mocks.open },
}));
vi.mock('@/services/statistics/statsSync', () => ({
  pushStats: vi.fn(),
  pullStats: vi.fn(),
}));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => false }));
vi.mock('@/libs/sync', () => ({ SyncClient: class {} }));
vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getPlaybackState: () => mocks.playbackState,
    getActiveSession: () => (mocks.playbackState ? { bookHash: 'hash1' } : null),
  },
  getBookHashFromKey: (key: string) => key.split('-')[0],
}));

import ReadingStatsTracker from '@/app/reader/components/ReadingStatsTracker';

describe('ReadingStatsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('contains a database-open failure instead of leaking an unhandled rejection', async () => {
    const error = new Error('synthetic database open failure');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.open.mockRejectedValueOnce(error);

    render(<ReadingStatsTracker bookKey='book-1' />);

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[stats] background operation failed:', error);
    });
  });
});
