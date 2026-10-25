# 移除三块「内容来源」：网络小说 / 订阅链接 / 在线书库

- 建页：2026-10-25
- 状态：**已完成**（2026-10-25，P1–P5 五笔提交；末尾 §9 是实现记录）
- 范围：`apps/readest-app`（**Rust 不动**）
- 三者共同点：都是「出网到用户自己指定的站点抓内容」，也是 LAN 版里仅剩的、必须联网才能用的可见功能

## 1. 用户说法 → 代码里的真名

| 用户说法 | 代码里的名字 | 入口 | 落盘的数据 |
|---|---|---|---|
| 网络小说 | **Import Web Novel**（`services/novel/**`） | 书库导入菜单「From Web Novel」（仅 Tauri） | 现场抓章节拼成一个真 `.epub` → 普通书 |
| 订阅链接 | **Feeds**（RSS/Atom/JSON，`services/rss/**`） | 导入菜单「From Feed URL」→ `FeedsView` 订阅源列表 | `feeds.json` + 每源一本**无文件书**（`feed://` 描述符，内容按需重建） |
| 在线书库 | **OPDS Catalogs**（`services/opds/**` + `/opds` 路由） | 导入菜单「Online Library / OPDS Catalogs」→ 浏览页；设置 → Integrations → OPDS Catalogs | `settings.opdsCatalogs`；下载下来的书是真文件 |

注意别误删同名东西：`utils/txt.ts` 里的 “web-novel TXT” 只是本地 TXT 的标题/章节启发式；`services/bookService.ts:517` 的 “novel.txt” 是文件名去重；`services/webBrowser/browserFetch.ts`、`services/send/conversion/**` 被「Send to Readest / 网页转书」共用，**都留着**。

## 2. 现状盘点

### 2.1 专属文件（删完即消失）

| 功能 | 专属文件 | 行数 | 专属测试 |
|---|---|---|---|
| 网络小说 | `services/novel/{chapterList,novelImport,renderNovelPage}.ts`、`app/library/components/ImportNovelDialog.tsx` | 1,346 | 1,274（4 个文件） |
| 订阅链接 | `services/rss/**`（12 个）、`types/rss.ts`、`store/feedStore.ts`、`app/library/components/feeds/{FeedsView,AddFeedModal}.tsx` | 1,365 | 794（13 个文件） |
| 在线书库 | `services/opds/**`（11 个，1,905）、`app/opds/**`（17 个，4,999）、`app/api/opds/proxy/route.ts`（388）、`types/opds.ts`（223）、`store/customOPDSStore.ts`（242）、`hooks/useOPDSSubscriptions.ts`（115）、`app/library/components/OPDSDialog.tsx`（27） | 7,899 | 7,318（27 个文件） |
| **合计** | | **10,610** | **9,386** |

三个里最大的两块：`app/opds/page.tsx` 1,132 行、`app/opds/components/CatalogManager.tsx` 1,042 行。

### 2.2 共享触点（每个都是小改，漏一处就不一致）

- `app/library/page.tsx` —— 三块的总开关都在这里：`showFeeds` / `showAddFeed` / `showImportNovel` / `showCatalogManager`、`?opds=true` 深链、`handleImportNovelFile`、`handleAddFeedSubmit`，以及 `useOPDSSubscriptions()` 的后台检查（354–365 行）
- `app/library/components/ImportMenu.tsx` —— 三条菜单项 + 三个 prop（`onImportBookFromNovelUrl` / `onOpenCatalogManager` / `onOpenFeeds`）
- `app/library/components/LibraryHeader.tsx` —— 只是把 `onOpenFeeds` 往下传
- `components/settings/IntegrationsPanel.tsx` —— OPDS 行 + `subPage: 'opds'` 早返回分支 + 直接 import `CatalogManager`（**hook 顺序坑，见 `a00a9713e`**）
- `store/readerStore.ts` —— `isPseStream` / `isFeed` 两条打开书的分支（213–305 行）
- `services/bookService.ts`（4 处）、`services/bookContent.ts`、`services/ingestService.ts` —— PSE 页流的打开/识别
- `services/appService.ts` + `types/system.ts` + `services/nativeAppService.ts` —— `loadFeeds` / `saveFeeds` 接口、`isOnlineCatalogsAccessible`（后者只被这三块用）
- `types/settings.ts` —— `opdsCatalogs`、`SensitiveField 'opds_catalog'` 及敏感字段白名单
- 设置/同步/备份：`services/constants.ts`（默认 `opds_catalog: true`、`READEST_OPDS_USER_AGENT`）、`store/settingsStore.ts`（`subPage` 注释里的 `'opds'`）、`services/backupService.ts`（`opdsCatalogs` 凭据清洗 + 白名单）、`services/sync/replicaKinds.ts`（`OPDS_CATALOG_KIND`）、`services/sync/syncCategories.ts`（注释）
- 书库行为补齐：`app/library/hooks/useBooksSync.ts`、`components/metadata/BookDetailView.tsx`、`app/library/components/BookItem.tsx`、`app/library/utils/libraryUtils.ts`、`utils/transform.ts` —— 全是 `isFeedBook()` 的特例（feed 书没有文件，上传/下载/移动都要跳过）
- `types/book.ts` + `libs/document.ts` + `services/bookshelves/fields.ts` —— `OPDSAUDIO` 格式
- 注释里的残留名：`utils/network.ts`、`utils/concurrency.ts`、`utils/cache.ts`、`app/reader/hooks/useProgressSync.ts`
- `services/database/migrations/index.ts` —— `opds` 这个 schema type + `2026052701_opds_source_mappings`：**只停读写，不删迁移**（同 Hardcover / Notion / BookOrbit 的处理）
- i18n：上一轮五集成移除把键清干净了（现在 `readwise|notion|pagebound|hardcover|bookorbit` 残留 0 个），这次照办

### 2.3 顺手能清的死代码

- `services/opds/audioStream.ts`（334 行）—— **零引用**，随 audiobook 那轮一起废的，只剩测试还在测它
- `types/book.ts` 的 `OPDSAUDIO`、`libs/document.ts` 的 `EXTS/MIMETYPES` 条目、`bookshelves/fields.ts` 的 `AUDIO_FORMATS` —— 删掉 OPDS 后没人产生这种书
- `isOnlineCatalogsAccessible` —— 只有 OPDS 用
- `foliate-js/opds.js` 的 5 处 import —— 库是 vendored 的，**不动 packages，不碰 lockfile**

## 3. 三个方案

| | A. 只关入口 | B. 全量删（推荐） | C. 只删在线书库 |
|---|---|---|---|
| 做法 | 菜单项和路由摘掉，服务层留着 | 专属文件 + 共享触点全清 | 只做 B 的 P3–P5 |
| 代码量 | ~50 行 | −10,610 行 | −7,899 行 |
| 还出网吗 | 不能从 UI 触发，`?opds=true`、旧深链、后台 autoDownload 还可能跑 | 三处外联全断 | 网络小说/订阅还在 |
| 后续维护 | 死代码继续吃 tsc/lint/单测，还会随上游漂移 | 干净 | 中等 |
| 风险 | 低 | 中（PSE 页流牵到打开书的主路径） | 低-中 |

推荐 **B**：上一轮五个集成就是这么做的（`5531560e2`…`dda1ff7ec`），有成熟套路；A 看着省事，但正是那种「过半年谁也不敢删」的债。

## 4. 执行方案（推荐 B，5 个提交，每包独立可回退）

顺序按「耦合少 → 耦合多」，且**先把订阅删掉**——`services/rss/feedGuardedFetch.ts`、`feedClient.ts` 反过来 import 了 `app/opds/utils/opdsReq`，订阅先走就不会留下跨包悬空。

### P1 网络小说（最小，1300 行 + 4 个测试）
1. 删 `services/novel/**`、`ImportNovelDialog.tsx` 及其 4 个测试
2. `ImportMenu`：删「From Web Novel」项与 `onImportBookFromNovelUrl` prop；`LibraryHeader` 里同步删
3. `library/page.tsx`：`showImportNovel` state、两处 prop、`ImportNovelDialog` 挂载、`handleImportNovelFile`
4. `utils/txt.ts` 等处的注释**不动**（那是本地 TXT 的启发式，不是这个功能）

### P2 订阅链接（1,365 行 + 13 个测试）
1. 删 `services/rss/**`、`types/rss.ts`、`store/feedStore.ts`、`app/library/components/feeds/**` 及其测试（含 `feed-books-sync.test.tsx`）
2. `ImportMenu` 第三条菜单项 + `onOpenFeeds`；`LibraryHeader` 同步
3. `library/page.tsx`：`showFeeds`/`showAddFeed`/`handleShowFeeds`/`handleAddFeedSubmit`/`FeedsView`/`AddFeedModal` 挂载
4. `types/system.ts` + `appService.ts`：`loadFeeds`/`saveFeeds`（interface 与实现）；`services/rss/feedPersistence.ts` 一起没
5. feed 书的五处特例全删：`useBooksSync.ts`、`BookItem.tsx`、`libraryUtils.ts`、`BookDetailView.tsx`、`utils/transform.ts`（`metadata.feedUrl` → `feed://` 的重建）
6. `store/readerStore.ts` 的 `isFeed` / `openFeedBookDoc` 分支

### P3 在线书库：UI + 目录管理 + 服务层（约 7,000 行 + 大部分测试）
1. 删 `app/opds/**`、`app/api/opds/proxy/route.ts`、`types/opds.ts`、`store/customOPDSStore.ts`、`hooks/useOPDSSubscriptions.ts`、`app/library/components/OPDSDialog.tsx`，以及 `services/opds/**` 里**不属阅读路径**的部分：`index` `autoDownload` `feedChecker` `cover` `metadata` `sourceMap` `subscriptionState` `types` `formats`（`pseStream`、`audioStream` 留到 P4）
2. `IntegrationsPanel`：删 OPDS 行、`'opds'` 早返回分支、`CatalogManager` import（**hook 全部留在早返回之前**）
3. `ImportMenu` 第三条 + `onOpenCatalogManager`；`library/page.tsx` 的 `showCatalogManager`、`?opds=true` 深链、`useOPDSSubscriptions()` 与其两处调用
4. 设置/同步/备份：`types/settings.ts` 的 `opdsCatalogs` 与 `'opds_catalog'` 敏感字段、`constants.ts` 的默认值 + User-Agent、`backupService.ts` 的凭据清洗、`replicaKinds.ts` 的 `OPDS_CATALOG_KIND`、`settingsStore.ts` 的 `subPage` 注释
5. `nativeAppService.ts` 的 `isOnlineCatalogsAccessible` 与 `types/system.ts` 的声明、`ImportMenu`/`OPDSDialog` 里的文案三元
6. `migrations/index.ts`：`opds` schema 迁移**保留**并加一行注释说明「集成已移除，历史迁移保留」

### P4 OPDS 阅读路径：PSE 页流 + OPDSAUDIO（1 处主路径，最需要小心）
1. 删 `services/opds/pseStream.ts`、`services/opds/audioStream.ts`（后者本来就零引用）
2. 收掉四个调用点：`bookService.ts`（`isPseStreamFileName` / `parsePseStreamFileName` / `openPseStreamBook`，4 段）、`bookContent.ts`、`ingestService.ts`、`store/readerStore.ts`（`isPseStream` 分支与 import）
3. `types/book.ts` 的 `'OPDSAUDIO'`、`libs/document.ts` 的 `EXTS`/`MIMETYPES` 条目、`bookshelves/fields.ts` 的 `AUDIO_FORMATS`（只留 `ABS`）
4. 测试：`opds/pseStream.test.ts`、`pseStream-wide-pages.test.ts`、`opds/audio-*.test.ts` 删；`reader-store*.test.ts` 里 PSE/feed 的用例改写为「不再有流式格式」

### P5 收尾（不删功能，只对齐）
- `utils/network.ts`、`utils/concurrency.ts`、`utils/cache.ts`、`useProgressSync.ts`、`syncCategories.ts` 里的注释：不再提 OPDS / feed 缓存
- `LibraryEmptyState.tsx` 的 TODO 注释、`library/page.tsx` 顶部关于 OPDS 的注释
- i18n：清 `public/locales/*/translation.json` 里这些键（35 个语言，脚本跑一遍；`out/locales` 是构建产物不用管）
- Integrations 面板描述改成剩下的事实（Local Network → BookDrop、Cloud Sync → WebDAV）
- 全量复查：`grep -ri "opds\|feedBook\|isFeedBook\|web novel\|novelImport\|pseStream" src` 只剩注释与 `utils/txt.ts` 的历史命名
- 打一次 APK 上真机点一遍：导入菜单只剩「From Local File / From Directory」、设置里 Integrations 不再有 OPDS、书库正常打开

## 5. 老数据与老设置（现场已核实）

- 本机镜像库 `~/readest-sync/Readest/library.json`：**83 本，全是 EPUB，`feed://` 书 0 本，OPDS 书 0 本**；`settings.json` 里没有 `opdsCatalogs`/feed 相关键
- 所以**不写一次性清理代码**。手机上若曾订阅过 feed，那本书会变成「点开打不开」的空行（本来就无文件），手动从书库删一行即可；OPDS 下载下来的书是真文件，留着照读
- `opdsCatalogs` / `feeds.json` 留在 IndexedDB 里没人读，无害；**不写迁移、不删历史迁移**（删了老库升级路径会断）

## 6. 每包固定验收

```
pnpm -C apps/readest-app test:types      # tsc --noEmit，必须空
pnpm -C apps/readest-app test:lint       # biome lint
pnpm -C apps/readest-app test:format     # cargo fmt + biome format dry-run
pnpm -C apps/readest-app test            # 单测全绿（用例数会降）
pnpm -C apps/readest-app build           # web 构建 200/207
```

Rust 不动 ⇒ 不跑 `cargo check`；P5 之后打一次 APK（`pnpm build:android:arm64`）确认真机。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| PSE 页流是「打开书」的主路径之一，改错了所有书都打不开 | P4 单独一包；先删 `pseStream` 再让 tsc 把四个调用点全指出来，逐个改成「不存在这种书」；`reader-store*.test.ts` 是安全网 |
| `IntegrationsPanel` 是单组件多视图，删早返回容易踩 hook 顺序 | 每次删早返回都确认所有 hook 在函数最上面（`a00a9713e` 的教训） |
| 已存在的 feed 书 / OPDS 目录行 | 不清理、不迁移（见 §5），残留设置键无害 |
| 迁移链 | `opds` schema 迁移保留，只停读写 |
| 测试改写 | 27+13+4 个专属测试直接删；共享断言（`reader-store*`、`syncCategories`、`backup-settings`、`settings-store`、`ImportMenu` 弹窗测试）改成「只剩本地导入 / 只剩文件同步」 |
| 顺手删多了 | `services/send/conversion/**`、`services/webBrowser/browserFetch.ts`、`@mozilla/readability`、`@dnd-kit` 都还有别的使用者，不碰；`foliate-js` 不改 |

## 8. 预计规模

- 专属代码：**−10,610 行**（7,899 OPDS / 1,365 feeds / 1,346 novel）
- 专属测试：**−9,386 行**
- 共享触点：约 20 个文件，每个 1~15 行
- 五个提交，全部可单独 revert

## 9. 实现记录（2026-10-25）

实际提交，与方案的差异写在下面：

| 提交 | 内容 |
|---|---|
| `f383d4c69` | 本方案文档 |
| `3d16b2da2` | P1 网络小说 |
| `1d222d624` | P2 订阅链接 |
| `802d10309` | **P3 改成「PSE 页流 + OPDSAUDIO」**（方案里的 P4） |
| `0c6979819` | **P4 改成「OPDS 目录浏览」**（方案里的 P3） |
| `a35b88e5a` | P5 注释/i18n/死代码收尾 |

**P3 与 P4 换了顺序**：`services/opds/pseStream.ts` 依赖 `app/opds/utils/opdsReq.ts`，
而 `app/opds/page.tsx` 又 import 了 `buildPseStreamFileName`。先删目录浏览会让页流悬空，
先删页流则只需顺手摘掉 page.tsx 里那一个 handler（下一笔整页删除）。所以把「风险最高的
阅读路径」放在前面单独一笔，目录 UI 放在后面。

其它偏离：

- 顺手删了 `utils/mp3Duration.ts` + 测试（自 audiobook 那轮起零引用，唯一读者是 OPDS 音频）；
- i18n 不是跑 `pnpm i18n:extract`（它会把 900 多个**与本功能无关**的历史孤儿键一起删掉，34 个语言、3.4 万行），
  而是用脚本按「被删文件里的 `_('…')` 字面量 − 当前源码仍在用的键」精确算出 100 个键（+400 条复数变体）再删；
- 验收：tsc / biome lint / biome format / 8454 单测 / `next build`（路由表只剩 / /library /o /offline /reader /send）全绿；
  aarch64 与 x86_64 APK 都重建成功，x86_64 装进模拟器实测：书库 75 本完好、
  导入菜单只剩 From Local File / From Directory、Integrations 只剩 BookDrop + WebDAV、logcat 无 FATAL。

踩到的坑（下次直接绕）：删 `page.tsx` 后 tsc 会继续对幸存文件报「缺少已删 prop」的幽灵错误，
根因是增量状态写在 `apps/readest-app/distribution/apps/readest-app/tsconfig.tsbuildinfo`
（`outDir: ./distribution` + `rootDir: ../..`），删这个文件才干净；`.next/types/**` 里也要抠掉已删路由的校验块。
