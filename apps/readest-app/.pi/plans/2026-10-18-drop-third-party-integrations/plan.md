# 移除 5 个第三方集成（Notion / Pagebound / Readwise / Hardcover / BookOrbit）

- 建页：2026-10-18
- 状态：**方案待批准**（未动一行代码）
- 上游范围：`apps/readest-app`

## 1. 为什么删

这五个都不是「本机功能」，而是**连第三方 SaaS** 的集成，且都要一次账号授权（OAuth 或 API token）：

| 集成 | 干什么 | 连谁 | 需要账号 |
|---|---|---|---|
| Readwise | 把高亮/笔记推到 Readwise（以及从 Readwise 导入） | readwise.io API | 是（token） |
| Notion | 把标注/笔记同步到 Notion 数据库 | api.notion.com | 是（OAuth/token） |
| Pagebound | 阅读进度 + 笔记同步 | pagebound 服务 | 是 |
| Hardcover | 阅读跟踪（进度、书评） | api.hardcover.app GraphQL | 是（OAuth） |
| BookOrbit | 书源 + 进度/笔记同步 | bookorbit 服务 | 是 |

LAN 版**没有账号体系**（`AuthContext` 恒为未登录），这些集成的授权入口在 `navigateToLogin`（现在只是跳回书库的壳）——也就是说它们在 LAN 版里**是半死的**：面板能看见、能点进配置页，但永远走不完授权。同时它们与「外联归零 / 只走局域网」的定位直接冲突。

## 2. 现状盘点（2026-10-18 实测代码）

### 2.1 专属文件（删完即消失）

| 集成 | 专属文件 | 行数 | 测试文件 |
|---|---|---|---|
| Readwise | `services/readwise/ReadwiseClient.ts`·`settings/integrations/ReadwiseForm.tsx`·`reader/hooks/useReadwiseSync.ts` | 511 | 1 |
| Notion | `services/notion/{NotionClient,NotionSyncStore}.ts`·`integrations/NotionForm.tsx`·`reader/hooks/useNotionSync.ts` | 1,590 | 6 |
| Pagebound | `services/pagebound/PageboundClient.ts`·`integrations/PageboundForm.tsx`·`reader/hooks/usePageboundSync.ts`·`reader/components/pagebound/PageboundLinkDialog.tsx` | 831 | 2 |
| Hardcover | `services/hardcover/{HardcoverClient,hardcoverConnection,hardcoverOAuth,hardcover-graphql,HardcoverSyncMapStore}.ts`·`store/hardcoverSyncStore.ts`·`integrations/HardcoverForm.tsx`·`reader/hooks/useHardcoverSync.ts`·`reader/components/hardcover/HardcoverLinkDialog.tsx` | 2,285 | 8 |
| BookOrbit | `services/bookorbit/{BookOrbitClient,BookOrbitSyncStore}.ts`·`types/bookorbit.ts`·`integrations/BookOrbitForm.tsx`·`reader/hooks/{bookOrbitProgressProvider,useBookOrbitNotesSync}.ts`·`pages/api/bookorbit.ts` | 1,216 | 5 |
| **合计** | | **6,433** | **22** |

### 2.2 共享触点（每个都是小改，但漏一处就不一致）

按命中行数排序，五个集成的并集：

- `components/settings/IntegrationsPanel.tsx` —— 5 个列表行 + 5 个 `subPage` 早返回分支（**注意：hook 顺序坑，见 `a00a9713e`**）
- `app/reader/components/sidebar/BookMenu.tsx` —— 菜单项（每条 6~14 处命中）
- `app/reader/components/ReaderContent.tsx` —— 挂 sync hook / 链接对话框
- `app/reader/components/annotator/Annotator.tsx` —— 标注侧边栏的「同步到 X」
- `app/reader/components/ViewMenu.tsx` —— 阅读器的同步状态行（hardcover）
- `app/reader/components/FoliateViewer.tsx` / `app/reader/components/ReadingStatsTracker.tsx` —— bookorbit 进度上报
- `types/settings.ts` —— `settings.{readwise,notion,pagebound,hardcover,bookorbit}`
- `types/book.ts` —— per-book 的 `notionPageId`/`pageboundBookId`/`hardcoverId`/`bookorbitId` 之类字段
- `services/constants.ts` —— API base URL / client id / 默认值
- `services/settingsService.ts` + `store/settingsStore.ts` —— 默认值、迁移
- `services/backupService.ts` —— 备份导出的设置白名单
- `services/database/migrations/index.ts` —— notion 的表/字段迁移
- `services/sync/syncCategories.ts` —— readwise/hardcover 的同步类别
- `utils/deeplink.ts` + `utils/cover.ts` —— OAuth 回跳、封面来源
- `src/i18n` 的消息表 —— 每条的 UI 文案
- ⚠️ `app/reader/hooks/useKOSync.ts`（21KB）仍被 bookorbit 命中 —— **KOSync 应该在 2.5-B 已经删干净了**，这个文件是残壳还是真实现，要在 P5 时先查清（若已是残壳，顺手一并删）

## 3. 执行方案：6 个提交

顺序按「耦合少 → 耦合多」，每包一个提交、独立可回退。

### P1 Readwise（最小，练手）
1. 删专属文件 + `__tests__/services/readwise/`
2. `IntegrationsPanel`：删 `readwise` 行与 `subPage` 分支（**保持所有 hook 在早返回之前**）
3. `ReaderContent`/`Annotator` 里的 readwise 同步调用与「同步到 Readwise」
4. `types/settings.ts` 的 `readwise` 段、`settingsService` 默认值、`backupService` 白名单、`constants.ts` 的 endpoint、`syncCategories`、`utils/deeplink` 的回跳分支
5. i18n 文案
6. 测试改写：`ReadwiseClient.test.ts` 删除；若共享测试里断言了 readwise 的同步类别，改成断言「类别列表只剩文件同步」

### P2 Notion
同 P1，外加：
- `services/database/migrations/index.ts` 里 notion 相关的表/字段：**只停止读写，不删迁移步骤**（删历史迁移会让老库升级路径断掉），把对应 store/客户端删掉即可
- `__tests__/database/notion-migration.test.ts` 改写成「历史迁移仍然可跑、不再创建 notion 表」
- `app/api/notion/` 路由整删（`notion-route.test.ts` 一并）

### P3 Pagebound
同 P1，外加 `PageboundLinkDialog` 的调用点（`ReaderContent`）与 `types/book.ts` 的 per-book id 字段。

### P4 Hardcover
最大的一包（2,285 行 / 8 个测试）：
- `store/hardcoverSyncStore.ts` 与 `useHardcoverSync` 一起删
- `hooks/useCloudSyncStatus.ts` 里 hardcover 那一段（provider 列表、`bookKey` 分支）→ 只剩 file backends
- `ViewMenu` 的同步行只剩文件同步的状态
- `hardcoverOAuth` 的深链回跳（`utils/deeplink.ts`）
- 测试：8 个里 6 个直接删、`useCloudSyncStatus` 的相关断言改写

### P5 BookOrbit
- 先查 `app/reader/hooks/useKOSync.ts`（21KB）到底还剩什么；若已是残壳，同包删掉
- `ReadingStatsTracker`/`FoliateViewer` 的进度上报调用点
- `pages/api/bookorbit.ts` + `utils/bookorbit-ssrf` 相关测试
- `types/bookorbit.ts`、`types/book.ts` 的 per-book 字段

### P6 收尾（不删功能，只对齐）
- `IntegrationsPanel` 列表只剩：**Local Network → Nearby BookDrop**、**Cloud Sync → WebDAV**、**Content Sources → OPDS Catalogs**
- 面板描述文案从「Connect Readest to external services for sync, highlights, and catalogs.」改成符合事实的说法
- 全量 grep 复查：`grep -ri "readwise\|notion\|pagebound\|hardcover\|bookorbit" src` 应为 0（注释与测试除外）
- 全量测试 + `tsc` + web 构建 200/207 + 一次 APK 构建

## 4. 每包固定验收

```
pnpm exec tsc --noEmit | grep -v '^\.next/'      # 必须空
pnpm test                                         # 必须全绿（用例数会降）
pnpm lan:build                                    # web 构建 200/207
```

Rust 不动 ⇒ 不需要 `cargo check`；最后一包之后跑一次 APK 构建确认。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 老用户的持久化设置里有这五个键 | 保留键不会被读；`settingsService` 的默认值合并是宽松的。删掉类型后旧值只是躺在 IndexedDB 里，无害。**但要确认没有任何 `Object.keys(settings)` 之类会因此报错的地方** |
| `Book` 上的 per-book 外链 id | 删类型字段不影响已存行（多余字段被忽略），但要确认备份导入不会因为未知字段失败 |
| 迁移链 | notion 的历史迁移**保留**，只停读写（见 P2） |
| hook 顺序 | `IntegrationsPanel` 是单组件多视图，**每次删早返回都要确认 hook 都在最上面**（`a00a9713e` 的教训） |
| 测试改写 | 22 个测试文件里，共享断言一律改成「只剩文件同步/本地面板」，不整文件删 |
| 授权入口残留 | 所有「Connect」按钮与 `navigateToLogin` 分支一并删，别留下点了没反应的壳 |

## 6. 预计规模

- 专属文件：**−6,433 行**
- 共享触点：约 15 个文件、每个 2~14 行
- 测试：22 个文件（删 14 个、改写 8 个）
- 合计约 **−7,200 行 / 40+ 文件**

## 7. 不动的（明确保留）

- **WebDAV 文件同步**（`services/sync/file/**`）与 LocalSend（`components/localsend/**`）—— LAN 版的两条动脉
- **OPDS 目录**（`Content Sources`）—— 局域网自建的 OPDS 服务器也能用，属「本机/局域网」范畴
- **`clip_url` 抓取管线**（系统分享 / RSS / 网文导入）
- **AI 面板**（若用户本地接 Ollama 之类，与第三方 SaaS 授权无关）—— 若要一起删，单独立项
- 详情见 `2026-10-15-lan-only/plan.md` §4.10 的五项决策 —— 本方案不改变那些结论
