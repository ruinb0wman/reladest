import type { InkTool } from '@/services/handwriting/model';
import type { BookshelfState } from './bookshelf';
import { CustomTheme } from '@/styles/themes';
import { CustomFont } from '@/styles/fonts';
import { CustomTexture } from '@/styles/textures';
import { HighlightColor, HighlightStyle, UserHighlightColor, ViewSettings } from './book';
import type { AISettings } from '@/services/ai/types';
import type { NotebookTab } from '@/store/notebookStore';
import type { DictionarySettings, ImportedDictionary } from '@/services/dictionaries/types';

export type ThemeType = 'light' | 'dark' | 'auto';
export type LibraryViewModeType = 'grid' | 'list';
export const LibrarySortByType = {
  Title: 'title',
  Author: 'author',
  Updated: 'updated',
  Created: 'created',
  Series: 'series',
  Size: 'size',
  Format: 'format',
  Published: 'published',
  Progress: 'progress',
  Pages: 'pages',
  TimeRemaining: 'timeRemaining',
} as const;

export type LibrarySortByType = (typeof LibrarySortByType)[keyof typeof LibrarySortByType];

/**
 * Secondary sort key. Same options as the primary sort key plus `'none'` which
 * disables the secondary sort. When set to `'none'` and a smart default applies
 * (e.g. groupBy=Author -> series), the resolver in `libraryUtils` substitutes
 * the implicit default at sort time without persisting it. See
 * `resolveEffectiveSecondarySort`.
 */
export type LibrarySecondarySortByType = LibrarySortByType | 'none';

export type LibraryCoverFitType = 'crop' | 'fit';

export const LibraryGroupByType = {
  None: 'none',
  Group: 'group',
  Series: 'series',
  Author: 'author',
  Tag: 'tag',
  Subject: 'subject',
  Status: 'status',
} as const;

export type LibraryGroupByType = (typeof LibraryGroupByType)[keyof typeof LibraryGroupByType];

export type ProgressSyncStrategy = 'prompt' | 'silent' | 'send' | 'receive';

export interface ReadSettings {
  sideBarWidth: string;
  isSideBarPinned: boolean;
  notebookWidth: string;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  /**
   * Global Word Lens toggle: auto-download a gloss pack on demand when the
   * pair isn't cached locally. When off, the reader never fetches packs
   * silently; users download them explicitly from the Word Lens sub-page.
   */
  wordLensAutoDownload: boolean;
  highlightStyle: HighlightStyle;
  highlightStyles: Record<HighlightStyle, HighlightColor>;

  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: UserHighlightColor[];
  defaultHighlightLabels: Partial<Record<HighlightColor, string>>;
  customTtsHighlightColors: string[];
  customThemes: CustomTheme[];

  /** Ink color and pen width for the handwriting tool, remembered per install. */
  handwritingColor: string;
  handwritingWidth: number;
  /** The drawing tool last used, and the marker's own color and width. */
  handwritingTool: InkTool;
  handwritingMarkerColor: string;
  handwritingMarkerWidth: number;
}

/**
 * Sort field for the WebDAV browser listing. 'name' reproduces the
 * legacy directories-first/alphabetical default; the date fields drive
 * the "pull up recent books" use case ('created' relies on the server
 * reporting `<creationdate>`, which not all do). 'size' orders files.
 */
export type WebDAVBrowseSortByType = 'name' | 'modified' | 'created' | 'size';

export interface WebDAVSettings {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
  // Browser sort preference, persisted so a chosen "recent first" order
  // survives across sessions. Both optional: absent => name/ascending,
  // matching the pre-feature default (no migration needed).
  browseSortBy?: WebDAVBrowseSortByType;
  browseSortAscending?: boolean;
  // Sync sub-toggles. WebDAV sync runs as a parallel channel alongside the
  // native cloud sync; each sub-toggle
  // gates a category independently so a user can e.g. mirror progress to
  // their own server without uploading book binaries.
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  // When true, "Sync now" re-checks every book instead of only those whose
  // local copy differs from the shared library.json index (the default
  // incremental walk). An escape hatch for drift or a first full sync.
  fullSync?: boolean;
  // Conflict policy for a position this device and the mirror disagree on.
  strategy?: ProgressSyncStrategy;
  // Stable per-device id (uuidv4); written into library.json so we can tell
  // which device last touched a given book.
  deviceId?: string;
  // Wall-clock millisecond timestamp of the last successful end-to-end
  // sync, surfaced in the WebDAV settings sub-page.
  lastSyncedAt?: number;
  // Device-local wall-clock millis of when this provider was made the
  // selected cloud sync backend on THIS device. Anchors the mixed-fleet
  // detection probe: any native /api/sync row newer than this means
  // another device is still writing the gated channels.
  providerSelectedAt?: number;
}

/**
 * User-facing sync categories. 'progress' gates the existing book-config
 * (reading progress) sync, 'note' gates annotations, 'book' gates book
 * binaries + metadata, 'dictionary' gates the imported-dictionary replica
 * sync. 'credentials' is a meta-toggle that gates the encrypted-credential
 * fields across whichever replica kinds carry them. Adding a new replica kind
 * extends this union.
 */
export type SyncCategory =
  | 'book'
  | 'progress'
  | 'note'
  | 'dictionary'
  | 'font'
  | 'texture'
  | 'settings'
  | 'credentials'
  | 'stats';

export const SYNC_CATEGORIES: readonly SyncCategory[] = [
  'book',
  'progress',
  'note',
  'dictionary',
  'font',
  'texture',
  'settings',
  'stats',
  'credentials',
] as const;

export interface KeyBinding {
  /** `native` = media keys forwarded by the OS bridge; `dom` = keyboard/D-pad keys. */
  source: 'native' | 'dom';
  /** Native key name (e.g. `MediaNext`) or DOM `event.code` (e.g. `ArrowLeft`). */
  id: string;
  /** Human-readable label shown in settings. */
  label: string;
  /** DOM modifier state. Optional so persisted single-key bindings remain valid. */
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altGraphKey?: boolean;
}

export interface HardwarePageTurnerSettings {
  enabled: boolean;
  bindings: {
    pagePrev: KeyBinding | null;
    pageNext: KeyBinding | null;
    sectionPrev: KeyBinding | null;
    sectionNext: KeyBinding | null;
  };
}

export interface SystemSettings {
  version: number;
  migrationVersion: number;
  localBooksDir: string;
  customRootDir?: string;
  /**
   * Absolute paths the user has registered as "external library folders" —
   * directories managed by the user (or another reader app, e.g. Duokan,
   * Calibre, Moon+ Reader) that Readest should read in place instead of
   * copying into Books/<hash>/. Each entry must be an absolute path; entries
   * are matched as path-prefix roots when ingesting a file. Device-local
   * (path is meaningful only on this filesystem) and excluded from cloud
   * settings backups via `BACKUP_SETTINGS_BLACKLIST`.
   */
  externalLibraryFolders?: string[];
  /**
   * Absolute paths of the external library folders the user has opted into
   * auto-import for. On library open and whenever the app regains focus,
   * Readest re-scans each of these and imports any newly-added book files.
   * A subset of {@link externalLibraryFolders} (auto-import requires the
   * folder to be read in place). Set per-folder from the Import-from-Folder
   * dialog. Desktop + Android only. Device-local (paths are meaningful only
   * on this filesystem) and excluded from cloud settings backups via
   * `BACKUP_SETTINGS_BLACKLIST`.
   */
  autoImportFolders?: string[];
  /**
   * The subset of {@link autoImportFolders} the user imported with "Import all
   * into library" (flatten). Auto-imported books from those folders go straight
   * to the library root; every other watched folder mirrors its subfolders as
   * groups, matching the dialog's default "Create groups from subfolders" —
   * which is also what a folder watched before this list existed falls back to.
   * Device-local, and excluded from cloud settings backups alongside
   * {@link autoImportFolders}.
   */
  autoImportFlattenFolders?: string[];

  keepLogin: boolean;
  alwaysOnTop: boolean;
  openBookInNewWindow: boolean;
  screenWakeLock: boolean;
  autohideCursor: boolean;
  screenBrightness: number;
  autoScreenBrightness: boolean;
  swipeBrightnessGesture: boolean;
  hardwarePageTurner: HardwarePageTurnerSettings;
  /**
   * Replay a connected controller's buttons and sticks as key events in the
   * reader. Off is a real need on handhelds whose own remapper (Steam Input on
   * the Steam Deck) already binds those buttons to keys, so every press would
   * otherwise land twice (issue #5979).
   */
  gamepadEnabled: boolean;
  /** Mouse wheel down turns to the previous page in paginated mode (#6439). */
  reverseWheelPaging: boolean;
  /** Hide the e-ink library's Previous/Next buttons; keys still page. */
  hideBookshelfPageButtons: boolean;
  alwaysShowStatusBar: boolean;
  openLastBooks: boolean;
  lastOpenBooks: string[];
  autoImportBooksOnOpen: boolean;
  savedBookCoverForLockScreen: string;
  savedBookCoverForLockScreenPath: string;
  telemetryEnabled: boolean;
  discordRichPresenceEnabled: boolean;
  bookshelves?: BookshelfState;
  libraryViewMode: LibraryViewModeType;
  librarySortBy: LibrarySortByType;
  librarySortAscending: boolean;
  /**
   * Whether the primary sort uses a smart default derived from `libraryGroupBy`.
   * When `true` and grouping by Series, the effective primary sort becomes
   * Series at sort time (the stored `librarySortBy` is left unchanged so users
   * who later turn auto off keep their previous explicit pick). Flipped to
   * `false` the moment the user picks any primary sort in the menu.
   */
  librarySortByAuto: boolean;
  libraryThenSortBy: LibrarySecondarySortByType;
  /** Sort order of the secondary ("Then by") key, independent of `librarySortAscending` (#5119). */
  libraryThenSortAscending: boolean;
  libraryGroupBy: LibraryGroupByType;
  libraryCoverFit: LibraryCoverFitType;
  libraryAutoColumns: boolean;
  libraryColumns: number;
  librarySkeuomorphicCovers: boolean;
  /**
   * When true, the library hides real cover images and shows a plain
   * title/author panel instead. Privacy escape hatch for when the shelf is
   * visible to others.
   */
  libraryHideCovers: boolean;
  /** Show the recently-read carousel at the top of the library (issue #3797). */
  libraryRecentShelfEnabled: boolean;
  /**
   * Library page background texture, configured independently from the reader
   * background (issue #4743). When any of these is undefined the library
   * inherits the corresponding `globalViewSettings.background*` value, so an
   * existing user's bookshelf looks unchanged until they pick a library
   * texture. Device-local (the texture *selection* never syncs, matching the
   * reader's `backgroundTextureId`); only the imported image binaries sync via
   * the `texture` replica kind. Resolved by `getLibraryViewSettings`.
   */
  libraryBackgroundTextureId?: string;
  libraryBackgroundOpacity?: number;
  libraryBackgroundSize?: string;
  customFonts: CustomFont[];
  customTextures: CustomTexture[];
  customDictionaries: ImportedDictionary[];
  dictionarySettings: DictionarySettings;
  /** Saved sites for the "From Web Browser" import (#5775). Device-local. */
  metadataSeriesCollapsed: boolean;
  metadataOthersCollapsed: boolean;
  metadataDescriptionCollapsed: boolean;
  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  /**
   * App-lock PIN. When `pinCodeEnabled` is true, the user must enter
   * a 4-digit PIN before the library/reader is rendered on app launch.
   * `pinCodeHash` is `bytesToHex(PBKDF2-SHA256(pin, hexToBytes(pinCodeSalt)))`,
   * never the plaintext PIN. Cleared together with `pinCodeEnabled = false`
   * when the user disables the lock.
   */
  pinCodeEnabled?: boolean;
  pinCodeHash?: string;
  pinCodeSalt?: string;
  /**
   * Mobile-only. When true AND a PIN lock is configured AND the device
   * has enrolled biometrics, the app-lock screen prompts for biometrics
   * (fingerprint / Face ID) first and falls back to the PIN. No effect on
   * desktop/web (no biometric plugin). `undefined` is treated as `false`
   * so existing PIN users are never silently switched to biometric.
   */
  biometricUnlockEnabled?: boolean;

  webdav: WebDAVSettings;
  /**
   * Baseline for the settings mirror: hash + timestamp of the value this device
   * last pushed or adopted, per group (see services/sync/file/settingsMirror).
   * Device-local by design — it is never itself mirrored.
   */
  settingsSyncState?: { groups: Record<string, { hash: string; savedAt: number }> };

  aiSettings: AISettings;
  /**
   * Per-device id used as the deviceId portion of every HLC this device
   * mints. Lazy-generated on first sync init via uuidv4.
   */
  replicaDeviceId?: string;
  /**
   * Per-kind cursor for replica sync. Stores the HLC string of the last
   * pulled row per kind. Absent kinds pull from the beginning.
   */
  lastSyncedAtReplicas?: Record<string, string>;
  /**
   * Per-category sync toggles. Missing keys default to ON. The
   * 'progress' category gates the existing book-config (reading
   * progress) sync; 'note' gates annotation sync; 'book' gates book
   * binary + metadata sync; 'dictionary' gates the imported-dictionary
   * replica sync. Future replica kinds add new SyncCategory members.
   */
  syncCategories?: Partial<Record<SyncCategory, boolean>>;

  // Global read settings that apply to the reader page
  globalReadSettings: ReadSettings;
  // Global view settings that apply to all books, and can be overridden by book-specific view settings
  globalViewSettings: ViewSettings;
}
