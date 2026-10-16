# Readest「LAN-only」改造：可行性分析 + 方案

- 日期：2026-10-15
- 基线：`/home/ruinb0w/Lab/readest`，`main @ 9fd7a4820`（上游干净克隆，**不是** 2026-10-14 那轮 fork）
- 用户已拍板的四项：① PC 端书本**继续放 IndexedDB**（零改动）② 局域网同步走 **WebDAV file sync + PC 当 hub** ③ **分阶段：先配置档，再按需删** ④ PC 保留 **Next standalone server**
- 后续拍板：⑤ 跨源交给 bow 的 cors 插件，**不要 Caddy** ⑥ 真删四块：登录 / 第三方同步（含 KOSync）/ 语音读书+有声书 / 翻译 ⑦ **先跑起来再删** ⑧ 语言栈清理排进顺序（Phase 3.0）

---

## 进度追踪（打勾即进度；每项完成时在行尾追 `— commit <hash>`）

> 用法：开工前改成 `- [~] 进行中`，完工改 `- [x]`。括号里是**完成判据**，不满足就不打勾。

### 前置（一次性）
- [x] **[PRE-1]** 5+2 个 submodule 初始化 + `pnpm install` + `pnpm setup-vendors` — 2026-10-15 完成（`gstack` 开发 skill 仓库故意跳过）
- [ ] **[PRE-2]** 确认旧 fork 的代码是否还在别处（若否，Phase 3.5 需重做）

### Phase 0 — 骨架（0 代码）
- [x] **[P0-1]** `BUILD_STANDALONE=true pnpm build-web` 构建成功 — 2026-10-15：✓ Compiled in 30.8s，56 个静态页（serwist 警告：Turbopack 下不产 `sw.js`，已知）
- [x] **[P0-2]** `.next/static` + `public` 拷进 standalone 树 — 完成，`.next/standalone` 186M
- [x] **[P0-3]** WebDAV hub 起来（`0.0.0.0:17322`，根 `~/readest-sync`）— rclone serve webdav，PROPFIND → **207**
- [x] **[P0-4]** standalone 起来（`0.0.0.0:17321`）— `/` → **200**，bow 能进书库
- [ ] **[P0-5]** 主机防火墙只放 17321/17322 — **待办 + 有 WSL 特情**：本机是 WSL2 镜像网络（Windows IP `192.168.1.5` = WSL `eth1`），手机要过 Windows 防火墙/Hyper-V 防火墙才进得来，待真机验
- [x] **[P0-6]** 启停脚本进仓库 + 挂 `package.json` — 2026-10-15：`scripts/lan/{start,stop,status,build}.sh` + `lan-common.sh` + `lan.env.example`；root scripts 新增 `lan:build`/`lan:start`/`lan:stop`/`lan:status`/`lan:logs`；配置留在仓库外 `~/readest-lan/webdav.env`(600)
- [x] **[P0-7]** 包管理器 bun 的评估 + 排期 — 2026-10-15：写进 §8，定为 **Phase 6**（Phase 3 之后）；在那之前日常用 `bun run lan:*`（实测可用）

### Phase 1 — LAN 档（0 代码）
- [x] **[P1-1]** 启动 env 到位 — `~/readest-lan/{start.sh,stop.sh,webdav.env}`；实测 `runtime-config.js` 返回：`{"supabaseUrl":"http://127.0.0.1:9/","supabaseAnonKey":"lan-dummy","apiBaseUrl":"http://localhost:17321","selfHosted":true}`
- [x] **[P1-2]** 设置里出现 WebDAV 行且无 Premium 徽章 — 2026-10-15 实测：集成面板里 WebDAV 行在、**全局无 Premium 徽章**（本来还应有 Google Drive/S3/OneDrive 行，那些随 [B] 删）；iCloud 在 web 平台不显示
- [x] **[P1-3]** WebDAV 配好并双向验证 — **2026-10-15 四项全部通过**
  - 配：`http://127.0.0.1:17322` + user `readest` + rootPath `/` → “连接”成功（13 个 DAV 请求）
  - **书目 ✓** 远端出现 `Readest/library.json`（含行）
  - **进度 ✓** 对端伪造（直接 PUT config.json，`writerDeviceId=fake-peer-device`，`progress:[7,318]`，location `epubcfi(/6/14!/4/2/2/2)`）→ 打开书后 reader 跳到 `/6/14` 章，随后本机盖章（`[10,318]`）
  - **笔记 ✓** 对端批注 `对端批注：LAN 同步测试` 在本地 IDB 出现，**且推回时没被抹掉**
  - **书文件 ✓** 用户手动拖入 `testbook.epub` → 变成**文件-backed 行**（新 hash `06e01d70…`）→ 远端出现 `books/06e01d70…/指数基金投资指南.epub`（PUT 日志可查）；另拖入的《毛泽东选集（全四卷）》（`e957fd27…`，`url=None`）同样把 epub 推上了远端
  - **遗留**：只剩“**PC 拉一本书**”这个方向（远端有、本机没有）—— 能在 Android 真机阶段一并验（[P4-2]/[P5-1]）
  - 附带发现：① `isDemoBook()` **只管云（replica）那条路**，WebDAV file sync 把 demo 行当普通书 ② **同一个 epub 会因为来源不同而拿到不同 hash**：URL-backed demo 行是 `1914c8c5…`，拖拽导入的同一文件是 `06e01d70…` → 库里会出现两行同一本书（demo 机制的副作用）
- [x] **[P1-4]** **外联归零验收 — 通过**（2026-10-15）：修完 [P2-3]/[P2-6]/[P2-7] 后冷启动 `performance` 里**外部域名 0 个**（`cdn.readest.com` 与 `us.i.posthog.com` 都消失）；`telemetryDecision=opt-out`

### Phase 2 — 三处小补丁（~30 行）
- [x] **[P2-1]** 无 Supabase 时跳过 auth 启动（`AuthContext.tsx` + `utils/supabase.ts`）
- [x] **[P2-2]** `keepLogin` 不再跳 `/auth`（`library/page.tsx:733-744`）
- [x] **[P2-3]** self-hosted 下不 init PostHog（`PHContext.tsx`）— 完成：`initPostHog()` 里加 `isSelfHosted()` 短路；**并在 `Providers.tsx` 的 `finalizeTelemetryDecision` 开头加 self-hosted 短路**（直接 opt-out + 把 settings 里的 `telemetryEnabled` 写回 false，否则老装的 `true` 会把决议翻回 opt-in）
- [ ] **[P2-4]** 可选：外链资源收口（`fontBaseUrl` / WordLens / R2 词典源）
- [ ] **[P2-5]** 可选：WebDAV 做进 Next 路由（~300–500 行 + 测试）
- [x] **[P2-6]** **关掉 demo 书的外网拉取** — 完成：`public/demo/testbook.epub`（你给的样书）+ 两份 JSON 只留 `/demo/testbook.epub` + `demoBooks.ts` 模块加载时把「以 `/` 开头」的条目拼 `location.origin`（Set 用同一份改写结果）。实测：书从同源源加载、进库显示《指数基金投资指南》
- [x] **[P2-7]** **默认遥测改成关** — 完成：`src/services/constants.ts` 的 `telemetryEnabled: true` → `false`

### Phase 3.0a — 零风险平台清理（先做）
- [x] **[P3a-1]** `src-tauri/gen/apple/**` + 两个插件的 `ios/` + `Info-ios.plist` + `tauri.macos-nonestore.conf.json`（~~fastlane~~ 已随第一批删完） — ✅（af905f73c）
- [x] **[P3a-2]** `packages/swift-rs` + `[patch.crates-io] swift-rs`；⚠️ **`sign-in-with-apple` / `sharekit` 不在这里删**（见 3.0a 开头两条修正） — ✅（af905f73c）
- [x] **[P3a-3]** `apps/readest.koplugin/**`（含它自带的 Rust crate `native/localsend-bin`）— 2026-10-15 完成（commit `0a42152aa`，连同 calibre/crosspoint/workers/fastlane 共 286 文件、-58,078 行）
- [x] **[P3a-4]** `apps/readest-calibre-plugin/**` + `apps/readest-crosspoint-plugin/**` — 完成
- [x] **[P3a-5]** `workers/{iap-reconcile,send-email}` + `pnpm-workspace.yaml` 两行 + 引用它们的测试 — 完成
- [ ] **[P3a-6]** CEF：stub + `cef` feature + `.cargo/cef.toml` + `Cargo.cef.lock` + `try-appimage.yml`
- [ ] **[P3a-7]** 桌面 Rust：`nightly_update`/`discord_rpc`/`spawn_fresh_browser`/`window_state`/`browser_cookies_macos`/`linux_*`/`file_reveal` + `src/macos/**` + native-bridge 的 `platform/{windows,macos,linux_cef,cdp}.rs`
- [ ] **[P3a-8]** CI 卫生：4 个 workflow 的 koplugin/calibre/macOS job + ~~root/app `package.json`（已做）~~
- [x] **[P3a-9]** 部分验：`tsc` 干净 + **全量单测 1151 文件/13603 用例全绿** + `pnpm lan:build` 成功；**待做**：`cargo check --target aarch64-linux-android` + APK 装机
- [x] **[P3a-10]** **修单测基线**（本来不在计划里）：Node 26 的 `localStorage` 遮住 jsdom 的 → 本 checkout **89 文件/746 用例失败**。`vitest.setup.ts` 装**真 jsdom Storage**（重新 prototype 到本 realm 的 `Storage.prototype`，保住 `vi.spyOn` 拦截）+ Map 兜底 → 全绿。另：`demo-books-sync.test.tsx` 改为从 `demoLibraries` 取 URL（不再钉死 cdn 地址）

### Phase 2.5-A — 删登录
- [x] **[A-1]** `useAuth()` 换成返回固定空态的 stub（判据：48 个调用点不动，`tsc` 通过）
- [x] **[A-2]** `useQuotaStats()` 换成 self-hosted 常值
- [x] **[A-3]** 删 `src/app/auth/**` + `src/app/user/**` + `pages/api/user/*` + `utils/supabase.ts` + `libs/user.ts`
- [ ] **[A-4]** 随 A 走：`start_server`(oauth 回环) + `BillingManager.kt`×2 + `OAuthCallbackTarget.kt` + `macos/{safari_auth,apple_auth}.rs`
- [x] **[A-5]** 撕掉三处“创可贴”：Supabase 假值 + `keepLogin` 守卫 + PostHog guard
- [x] **[A-6]** 验：书库/阅读/笔记正常；Network 无任何 supabase 域名；26 个 auth 测试已删/改

### Phase 2.5-B — 删第三方同步 + KOSync + replica
- [x] **[B-1]** `providers/{gdrive,s3,onedrive,icloud,oauth}` + 4 个设置表单 + 四个 settings slice — ✅（37870bd4a）
- [x] **[B-2]** `providerRegistry` 只剩 `webdav` — ✅（37870bd4a）
- [x] **[B-3]** KOSync（**单独一个提交**）：`KOSyncClient.ts` + `pages/api/kosync.ts` + `KOSyncForm.tsx` + `useKOSync`/`kosyncProgress`/`KOSyncResolver` + Reader 核心挂点（`Reader.tsx`/`ReaderContent.tsx`/`FoliateViewer.tsx`/`BookMenu`/`ViewMenu`/`useFileSync`/`useNotebookDocumentCoordinator`/`bookOrbitProgressProvider`）+ `readerStore`/`settingsService`/`constants`/`utils/{customHeaders,network}`
- [x] **[B-4]** 删 replica（~9.3k 行）；`cloudSyncProvider.ts`/`syncCategories.ts` **瘦身**而非直删
- [x] **[B-5]** 验：集成列表只剩 WebDAV；指向不存在的地址时只有 WebDAV 报错，无云回落 — ✅（da7c75017）

### Phase 2.5-C — 删 TTS + 有声书
- [x] **[C-1]** `src/services/tts/**`（47 文件）+ `libs/readestVoice` + `libs/edgeTTS.ts` + `app/api/tts/**` — ✅ `c6cc79f69`
- [x] **[C-2]** 有声书：`services/audiobook/**` + `services/audiobookshelf/**` + `app/player/**` + `absServerStore` + `ABSForm` — ✅ `c6cc79f69`
- [x] **[C-3]** `utils/audiobook.ts` + 32 个 import 点的分支消除 — ✅ `c6cc79f69`
- [x] **[C-4]** Reader TTS UI + `TTSPanel.tsx` + `tts` settings slice + `ttsDownloadStore` + `sync/file/ttsPackSync` + engine 阶段 — ✅ `c6cc79f69`
- [x] **[C-5]** 交叉 5 处：`statistics/ttsStatsRecorder`、`dictionaries/providers/mdictProvider`(SILENCE_DATA)、`opds/openOpdsAudiobook`、`bookorbit/{openBookOrbitAudiobook,narration}` — ✅ `c6cc79f69`
- [x] **[C-6]** 随 C 走：`plugins/tauri-plugin-native-tts/**`（5934 行）+ tauri CSP 里的 edge/微软域名 — ✅ `c6cc79f69`
- [x] **[C-7]** 验：84 个 tts 测试已清；能开书、翻页、加笔记；WebDAV 同步不受影响 — ✅ `c6cc79f69`

### Phase 2.5-D — 删翻译
- [x] **[D-1]** `services/translators/**` + 3 个 API 路由（`azure-translate`/`yandex-translate`/`pages/api/deepl/translate`） — ✅ `19acfb5dd`
- [x] **[D-2]** `useTranslator`/`useTextTranslation`/`TranslatorPopup`/`TranslationToggler`/`translationMarkup` — ✅ `19acfb5dd`
- [x] **[D-3]** `CustomTranslator{Editor,s}.tsx` + `customTranslatorStore` + `types/translation.ts` + `sync/adapters/customTranslator.ts` — ✅ `19acfb5dd`
- [x] **[D-4]** 收尾 `dictionaries/contextDictionary.ts` + `LangPanel` 的 `translationProvider`/`translateTargetLang` — ✅ `19acfb5dd`
- [x] **[D-5]** 验：6 个 translator 测试已清；**`hooks/useTranslation.ts`（i18n）未动** — ✅ `19acfb5dd`

### Phase 3.0b — 判断批（需拍板）
- [ ] **[3b-1]** 网页剪藏（`web_browser`+`clip_url`+`browser_fetch`+`media_proxy` 2876 行）删 / 留
- [ ] **[3b-2]** LocalSend（Rust + `services/localsend` + `LocalSendForm`）删 / 留
- [ ] **[3b-3]** 遥测：`sentry_config.rs` + `tauri-plugin-sentry` + `@sentry/*`（不删就要把 DSN 置空）
- [x] **[3b-4]** 墨水屏：删（**用户 2026-10-16 拍板**）—— `eink_identity.rs` + `android/eink.rs` + `EinkRefreshController.kt`
- [ ] **[3b-5]** 三个 submodule：`qcms` / `js-mdict` / `simplecc-wasm`（删哪个就要删对应功能）

### 可选 / 收尾
- [ ] **[P3-1]** Phase 3 其余裁剪（支付/云/其他第三方集成，可选）
- [ ] **[P3.5-1]** file sync 覆盖扩展：settings / 书架 / 字体 / 词典（旧 fork 代码找回则减半）
- [ ] **[P6-1]** **Phase 6：包管理器 pnpm → bun**（放在 Phase 3 之后，评估 + 五条验收清单见 §8）
- [ ] **[P7-1]** **Phase 7：demo 幽灵行 / URL 式 demo 判定修复**（看 §9；子项 P7-a..P7-e）
- [~] **[P4-1]** Android APK 构建 — **2026-10-15 首次构建成功**（下方配方已修正为实测版）；装机待手机 adb 恢复
  - 产物：`~/readest-lan/dist/readest-lan-v0.12.16-first-apk.apk`（61.5MB，sha256 `f6f1fbee82ae…`）+ 同名 `.aab`
  - 签名：`apksigner verify` → `CN=Readest LAN`（新 keystore `~/readest-lan/android/readest-lan.jks`，口令在 `keystore.env` 600）
  - premium 解锁：`out/_next/static/chunks/*.js` 里是 `(process.env.SELF_HOSTED || "true") === "true"` ⇒ Tauri 下为 true ✅
  - 耗时：cargo 冷 9m29s → 热 4m48s；Gradle 首次 ~13min；合计 ~25min
- [x] **[P4-2]** 真机（模拟器 `emulator-5554`，x86_64 + `libndk_translation`）— **2026-10-15 通过**：WebDAV 填 `http://10.0.2.2:17322`（模拟器里的宿主回环别名）→ Connect 成功，一次拉取 16 个 DAV 请求（`library.json` + 3 本的 cover/config）→ 手机书库从 0 变 3 本，而且那本带对端进度的显示 **3%**；首次同步后手机自己也 `MKCOL Readest` + `PUT library.json`（推回方向）
- [x] **[P4-3]** **cleartext http 完全没被拦** — `plugin-http`（Rust reqwest）不走 Android 的 cleartext 策略，`http://…:17322` 直接能用，**不需要 network-security-config**
- [x] **[P1-3-σ]** 顺带补完：“远端有、本机全无”的设备（手机）拉取成功 ⇒ 拉取方向确认
- [ ] **[P0-5]** 防火墙 — **模拟器这条路不算数**：模拟器通过 `10.0.2.2`/宿主 NAT 访问，与“手机过 WiFi 采 PC 的 192.168.1.5”不是同一条路。要验防火墙必须上真机
- [ ] **[P4-4]** 开书时下载书文件：未验到（点书卡没打开 reader，可能需再试/翻译层较慢）；书卡上的云图标 = 未落本地、开书时才拉
- [ ] **[P4-5]** **服务监督**：LAN 两个进程在会话过程中**静默死过一次**（发现时 17321/17322 都没监听），导致我第一次对模拟器的探测全部白测、并一度误判成“模拟器连不上 WSL”。→ 每次开测前先 `pnpm lan:status`；考虑给 `start.sh` 加个看门狗
- [ ] **[P5-1]** 跑完 §4 Phase 5 验证矩阵（含“对端伪造写入 + 同一 eval 立刻触发同步”那条）

### 遗留 / 待办（本轮新出）
- [ ] **[P2-8]** demo 清单改回空数组？（见 §9 的 [P7-b]，两个选项择一）
- [x] **[P1-3-σ]** 补验“**PC 拉一本书**”方向 — **已由模拟器验证覆盖**：全新安装、书库为空的客户端拉回 3 本（见 [P4-2]）
- [ ] **[P4-4]** 开书时下载书文件（手机侧）：模拟器上点书卡没打开 reader，未验到（书卡上的云图标 = 未落本地、开书时才拉）
- [ ] **[P4-5]** **服务监督**：LAN 两进程在会话中**静默死过一次**（17321/17322 均无监听、进程不存在），导致对模拟器的探测全白测、一度误判成“模拟器连不上 WSL”。⇒ 开测前先 `pnpm lan:status`；考虑给 `start.sh` 加看门狗
- [ ] **[P0-5]** 防火墙 — **模拟器这条路不算数**：模拟器走 `10.0.2.2`/宿主 NAT，与“手机过 WiFi 连 PC 的 192.168.1.5”不是同一条路。要验防火墙必须上真机
- [ ] **[P7-1]** demo 幽灵行：**已有第二台设备的实锤**（手机书库出现两张《指数基金投资指南》）

### ⚠️ 2026-10-15 顺序修正：B1/B2 纠缠，建议先做功能裁剪

原计划把 **B1（Apple 产物 + `src/macos` + swift-rs）** 当“零风险纯删除”排在四件事之前。实地核实后发现**不成立**：

- `src/macos/{window,menu,traffic_light,safari_auth,apple_auth,system_dictionary}.rs` 的函数被 **`#[cfg(desktop)]` 的入口代码调用**（`lib.rs:1089/1097/1138/1141/1152` 在 window 关闭/RunEvent 分支里调 `macos::window::hide_main_window` / `restore_main_window_frame`；`lib.rs:784-790` 注册三个 macOS 插件）⇒ 删 `src/macos` 必须**连桌面入口代码一起删**，B1 与 B2 是同一件事。
- 而桌面入口（`lib.rs` 1227 行里大量 `#[cfg(desktop)]` 区域：窗口构建 / updater / single-instance / discord_rpc / menu / RunEvent）**只能靠肉眼看**：宿主编译（Linux）会编译 `cfg(desktop)` 代码但那已不是我们的目标，Android 编译又会把 `cfg(desktop)` 全部编掉，macOS 代码更无法在本机编译。
- 收益仅“仓库变小 + 构建略快”，风险是弄坏入口点，且验证手段只有一次 7–30 分钟的 APK 构建。

**→ 修正后的顺序：先 Round C（纯 JS、每步 2.5 分钟可验、功能收益大），Rust 减肥放到最后（“Phase 3.0a 终章”，一次做完 + 一次 APK 构建）**。
iOS/macOS 的**产物**（`src-tauri/gen/apple`、两个插件的 `ios/`、`Info-ios.plist`、`tauri.macos-nonestore.conf.json`、`packages/swift-rs` + root `[patch.crates-io] swift-rs`、`bundle.macOS`/`bundle.iOS` 配置）**不被任何 Rust 代码引用**，属于真·零风险，可以单独先删（本次就做这一块）。

### 当前状态（每次会话结束时更新这一行）
- 本文件版本：2026-10-15 建；已完成 PRE-1 → P0-1..P0-7 → P1-1..P1-4 → P2-3/6/7 → P3a-3/4/5 + P3a-10 → P3a-1/2 零风险部分 → **2.5-A 删登录** → **2.5-B 全部（provider / replica / 客户端 / KOSync / 收尾）**
- 提交（本会话 12 个）：`6297e0ce0` `0a42152aa` `2c8ab87a4` `af905f73c` `f232266de` `225619b17` `37870bd4a` `169ded3ae` `5cba8a353` `d14631ef2` `1a7f4db67` `1a8b277f8`
- **基线持续全绿**：1040 文件 / 12482 用例 / 0 失败；服务在跑（200/207）
- 下一步：**[C] 删 TTS + 有声书**（顺带删 `native-tts` crate + Kotlin 侧；完了跑一次 APK 验证），然后 **[D] 删翻译**；两者都是纯 JS + 一次 Android 构建
- 遗留：Phase 7（demo 幽灵行，见 §9）、[P0-5] 防火墙 + 手机真机、[P1-3-σ] 拉书方向
- 注意：驱动 bow 自动化时**必须显式传 `tabId`**，而且**先确认用户没在用 bow**

### 2026-10-15 第二轮：Phase 2 三处小改 + 外联归零 + WebDAV 双向（实测）

**改动（都在既有文件里，~25 行）**：

| 文件 | 改什么 |
|---|---|
| `src/services/demoBooks.ts` | 新增 `resolveDemoUrl`/`resolveLibrary`：以 `/` 开头的 demo URL 拼 `location.origin`；`demoLibraries` 与 `demoBookUrls` 共用同一份改写结果 |
| `src/data/demo/library.{en,zh}.json` | 6 条 cdn.readest.com URL → 1 条 `/demo/testbook.epub` |
| `public/demo/testbook.epub` | 新增（你给的样书，6.8MB） |
| `src/services/constants.ts` | `telemetryEnabled: true` → `false` |
| `src/context/PHContext.tsx` | `initPostHog()` 里 `isSelfHosted()` 短路 |
| `src/components/Providers.tsx` | `finalizeTelemetryDecision` 开头 self-hosted 短路（opt-out + 回写 settings） |

**验收**：`tsc --noEmit` 干净；`pnpm lan:build` 成功（standalone 193M）；冷启动 `performance` 里**外部域名 = []**（之前是 `cdn.readest.com` + `us.i.posthog.com`）；`telemetryDecision=opt-out`；库里《指数基金投资指南》正常显示。

**WebDAV 双向（照 memory 的方法论：直接 PUT 模拟对端）**：
- 连接：UI 填 URL/用户名/密码/根目录 → 13 个 DAV 请求，状态“几秒前已同步”
- 推送：远端 `Readest/{library.json, books/<hash>/{config.json, cover.png}}`
- 拉取（进度）：远端放入 `progress:[7,318]` + `location:epubcfi(/6/14!/4/2/2/2)` → 打开书 → reader 落在 `/6/14` 章 → 本机盖章 `[10,318]`
- 拉取（笔记）+ 回写保留：对端批注在本地 IDB 出现，且本机 push 后**未抹掉**

**踩到的坑（重要，下次自动化直接用）**：
1. `browser_*` 工具**不传 `tabId` 会作用在“活动标签”上**，而用户可能同时在用 bow（本轮撞上：活动标签变成 GoFundBot，同一点击/求值跑到了别人的页面上）。→ **必须显式传 `tabId`，且先确认用户没在动 bow**。
2. demo 书页面上看不到 `input[type=file]`（导入走的是其它路径），所以“导入真·本地文件”这一步需要人工拖拽或在你不用 bow 时再试。
3. `isDemoBook()` **只拦云同步**，WebDAV file sync 会照常把 demo 行写进远端 library.json —— 以后排查“远端多出可疑行”先想到这条。

---

## 实测记录

### 2026-10-15 第一次跑通（PRE-1 → P0-4）

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| submodule | `git submodule update --init --depth 1 packages/{foliate-js,js-mdict,simplecc-wasm,qcms,tauri} src-tauri/plugins/{tauri-plugin-turso,tauri-plugin-webview-upgrade}` | 7 个到位（`gstack` 跳过） |
| 依赖 | `pnpm install --frozen-lockfile` | 1649 包，**9.4s**（pnpm store 全部命中） |
| vendor | `pnpm --filter @readest/readest-app setup-vendors` | `public/vendor/pdfjs` 5.2M / 18 项 |
| 构建 | `BUILD_STANDALONE=true pnpm build-web` | ✓ 30.8s，56 静态页 |
| 拷资源 | `cp -r .next/static .next/standalone/apps/readest-app/.next/static` + `cp -r public ...` | 完成（**不拷会白屏**，standalone 不自带） |
| 起服务 | `~/readest-lan/start.sh` | app `/`→200、`runtime-config.js`→200、dav PROPFIND→**207** |
| 浏览器 | bow 打开 `http://localhost:17321` | 空书库页正常渲染，**未跳 `/auth`**（因为没有 `keepLogin`） |
| 脚本化 | `pnpm lan:build` / `lan:start` / `lan:stop` / `lan:status`（=`bash scripts/lan/*.sh`） | `lan:stop` 能按端口停掉 `next-server` 与 `rclone`；`lan:start` 探活 200/207；`lan:status` 带 runtime-config 自检 |
| IndexedDB | `indexedDB.databases()` | `AppFileSystem@1`、`TranslationCache@1`（后者随 D 删翻译一起消失） |

### 网络拓扑：本机是 WSL2 **镜像模式**
- WSL `eth1` = `192.168.1.5/24`，Windows `WLAN` 也是 `192.168.1.5` → **镜像模式**（非 NAT），所以 WSL 里 `0.0.0.0` 监听在 LAN 上可见
- Windows 侧验证：`curl.exe http://localhost:17321/` → **200**；`curl.exe -X PROPFIND -u readest:*** http://localhost:17322/` → **207** ⇒ **bow（跑在 Windows）用 `localhost` 两个端口都通**，与方案一致
- 推论：手机应该能直连 `http://192.168.1.5:17322`，**不需要 `adb reverse`**（以前那轮用 adb reverse 是因为当时拓扑不同）。待真机验（[P4-2]/[P4-3]/[P0-5]）
- `adb devices` 当前为空（手机没接）

### 外泄实测（[P1-4] 未通过，两个真因）

1. **PostHog 在发数据，而且带重试**：`us.i.posthog.com/e/?retry_count=1..4`。原因链：`localStorage['readest-telemetry-decision'] === 'opt-in'` + `telemetryEnabled` 默认 `true`（`src/services/constants.ts:234`）。
   - 实测：清掉两个 telemetry key 后 reload（此时 `settings.json` 已存在 ⇒ `isNewUser = !hadSettingsFile` = false）→ 走 `Providers.tsx` 的 **existing-user 分支** → `settings.telemetryEnabled` 默认真 → `optInTelemetry()` → 决议被写成 `opt-in`，PostHog 当场开火。
   - 结论：**[P2-3]（不 init）+ [P2-7]（默认 false）两个都得做**，只做 guard 也够起效，但那把开关在后续读设置时还会把决议翻回 `opt-in`。
2. **demo 书从 Readest CDN 拉**：`https://cdn.readest.com/books/four-great-classics.epub`、`.../journey-to-the-west.epub`（localStorage 留了 `demoBooksFetched` 标记）。空书库时自动发生 → **[P2-6]**。

### 两条红线本次实测的表现
- **红线 2（`API_BASE_URL`）**：`web.readest.com` **0 命中** ✓，`runtime-config.apiBaseUrl` = `http://localhost:17321` 生效
- **红线 3（Supabase 假值）**：`supabase.co` **0 命中**，而且 `127.0.0.1:9` 也没发过请求 —— 因为**无会话时 supabase-js 的 `refreshSession()` 在本地就短路了**，不发网络请求。⇒ 假值真正起作用的场景是“有残留会话”；[A]（删登录）之后这层彻底不需要

---

## 0. 结论速览

**可行，而且比 2026-10-14 那轮预估的工作量小得多。** 上游已经把地基铺好了：

| 你要的能力 | 上游现状 | 结论 |
|---|---|---|
| 不要云同步 | `readestCloud.enabled=false` 就能停掉自有云同步；第三方 file sync 是独立开关 | 配置即可 |
| 解锁 premium（否则 WebDAV 行被 paywall 挡） | `SELF_HOSTED=true` 一次解锁全部 premium | 配置即可 |
| 局域网同步 | **WebDAV file sync 已内置**（书文件/封面/`library.json`/每本 `config.json`/TTS 分节包） | 配置 + 起一个 hub |
| 设备间直接传书 | **LocalSend 已内置**（Rust，Android 也能编） | 已有 |
| PC 服务端 | standalone server（Dockerfile 就是这条路） | 配置即可 |
| Android 自建 APK | Tauri Android 构建链在本机可用（上次已验证） | 构建配方沿用 |

**必须知道的三条红线：**

1. **PC 端"书本落在真实磁盘文件里"在纯浏览器里做不到。** 浏览器只给 IndexedDB / OPFS，或者 File System Access API（要用户选目录 + 每个会话重新授权）。你选了 IndexedDB，所以这条不构成问题——但要知道代价：书是 IDB 里的 blob，不能拿文件管理器直接看/拷。
2. **不设 `API_BASE_URL` 的生产构建会偷偷打 `https://web.readest.com/api`。** 见 §0.1。
3. **不覆盖 Supabase 默认值，客户端启动就会打 readest 的公有 Supabase。** 见 §0.1。

### 0.1 红线 2 / 3 逐条拆解（为什么绕不过去）

**红线 2：谁会打 `web.readest.com`，什么时候。**

取值链（`src/services/environment.ts:41-46` + `src/services/constants.ts:958`）：

```
getBaseUrl() = runtimeConfig.apiBaseUrl            ← /runtime-config.js 在运行期注入（优先）
            ?? API_BASE_URL                        ← 服务端 env（运行期）
            ?? NEXT_PUBLIC_API_BASE_URL            ← 构建期内联
            ?? 'https://web.readest.com'           ← 兜底常量

getAPIBaseUrl() = NODE_ENV === 'development' ? '/api' : `${getBaseUrl()}/api`
```

三个关键点：
- **开发模式看不见这个坑**：`pnpm dev-web` 下 `NODE_ENV=development`，直接返回相对路径 `/api`，一切正常。**只有生产构建**（`NODE_ENV=production`）才会走 `${getBaseUrl()}/api`。
- **浏览器里只有 `NEXT_PUBLIC_*` 会被内联**，非公开的 `process.env.API_BASE_URL` 在浏览器端读出来是 `undefined`；真正能在运行期生效的入口是服务端 env → `/runtime-config.js`（`src/app/runtime-config.js/route.ts`）。所以 Phase 1 是**设运行期 env，不用重编**。
- **代价不是"慢"，是"功能坏 + 请求外泄"**：`getAPIBaseUrl()` 有 30 处调用点，元数据搜索、翻译代理、TTS、OPDS 代理、统计归档全走它。请求会真的发到 `web.readest.com/api`，然后被 CORS 拒（readest.com 不会给局域网 origin 放行）→ 前端只看到一片 `Failed to fetch`，但你的 IP/使用时间已经发出去了。

**红线 3：Supabase 默认值为什么不能置空，只能给假值。**

`apps/readest-app/.env`（**被 git 跟踪**，Next 会自动加载）里烧了三组 base64 默认值，`src/utils/supabase.ts:1-13` 用的是 `||` 链：

```
supabaseUrl = runtimeConfig.supabaseUrl      ← 服务端 env 注入
           || process.env.SUPABASE_URL
           || process.env.NEXT_PUBLIC_SUPABASE_URL
           || atob(NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64)   ← 真地址，兜底到它
                                                   = https://vbsyxfusjjqdxkjqlysc.supabase.co
```

- `||` 在**空串上也穿透**：`??` 只在 `null/undefined` 时穿透。所以 `SUPABASE_PUBLIC_URL=` 这种"置空"写法等于没写，会掉到那个真地址上。
- 这段是**模块顶层代码**，不是函数：`new URL(supabaseUrl)` 立刻要跑通 → 给 `undefined` 会直接抛错白屏；`createClient(url, key)` 又要求 key 非空，否则抛 `supabaseKey is required`。**所以"不配"和"配空"都不行，只能给语法合法、但指向死地址的假值。**
- 触发时机：`src/context/AuthContext.tsx:62-75` 挂载即 `refreshSession()` → 一次 `POST /auth/v1/token` 到 readest 的 Supabase（无 token → 400）。这条是**每次冷启动必发**。
- 假值方案：`SUPABASE_PUBLIC_URL=http://127.0.0.1:9/`（端口 9 = discard，本机没人监听 → 立刻 `ECONNREFUSED`，**不做 DNS、不出网卡**）+ `SUPABASE_ANON_KEY=lan-dummy`。效果：那次 refresh 立刻失败 → `catch` → `syncSession(null)` → 干净的无账号态。
- 另外两组默认值：**PostHog** 默认 opt-out（`src/context/PHContext.tsx:35-48` 关了 flags/session-recording，且 `opt_out_capturing_by_default`）→ 实际不发事件，但 SDK 仍会用烧进去的 key init（Phase 2 第 3 条一行 guard 收掉）；**Stripe** 密钥只在打开收银台时用 → LAN 档永远碰不到。
- 三条修法（任选/叠加）：
  - **(a) 零代码**：运行期给非空假值（上面这对）。
  - **(b) 构建期**：在 gitignored 的 `.env.local` 覆盖 `NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64` / `_KEY_BASE64` / `_POSTHOG_*`，但要重编，且只能覆盖 Web 侧。
  - **(c) 干净**（Phase 2 第 1 条，推荐最终形态）：`isSelfHosted() && !runtimeConfig.supabaseUrl` 时**根本不初始化 supabase client**，连死地址都不用连。

### 0.2 端口方案（避开 3000/3001/8080）

Selected `1732x` 段（不在 IANA 常用服务里，也不在各类 dev server 默认值里）：

| 用途 | 绑定 | 谁访问 | 说明 |
|---|---|---|---|
| Next standalone（UI + `/api`） | `0.0.0.0:17321` | PC 的 bow、手机（可选） | `API_BASE_URL` 指向它 |
| WebDAV hub（dufs/rclone） | `0.0.0.0:17322` | PC 的 bow、手机 | 文件真身在这里，两端都直连 |

> **没有反代层**：PC 端的跨源交给 bow 的 CORS 插件（见 §0.3），手机端本来无 CORS 概念。

- PC（bow）：UI `http://localhost:17321`（必须是 `localhost`，见 §1 设计要点），WebDAV `http://127.0.0.1:17322`，`API_BASE_URL=http://localhost:17321`
- 手机：`serverUrl = http://<PC-IP>:17322`；若也要用 `/api`，构建期 `NEXT_PUBLIC_API_BASE_URL=http://<PC-IP>:17321`
- 防火墙只放 17321 / 17322 两个口
- 端口冲突排查：`ss -ltnp | grep 1732`

### 0.3 跨源：不动手，交给 bow 的 CORS 插件

**结论：不需要 Caddy / 反代 / 同源。** PC 端的跨源请求由 bow 的 `cors` 插件注入放行头，已覆盖 WebDAV 的全部需要（`/home/ruinb0w/Workspace/bow`，commit `5b106a9`）：

| 需求 | bow 插件怎么做的 | 证据 |
|---|---|---|
| 预检放行 `PROPFIND`/`MKCOL` 等非标准方法 | 回显 `Access-Control-Request-Method`；无预检信息时回退到含全部 WebDAV 方法的默认集 | `src/shared/cors.ts` `buildCorsResponseHeaders()` / `CORS_DEFAULT_METHODS` |
| 放行 `Authorization` 头 | 回显 `Access-Control-Request-Headers` | 同上 |
| 让 JS 读到 `ETag`（增量同步靠它） | `Access-Control-Expose-Headers: *` | 同上 |
| WebDAV 服务器对 `OPTIONS` 返回 404/405 | 预检响应被强制改写为 `HTTP/1.1 200 OK` | `src/plugins/cors/main.ts` `onHeadersReceived` |
| 哪些请求放行 | 目标主机在白名单**或发起页面在白名单**；默认名单 `['localhost','127.0.0.1','[::1]']`、默认 `enabled: true` | `shouldBypassCors()`；`src/shared/url.ts:14-15` |

- 我们的形态天然命中「发起页面在白名单」：UI 开在 `http://localhost:17321` → 从它发出的跨源请求都会被注入放行头。
- Readest 的 WebDAV 客户端**不带 credentials**（`src/services/sync/providers/webdav/client.ts` 里没有 `credentials:`，认证走 `Authorization: Basic`），所以插件保持 `ACAO: *` 完全够用（预检回显的 `Allow-Headers` 会带上 `authorization`）。
- **前提 / 边界**：CORS 放行只发生在 **bow 里**。用普通 Chrome 打开同一页面，WebDAV 仍会因跨源失败——所以「PC 端固定用 bow」是这套方案的前置条件。
- **手机端无关**：Tauri 走 `plugin-http`（Rust 侧），没有 CORS 概念。
- 另有一种「彻底不靠壳」的备选：Next `rewrites` 把 `/dav/:path*` 指到 `http://127.0.0.1:17322/:path*` → 同源（改 `next.config.mjs` 几行 + 重编，需实测 PROPFIND/流式上传）。留作 Plan B，不用现在做。

**上一轮 fork 的代码不在本机**：`settingsWire.ts` / `bookshelfWire.ts` 全盘搜不到，memory 里的 commit（`9bf8e733c`/`4fe1e5167`/`7bcc4dfdd`）在本仓库 `git cat-file` 全部 MISSING。也就是说 fork 的 Phase 3.1–3.3（settings / 字体词典二进制 / 书架进 file sync）**要么找回原始 checkout，要么重做**。

### 0.4 本次简化范围（用户拍板）

在 LAN 档基础上**真删**四块（不只隐藏）：

1. **登录 / 账号**（Supabase auth、/auth、/user、存储配额）
2. **其他第三方同步**（gdrive / s3 / onedrive / icloud / oauth）+ **KOReader 进度同步（KOSync）** —— 只留 WebDAV
3. **语音读书（TTS / Read Aloud）** + **有声书也算**（本地录音 / Audiobookshelf / OPDS 有声书 / EPUB Media Overlay 朗读）
4. **翻译**（DeepL / Google / Azure / Yandex / 自定义 OpenAI 兼容）

**执行顺序（用户拍板）：先跑起来，再删。** 先用 §4 Phase 0/1 把 LAN 档跑通（能读书、能 WebDAV 同步），然后一件一件删，**每件单独提交 + 跑全量测试**。
后果：Supabase 假值、`keepLogin` 守卫、PostHog guard 这三处“创可贴”要暂时留着；等 A（登录）删完，它们可以连着一起撕掉。

执行细节（删什么 / 留什么壳 / 连锁什么）见 §4 的 **Phase 2.5**。

---

## 1. 目标架构

```
          ┌─────────────────────────── PC ───────────────────────────┐
          │  Next standalone  0.0.0.0:17321   UI + /api               │
          │  WebDAV hub       0.0.0.0:17322   同步根 ~/readest-sync/... │
          │   （两个进程，无 Caddy；跨源由 bow 的 cors 插件处理）      │
          │  bow 打开 http://localhost:17321 ← localhost = secure ctx │
          │  数据/书：IndexedDB「AppFileSystem」+ 每本 search.db(OPFS) │
          └───────────────────────────────────────────────────────────┘
                              ▲ 局域网 http（PC :17322；可选 :17321）
                              │
          ┌─────────────── Android（Tauri APK）────────────────────┐
          │  WebView 载本地资源（安全上下文，零降级）               │
          │  数据/书：应用私有目录的真文件（tauri-plugin-fs）        │
          │  SQLite：tauri-plugin-turso                            │
          │  WebDAV 客户端：tauri-plugin-http（Rust 侧，无 CORS、   │
          │                 且不受 Android cleartext 策略约束）      │
          └────────────────────────────────────────────────────────┘
```

设计要点：
- **跨源交给 bow**：UI 在 `localhost:17321`、WebDAV 在 `127.0.0.1:17322`，两者不同源；放行头由 bow 的 `cors` 插件注入（§0.3）。不靠反代，也不用给 hub 配 CORS。
- **`localhost` 是安全上下文**：PC 必须用 `http://localhost:17321` 打开，**不要**用 `http://<LAN-IP>:17321` 打开 UI，否则 OPFS / `crypto.subtle` 降级，统计库与词典索引会坏。
- Android 端不依赖 PC 的 `/api`（因为 Tauri 不注入 `/runtime-config.js`，`apiBaseUrl` 是构建期常量，见 §3.5）。需要用 `/api` 的功能（元数据搜索、翻译代理、TTS）在手机上要么构建期烧死 PC 的 IP，要么明确放弃。

---

## 2. 现状盘点（证据）

### 2.1 存储

| 内容 | PC(web) | Android(Tauri) | 证据 |
|---|---|---|---|
| 书库/设置/每本 config/书文件/封面/字体/词典 | **IndexedDB** 单库 `AppFileSystem`，object store `files`，keyPath `path` | 应用私有目录真文件（tauri-plugin-fs） | `src/services/webAppService.ts:37-60`；`src/services/nativeAppService.ts` |
| 阅读统计 `statistics.db`、每本书 `search.db`、词典插件索引 | **OPFS** 上的 turso WASM SQLite（**不是** IDB） | tauri-plugin-turso 原生 SQLite | `src/services/database/webDatabaseService.ts:29-35`、`src/services/statistics/statisticsDb.ts:61`、`src/services/librarySearchIndex.ts:11-12` |
| TTS 离线包 | OPFS（`opfsPackFs`） | 原生 | `src/services/tts/providers/opfsPackFs.ts:1-20` |
| 传输队列 | `localStorage['readest_transfer_queue']` | 同 | `src/services/transferManager.ts:13` |

结论：你说的"数据放 IndexedDB、书本放本地"**其实就是现状**（Android 的书本来就是真文件；PC 的书在 IDB）。这条**不需要任何改动**，只需要知道 IDB 里的书不可被外部工具直接读。

### 2.2 同步

| 通道 | 覆盖 | 证据 |
|---|---|---|
| Readest Cloud（replica CRDT，走 Supabase） | 书目/进度/笔记/设置/统计/书架/字体/词典/自定义 TTS 等 | `src/services/sync/replica*.ts`、`src/pages/api/sync.ts`、`src/pages/api/sync/replicas.ts` |
| **WebDAV file sync**（局域网可用的那条） | `Readest/{library.json, books/<hash>/{<title>.<ext>, cover.png, config.json, tts/*}}` | `src/services/sync/file/layout.ts:19-40`（注释标 **FROZEN wire layout**，只能追加） |
| **LocalSend** | 设备间点对点传书（不合并进度/笔记/设置） | `src/services/localsend/service.ts`、`src-tauri/src/localsend/`（`lib.rs:706-714` 注册 9 个 command） |

**file sync 的覆盖缺口（重要）**：上游只同步 书目 / 封面 / 书文件 / 每本 config / TTS 分节包。**不同步**：`SystemSettings` 白名单字段、书架定义、自定义字体/纹理、插件词典（含二进制）、OPDS/ABS 目录。
> 2026-10-14 那轮 fork 恰好补了其中三项（Phase 3.1 settings、3.2 字体/词典二进制、3.3 书架），**但那份代码不在本机**（见 §0 末）。

### 2.3 平台与构建

| 维度 | 现状 | 证据 |
|---|---|---|
| 平台枚举 | `tauri` / `web`（`NEXT_PUBLIC_APP_PLATFORM`） | `.env.web`、`.env.tauri`、`src/services/environment.ts` |
| Tauri 目标 | desktop(Win/mac/Linux/CEF) + Android + iOS，同一 `src-tauri` | `docs/code-layout.md`、`src-tauri/Cargo.toml:192-241`（桌面专属依赖都在 `cfg(...)` 里） |
| 桌面专属依赖 | `tauri-plugin-cli` / `single-instance` / `updater` / `window-state`（含 CEF） | `src-tauri/Cargo.toml:221-225` |
| web 构建产物 | `output: 'export'`（tauri）/ 默认 server / `'standalone'`（`BUILD_STANDALONE=true`） | `next.config.mjs:16-30` |
| PWA/ServiceWorker | 仅 `web` 且非 dev；`@serwist/next` 在 Turbopack 下不产出 `public/sw.js` | `next.config.mjs:180-182` |

### 2.4 云耦合面（裁剪时的删除规模）

| 集群 | 涉及文件数 |
|---|---|
| `supabase` | 105 |
| payment / IAP（`src/libs/payment`、google/apple iap-verify） | 39 / 37 |
| stripe | 29 |
| crosspoint | 14 |
| share（分享链接） | 12 |
| `/api` 路由总数 | 65（`src/app/api/*` 45 + `src/pages/api/*` 23） |

### 2.5 runtime 配置机制（LAN 档的关键抓手）

- `src/app/runtime-config.js/route.ts` 把服务端 env 打成 `window.__READEST_RUNTIME_CONFIG`；
- `src/services/runtimeConfig.ts:22-60` 读 `SUPABASE_PUBLIC_URL` / `API_BASE_URL` / `SELF_HOSTED` / `STORAGE_FIXED_QUOTA` …**运行期生效，不用重编**；
- `src/utils/access.ts:177-190` `isSelfHosted()` 只看 runtime config 或构建期 `NEXT_PUBLIC_SELF_HOSTED` / `SELF_HOSTED`；
- **Tauri 构建不注入 runtime-config**（`src/app/layout.tsx:126-145`：静态导出没有这个路由），所以 Android 端只能吃构建期 `NEXT_PUBLIC_*`。

---

## 3. 可行性判定

### 3.1 行

- **不要云、不要账号就能读书**：`keepLogin=false` 且无 user 时不跳 `/auth`（`src/app/library/page.tsx:733-744`），云同步关掉后书库/阅读/笔记全本地。
- **WebDAV 局域网同步**：已验证过一整轮（2026-10-14 Phase 0：伪造对端写远端 → PC 拉取 → 书目/进度/笔记/书文件四项都对上）。
- **跨源有现成解**：PC 用 bow 的 `cors` 插件（`/home/ruinb0w/Workspace/bow` commit `5b106a9`）覆盖 PROPFIND/MKCOL + `Authorization` 回显 + `Expose-Headers: *` + 预检改 200，不用反代也不用改服务端（§0.3）。
- **Android 走 `plugin-http`**（`src/services/sync/providers/webdav/client.ts:163`）→ 不经 WebView 的 CORS，也不受 Android cleartext 策略约束（Rust reqwest 侧）。
- **删桌面/iOS 目标**：桌面专属依赖都在 target `cfg` 下（`Cargo.toml:221-241`），Android 只额外需要 `libc`。

### 3.2 不行 / 有代价

| 诉求 | 判定 | 说明 |
|---|---|---|
| PC 纯浏览器 + 书落真实磁盘 | **不行** | 只能 IDB/OPFS，或 FSA API（要壳/要反复授权）。你已选择 IDB。 |
| 保留自有云同步但不跑 Supabase | **不行** | `/api/sync*` 是 Postgres/Supabase 语义。要么自建（大工程），要么不用。 |
| 手机端用 `/api` 功能而不重编 | **不行** | Tauri 没有 runtime-config，`apiBaseUrl` 是构建期常量。 |
| `http://<LAN-IP>:17321` 在 PC 浏览器打开 UI | **不要** | 非安全上下文 → OPFS / `crypto.subtle` 降级。 |
| PC 端用普通 Chrome 而非 bow | **会坏** | WebDAV 跨源失败；CORS 放行只发生在 bow 里（§0.3）。 |
| 局域网同步设置/书架/字体/词典 | **要写代码** | 上游 file sync 不覆盖（§2.2）；fork 里的实现不在本机。 |

---

## 4. 分阶段方案

### Phase 0 — 骨架（0 行代码，半天）

**已脚本化（`scripts/lan/` + root `package.json`），实测 ~2 分钟**：

```bash
pnpm lan:build    # BUILD_STANDALONE=true pnpm build-web + 先停服务 + 拷 .next/static/public 进 standalone
pnpm lan:start    # rclone WebDAV (0.0.0.0:17322) + Next standalone (0.0.0.0:17321)，带 LAN 档 env
pnpm lan:stop     # 按端口停（不用 pkill -f）
pnpm lan:status   # 端口 / 探活 / runtime-config 自检 / 同步根
pnpm lan:logs     # tail -f 两份日志
```

- 脚本在 **`scripts/lan/`**（`start.sh` / `stop.sh` / `status.sh` / `build.sh` / `lan-common.sh` / `lan.env.example`），入口挂在 root `package.json`
- 真实配置在 **`~/readest-lan/webdav.env`**（600、仓库外、含密码）；模板是 `scripts/lan/lan.env.example`，首次 `pnpm lan:start` 会自动生成一份随机密码的
- 手动等价步骤（脚本坏了时照抄）：
  1. 子模块/依赖：`git submodule update --init --depth 1 packages/{foliate-js,js-mdict,simplecc-wasm,qcms,tauri} apps/readest-app/src-tauri/plugins/{tauri-plugin-turso,tauri-plugin-webview-upgrade}` + `pnpm install --frozen-lockfile` + `pnpm --filter @readest/readest-app setup-vendors`
     - `packages/tauri` 是 vendored fork（root `Cargo.toml` 的 `[patch.crates-io]` 指向它）；`tauri-plugin-turso` / `webview-upgrade` 是 `lib.rs` 依赖的 submodule
  2. `cd apps/readest-app && BUILD_STANDALONE=true pnpm build-web`
  3. **拷静态资源（不拷会白屏）**：先 `rm -rf .next/standalone/apps/readest-app/{.next/static,public}`（避免二次构建套成 `static/static`），再 `cp -r`
  4. hub：`rclone serve webdav ~/readest-sync --addr 0.0.0.0:17322 --user readest --pass ***`（dufs 也行）
  5. **不需要反代**：bow 的 cors 插件处理 PC 端跨源（§0.3），手机端无 CORS 概念；hub 直接暴露在 :17322 上

### Phase 1 — 零代码「LAN 档」（0 行代码，半天）

启动脚本（示意；端口见 §0.2，Next 对外绑 0.0.0.0 以便手机可选接入）：
```bash
SELF_HOSTED=true \
API_BASE_URL=http://localhost:17321 \
SUPABASE_PUBLIC_URL=http://127.0.0.1:9/ \
SUPABASE_ANON_KEY=lan-dummy \
STORAGE_FIXED_QUOTA=0 \
PORT=17321 HOSTNAME=0.0.0.0 \
node .next/standalone/apps/readest-app/server.js
```
逐条理由（红线 2/3 的完整推导见 §0.1）：
- `SELF_HOSTED=true` → 解锁 WebDAV 行/自定义翻译器/自定义 TTS/TTS 离线缓存（`src/utils/access.ts:184-190`）。
- `API_BASE_URL=http://localhost:17321` → 抢在 `getBaseUrl()` 的兜底常量之前，让浏览器把 `/api` 发给自己，而不是 `web.readest.com`。
- `SUPABASE_PUBLIC_URL` + `SUPABASE_ANON_KEY` 都给**非空假值** → 抢在 `.env` 的 base64 默认值之前（`||` 链在空串上会穿透；`createClient` 要求 key 非空）。效果：冷启动那次 `refreshSession()` 打在 `127.0.0.1:9` 上立刻 `ECONNREFUSED` → `syncSession(null)` → 干净的无账号态。
- `HOSTNAME=0.0.0.0` + `PORT=17321` → 手机可选接入 `/api`；但 PC 自己务必用 `http://localhost:17321` 打开（安全上下文）。
- **验收**：DevTools Network 开 `Preserve log`，冷启动一次，过滤：
  - `readest.com` / `supabase.co` → **0 命中**
  - `posthog` → 0 命中（默认 opt-out，且 `advanced_disable_flags`+`disable_external_dependency_loading`，`src/context/PHContext.tsx:35-48`）
  - `fonts.googleapis.com` / `cdn.jsdelivr.net` / `storage.readest.com` → 取决于是否用到自定义字体/CJK 字体包（`fontBaseUrl`），要根治见 Phase 2 第 4 条

### Phase 2 — 必要的代码补丁（每处 1~20 行）

按"不做会出事"的程度排序：

1. **跳过无 Supabase 时的 auth 启动**（消除外联 + 控制台报错）
   - 位置：`src/context/AuthContext.tsx:62-75`（`refreshSession()` 无条件跑）、`src/utils/supabase.ts:5-30`（模块顶层 `new URL(supabaseUrl)`）
   - 改法：`isSelfHosted() && !getRuntimeConfig()?.supabaseUrl`（或显式 `LAN_ONLY` 开关）时不初始化 supabase client、不调 `refreshSession`。
2. **`keepLogin` 跳转守卫**（否则从 `/auth` 页面回不来、离线下被踢）
   - 位置：`src/app/library/page.tsx:741-744` `else if (settings.keepLogin) router.push('/auth')`
   - 改法：LAN 档下直接忽略（或 `keepLogin` 初始为 false）。
3. **PostHog 在 self-hosted 下不 init**（一行 guard）
   - 位置：`src/context/PHContext.tsx:24-33` 的 `initPostHog()`
4. **外链资源收口**（可选，看你是否用自定义字体/CJK 字体/词典插件源）
   - `fontBaseUrl`（`src/services/runtimeConfig.ts:55-60`）指到本地；WordLens/R2 词典源先关。
5. **（可选）把 WebDAV 塞进 Next 自己的路由**（`/api/dav`），彻底不要 dufs/rclone
   - 新 `src/app/dav/[...path]/route.ts` 实现 PROPFIND/GET/PUT/DELETE/MKCOL/HEAD + ETag/Range，落 `~/readest-sync`。
   - 好处：一个进程、天然同源、手机 URL 与 API 同端口。代价：WebDAV 细节（depth、ETag、编码）要写对，是本次唯一"新造轮子"的地方。

### Phase 2.5 — 精简四件事（用户指定：登录 / 第三方同步 / 语音读书 / 翻译）

**总原则：删服务与 UI，保留调用点的“壳”。** 这四块各自都有几十个调用点，直接改调用点是最贵、最易回归的做法；把被调方换成常量/空实现，调用点一行不动。

每砍完一件，跑 `pnpm lint && nohup setsid pnpm test:pr:web:unit`（基线全绿），再手验四条：开书 / 翻页 / 加笔记 / WebDAV 同步。**一次只砍一件，不要四件一起提。**

---

#### A. 登录 / 账号（删 ~30 文件 + 2 个 API 路由）

| 删什么 | 规模 / 位置 |
|---|---|
| Supabase 客户端 | `src/utils/supabase.ts`（改成 no-op 导出，见“壳”） |
| Auth 上下文内部 | `src/context/AuthContext.tsx`（内部换成静态值） |
| 登录/找回/回调页 | `src/app/auth/**`（9 个文件，含 `AuthPanel`/`EmailPasswordAuth`/`ProviderLogin`/`nativeAuth`） |
| 账号/订阅/存储页 | `src/app/user/**`（19 个文件，含 Plans/Billing/Checkout/Storage/LinkDevice 相关） |
| 用户 API | `src/pages/api/user/{delete,library}.ts` |
| 其他账号入口 | `src/libs/user.ts`、`src/app/link/*`（设备登录）、分享页里的登录引导 |

| 保留的“壳” | 为什么 |
|---|---|
| `useAuth()` 返回固定 `{ token: null, user: null, login: noop, logout: noop, refresh: noop }` | **48 个文件调它**（`grep -rl "useAuth\\b" src \| wc -l`）；壳不动，这 48 个文件一行不改 |
| `useQuotaStats()` 返回 self-hosted 常值（无限配额 / premium） | 多个 UI 风扇门用它；SELF_HOSTED 本已解锁，变成常量正好 |
| `library/page.tsx:733-744` 的 `initLogin` | 直接删掉（Phase 2 第 2 条此时已多余） |

连锁：26 个以 auth 命名的测试文件、`keepLogin` 变成死字段、PostHog 的 `identify(user.id)` 调用点（正好配合 §0.1 的 PostHog guard）。

---

#### B. 其他第三方同步 + KOSync + replica —— **✅ 2026-10-15 全部完成（4 刀 + 收尾，共 5 个提交）**

| 子步 | commit | 规模 |
|---|---|---|
| B-1 四个 provider（gdrive/onedrive/s3/icloud） | `37870bd4a` | 70 文件 / −8,806 |
| B-2 replica 引擎（壳化 20 个 store 调用点） | `5cba8a353` | 72 文件 / −12,137 |
| B-3 replica 客户端 + API 路由 + E2E 加密会话 | `d14631ef2` | 40 文件 / −6,883 |
| B-4 KOSync（只摘 KOReader provider，协议留给 BookOrbit） | `1a7f4db67` | 17 文件 / −774 |
| B-5 收尾：oauth 移动端流 + `app/auth/**` 残页 + `navigateToLogin` | `1a8b277f8` | 20 文件 / −1,375 |

**关键判断（写下来免得重踩）**：
- `providers/oauth/**` **不是**同步 provider，是共享 OAuth 工具箱（`tokenEndpoint` 13 个消费方、`persistedOAuth`/`keychainTokenStore` 被 ABS 用）⇒ 只删了平台流（oauthIos/Android/Desktop/oauthFlow/pkce/parseRedirect）。
- **replica 层在运行期早就是惰性死代码**（`publishReplicaUpsert` 开头 `if (!ctx) return`，而 `getReplicaSync()` 恒 null）⇒ 壳化成 no-op 不改变行为。
- `getReplicaPersistEnv()` 是**本地持久化的开关**（`if (env) saveCustomX(env)`）⇒ `replicaPersist` 必须原样保留。
- `migrateLegacyReplicas` 里**有真的本地迁移**（把老式扁平路径的字体/纹理重哈希成 bundle 布局）⇒ 只去掉 publish 步骤，迁移逻辑保留（曾误壳成 no-op 被字体测试抓出来）。
- `services/bookshelves/replica.ts` 是**本地** schema/合并逻辑（不是云）⇒ 先删后恢复。
- `useKOSync` 是**通用 provider 钩子**，BookOrbit 走同一套协议 ⇒ 只摘 KOReader provider，钩子/客户端/冲突面板保留。
- 新增 `services/sync/replicaKinds.ts`：kind 字符串 + 本地仍需要的 content-id 助手（dictionary/ABS/OPDS 身份）。

**遗留（归入“云残留”收尾，不在 [B] 内）**：`utils/supabase.ts`（仍被 `cloudService`/payment/share 引用 ⇒ 假值创可贴还在）、`cloudService.ts`（AppService 接口仍点名）、`libs/{user,storage,share*}`, payment libs, `pages/api/{storage,user}/*`、死掉的 `googleDrive/s3/onedrive/icloud` settings slice。

#### B 原计划（历史参考，已执行）

> **2026-10-15 完成“第一部分：四个 provider”（commit `37870bd4a`，70 文件 / −8,806 行）**
> - 删：`providers/{gdrive,onedrive,s3,icloud}`（24 文件）+ 4 个设置表单 + `app/{gdrive,onedrive}-callback` 路由
> - 改：`providerRegistry` 收窄到 `'webdav'`（缓存 seam 保留）、`runLibrarySync` 去掉 Drive-token/iCloud 门控、`cloudSyncProvider` 的 kind 列表与 `applySyncBooksAutoEnable` 收成单臂、`useFileSync` 同理、Integrations 面板只留 WebDAV 行
> - **`providers/oauth/**` 不删**：它是共享 OAuth 工具箱（`tokenEndpoint` 有 13 个消费方，Hardcover/Readwise/Notion 等都在用），不是同步 provider
> - 测试：多后端选择类套件（providerRegistry / cloudSyncProvider / fileSyncStore / useFileSync / runLibrarySync / fileSyncReport / settings/cloudSync）随特性删除；`syncCategories` 与 `useCloudSyncStatus` 里仅剩的 Drive 用例改写为 WebDAV 语义。**engine 套件（9 个 `engine-*.test.ts` + merge/wire/layout/provider-conformance）原封不动** —— 真风险在那里。全量：1101 文件 / 13216 用例 / 0 失败
> - **待做（第二部分）**：replica 机器本体（`replica*.ts` / `adapters/*` / `passphraseGate` / `migrateLegacy`，需给 ~20 个 store 的 `markDirty` 做壳）、KOSync（会碰 Reader 核心）、以及已死的 `googleDrive/s3/onedrive/icloud` settings slice（目前只是死字段 + `settingsSync`/`backupService` 里的死引用，无 UI 渲染）
> - 做完第一部分后 `[P7-c]`（file sync 过滤 demo 行）的改动面不变（那两处 demo 过滤在云路径 `useBooksSync` 里，属第二部分的 replica 清理）

| 删什么 | 规模 |
|---|---|
| `src/services/sync/providers/{gdrive,s3,onedrive,icloud,oauth}` | 12+1+9+2+9 = **33 个文件 / 约 4460 行** |
| 对应的设置表单 | `GoogleDriveForm` / `S3Form` / `OneDriveForm` / `ICloudForm` |
| `providerRegistry.ts` 的 `FileSyncBackendKind` 收窄到只剩 `'webdav'` | 其余四个分支删除 |
| `runLibrarySync.ts` 里 `hasValidWebDriveToken` / `isICloudSupportedPlatform` 两个 import | 都在删掉的那块里 |
| `SystemSettings` 的 `googleDrive` / `s3` / `onedrive` / `icloud` 四个 slice | 只有这两处读写，删字段不会崩（settings 存取不过滤未知 key） |

**顺带一件大招**：既然登录没了，**replica（Readest Cloud）同步永远跑不到**——`src/services/sync/` 里 `file/` + `providers/webdav` 共 3869 行是要留的，剩下约 **9317 行**（`replica*.ts` / `adapters/*` / `KOSyncClient` / `passphraseGate` / `migrateLegacy` / `syncCategories` …）是死代码。
> 但其中 `cloudSyncProvider.ts`（`getEnabledFileSyncBackends` / `isReadestCloudEnabled`）和 `syncCategories.ts` 是**胶水**，`runLibrarySync.ts` / `transferManager.ts` 还在用 → 要**瘦身**（去掉 `'readest'` 分支）而不是直删。

**KOSync（KOReader 进度同步）也要删（用户拍板）**：它还涉及 KOReader 自己的设置行与一个服务端代理。

| 删什么 | 位置 |
|---|---|
| 同步实现 | `src/services/sync/KOSyncClient.ts` |
| 服务端代理 | `src/pages/api/kosync.ts` |
| 设置 UI | `src/components/settings/integrations/KOSyncForm.tsx` + `IntegrationsPanel` 里的行 |
| 设置字段 | `src/types/settings.ts` 的 `kosync` slice（`serverUrl`/`userkey`/`checksumMethod`/`strategy`…） |
| reader 侧接入 | `useKOSync.ts`、`kosyncProgress.ts`、`KOSyncResolver.tsx`，以及**Reader 核心文件里的挂点**：`Reader.tsx` / `ReaderContent.tsx` / `FoliateViewer.tsx` / `sidebar/BookMenu.tsx` / `ViewMenu.tsx` / `useFileSync.ts` / `useNotebookDocumentCoordinator.ts` / `bookOrbitProgressProvider.ts`；还有 `src/store/readerStore.ts`、`src/services/settingsService.ts`、`src/services/constants.ts`、`src/utils/{customHeaders,network}.ts` |

> 这是四件事里**唯一会碰到 Reader 核心文件**的一件（其它三件都在外围），所以放在 B 里但**单独一个提交**、单独回滚。

验收：设置→集成列表里只剩 **WebDAV**（+ LocalSend，如保留）；把远端目录改成一个不存在的地址，确保只有 WebDAV 报错、没有帧回落到云端。

---

#### 云残留收尾 —— **✅ 2026-10-15 完成（6 个提交）**

| 子步 | commit | 规模 |
|---|---|---|
| 分享链接（`app/s/**`、`app/api/share/**`、`libs/share*`、`ShareBookDialog`、右键菜单 share） | `da7c75017` | 31 文件 / −2,677 |
| 云收件箱 Send to Readest + CrossPoint + stats archive + user API | `9188fb13c` | 44 文件 / −6,166 |
| 支付/配额的 API 与 libs + Supabase 依赖 + 假值创可贴 | `09450ce24` | 77 文件 / −8,893 |
| 四个死掉的 provider settings slice（gdrive/s3/onedrive/icloud） | `39d6ae4f9` | 9 文件 |
| Readest Cloud provider 本体 + 云传输队列（transferManager/transferStore/TransferQueuePanel）+ 每本书的上传/下载悬浮按钮 | `c205c6c3c` | 51 文件 / −5,690 |
| 云存储管道（`libs/storage` → `libs/downloadFile`、`cloudService` → `bookDeletion`、AppService 云方法） | `ed13d5972` | 30 文件 / −1,525 |

**关键判断（写下来免得重踩）**：
- **`services/send/{clipOptions,clipSignIn,conversion/**}` 不是云**：文章剪藏 / RSS feed book 在用它；`clipSignIn` 是「网站登录」（WebView cookie jar），不是 Readest 账号。只有 `sendAddress/inboxDrainer/devicePrefs` 与 `pages/api/send/**` 是云的。
- **`utils/share.ts` + QuoteCardDialog 的系统分享面板要留**（NSSharingServicePicker / Android intent），与 Readest 分享链接无关。
- **`libs/storage.downloadFile` 不是云**：它是通用 HTTP 下载器（OPDS 封面/自动下载、WordLens 词包、ABS 离线缓存都靠它带 URL 调用）。只有「无 URL 时用云 key 换签名 URL」那一支是云 ⇒ 保留下载器、删掉那支。
- **`services/transferManager` 只是云队列**：文件镜像有自己的 `fileSyncStore` 进度，所以整座队列可删（删前先确认 `Bookshelf` 的封面进度环只读 `booksTransferProgress`）。
- **`isLoggedIn`/`fetchWithAuth`/`getAccessToken`/`validateUserAndToken` 暂不删**：[C] TTS、[D] 翻译、Notion/AI 路由、OPDS 还在调用它们，随各自那一刀清。
- `AuthContext` 不再依赖 `@supabase/supabase-js` 的 `User` 类型（改为本地 `AuthUser` 结构）；`.env` 里 base64 烧的 Supabase/Stripe 公钥已删，`lan/start.sh` 的假值注射也不再需要。

**收尾数据**：本 pass 共 6 个提交、**242 文件 / −24,951 行**；套件从 1037 文件 / 12466 用例降到 **989 文件 / 11972 用例**（删掉的全是云行为断言），全程 0 失败、`tsc` 干净、web 构建与 200/207 每刀都验。

---

#### C. 语音读书 / TTS + 有声书 —— **✅ 2026-10-15 完成（一个提交）**

`c6cc79f69`：**654 文件 / +7,946 / −75,839 行**。实际规模是原估的 4 倍（`services/tts` 47 文件 13.6k 行 + `native-tts` 插件 285 文件 5.9k 行 + 16 个 TTS 组件 + 有声书/ABS 三棵树 + 135 个测试套件）。

**关键判断（写下来免得重踩）**：
- **TTS 与有声书共用 `TTSSessionManager`**，必须一刀切；两者方向上的依赖是 TTS→有声书 4 处、有声书→TTS 2 处，所以**先删 TTS 更干净**（我试过反向，会让 `TTSController` 需要外科手术式保留，白做）。
- **`services/opds/audiobook.ts`、`bookorbit/{openBookOrbitAudiobook,narration,mediaProxy,pairing,manifest,audiobookId,autoPair}` 是有声书的一半**；BookOrbit 的**电子书/进度/笔记同步**（`BookOrbitClient`/`notesPass`/`statsPush`/`bookmarkExchange`/`annotationExchange`）必须留 —— [B-4] 留下的 KOSync 协议就是为它。
- **段落模式与 RSVP 不是 TTS**：它们各自有"跟随朗读"的一半（`ttsSyncStatus`/`ttsActive`/`ttsRate` + 指示器 + 速率选择器）随 TTS 死，但**独立阅读功能要留**。RSVP 的 WPM 控件要从 `ttsDriven ? Audio pace : WPM` 的三元里恢复出来（我第一刀把 else 分支一起切掉了，测试抓出来了）。
- **`paragraphTts.ts` 里有两个不是 TTS 的东西**：`buildTtsHighlightCssText`（注释高亮也用）和 `wordHighlight` 的 `getTextSubRange`/`rangeTextExcludingInert`（段落克隆的选区映射用）⇒ 分别搬到 `paragraph/highlightCss.ts` 与 `paragraph/rangeText.ts`。
- **`TTSData.SILENCE_DATA`** 是字典 MDX 音频解锁用的静音 data URL（与 TTS 无关）⇒ 本地化到 `mdictProvider.ts`。
- **APK 构建注意**：`gen/android` 的生成物仍列着被删的 `tauri-plugin-native-tts`，下次构建前必须 `pnpm tauri android init --ci`（或删掉 `gen/android` 重生成）。

验收：`tsc` 干净、852 文件 / 10,052 用例 0 失败、web 构建与 200/207 通过。

**后续两刀（同日）**：
- `120379e1d` 音频死代码收尾（`libs/mediaSession`、`services/playback`、`utils/{ttsTime,ttsLyrics,ttsAutoplay}` + Android-Auto autoplay 路径、`RSVPController.estimatedWpmFromRate`、file-sync 的 TTS 包路径助手）：**17 文件 / −1,957 行**，套件降到 849 文件 / 10,009 用例。
- **APK 重建成功**（`[P4-1]` 第二次）：`~/readest-lan/dist/readest-lan-v0.12.16-no-tts.apk`（59.5MB，sha256 `96c258fc…`，`CN=Readest LAN`）。**踩到两个坑**：① R8 报 `Missing class javax.annotation.concurrent.GuardedBy` —— JSR-305 原本由 `native-tts` 插件带进来的 Google Cloud 库提供，删插件后就缺了；修法是在**被跟踪的** `app/build.gradle.kts` 里加 `compileOnly("com.google.code.findbugs:jsr305:3.0.2")`（`gen/android/app/**/*.pro` 每次 `android init` 都会被重写成模板，放那儿会丢）② `keystore.properties` 的路径是 **`src-tauri/gen/android/keystore.properties`**（`rootProject.file(...)`，不是 `app/` 下），`rm -rf gen/android` 后必须重建，否则产出的是 `-unsigned.apk`、装不上（模拟器上验到：装上了但签名 CN 缺失）。
- **模拟器实机验证**（api35）：升级安装后书库仍在（3 本镜像书），点开一本 WebDAV 镜像的书能下载并按上次位置打开，**阅读器工具栏不再有朗读按钮**。

#### C 原计划（历史参考，已执行）


用户拍板：**有声书一起删**（两者共用 `TTSSessionManager`，只删合成会留下半个引擎）。

| 删什么 | 规模 / 位置 |
|---|---|
| TTS 服务本体 | `src/services/tts/**` — **47 文件 / 13654 行** |
| Readest Voice / Edge TTS | `src/libs/readestVoice/`（4）、`src/libs/edgeTTS.ts`、`src/app/api/tts/**`（4 个路由） |
| 离线音频队列 | `src/store/ttsDownloadStore.ts`、`src/services/tts/providers/{sqliteCacheStore,bookCacheStore,opfsPackFs}` |
| Reader 朗读 UI | `src/app/reader/components/tts/**`、`src/app/reader/hooks/*tts*`、`paragraph`/`rsvp`/`footerbar` 里的入口 |
| 设置面板 | `src/components/settings/TTSPanel.tsx` + `tts` settings slice（含 `customTtsHighlightColors`） |
| file sync 里的 TTS 包同步 | `src/services/sync/file/ttsPackSync.ts` + `engine.ts` 的对应阶段 |
| 测试 | **84 个以 tts 命名的测试文件** |

**岔路已定（用户拍板）：有声书也一起删** —— 不再需要保留 `TTSSessionManager` / `mediaOverlay` / `NativeAudioPlayer`；`src/services/audiobook`（11 文件/1979 行）一并删。

有声书这一刀的**附加范围**：

| 删什么 | 位置 / 规模 |
|---|---|
| 有声书服务 | `src/services/audiobook/**`（11 文件/1979 行）、`src/services/audiobookshelf/**`（7 文件） |
| 播放器页面 | `src/app/player/**`、`src/store/absServerStore.ts`、`src/store/feedStore.ts`（podcast 订阅） |
| ABS 集成 | `components/settings/integrations/ABSForm.tsx`、`services/sync/adapters/absServer.ts` |
| 有声书判定工具 | `src/utils/audiobook.ts`（**32 个文件在 import**，但绝大多数只调 `isAudiobook()` 做分支；删掉后这些分支直接消失） |
| BookOrbit 有声书部分 | `openBookOrbitAudiobook.ts` / `narration.ts` / `audiobookId.ts` / `autoPair.ts` / `mediaProxy.ts` |
| 文档 | `docs/read-along-narration.md`（321 行） |

**顺带变成死代码（建议后续再清，不必第一刀就动）**：RSS/podcast feed 自动下载（`src/services/rss` 866 行）、`src/services/transferManager.ts` 里的有声书分支。

交叉引用（删 TTS 后必须一起收尾的 5 处）：
- `src/services/statistics/ttsStatsRecorder.ts`（听书时长统计）
- `src/services/dictionaries/providers/mdictProvider.ts`（只用到 `SILENCE_DATA` 一个常量，搬走即可）
- `src/services/opds/openOpdsAudiobook.ts`、`src/services/bookorbit/openBookOrbitAudiobook.ts`、`bookorbit/narration.ts`
- `src-tauri/tauri.conf.json` CSP 里的 `edge.microsoft.com` / `api.msedgeservices.com` 可一并清掉

---

#### D. 翻译 —— **✅ 2026-10-15 完成（一个提交）**

`19acfb5dd`：**96 文件 / +19 / −11,520 行**（原估 18 文件 / 2.2k 行，实际 5 倍 —— `services/translators` 只有 2.2k，但 `useTextTranslation` 584 行、`LangPanel` 的翻译设置占了一半（622→252 行）、`utils/style` 的注入 CSS、`CustomTranslators` 两个组件、以及 20 个测试套件）。

**关键判断**：
- **Word Lens / 段落模式 / 简繁转换 / 证明规则不是翻译**：`LangPanel` 里只有 "Translation" + "Translated Text" 两个 BoxedList 是翻译的，`convertChineseVariant`（简繁）与 `replaceQuotationMarks` 要留；`getTranslationStyles`（`.translation-*` 选择器类）删除后 `applyTranslationStyle` 也成了死函数。
- **`ttsReadAloudText` 藏在 `TranslatorConfig` 里**（"朗读原文/译文/两者"），它是 TTS 设置，随 [C] 一起没了。
- **AI 上下文词典依赖自定义翻译器**：`services/dictionaries/{contextDictionary,contextProvider}` + 字典弹层的 `selection` 上下文透传随之删除（`DictionarySelectionContext` 类型一并去掉）。
- **`utils/usage.ts` 只被 deepl 路由使用** ⇒ 随 [D] 删除（[C] 时它已变成 no-op）。
- **标注工具条的 `tts` 动作**也是死代码（派发没人监听的 `tts-speak`）⇒ 同批删掉，`AnnotationToolType` 联合类型收窄。

验收：`tsc` 干净、831 文件 / 9,695 用例 0 失败、web 构建与 200/207 通过。

#### D 原计划（历史参考，已执行）


| 删什么 | 规模 / 位置 |
|---|---|
| 翻译 provider 抽象 | `src/services/translators/**` — 18 文件 / 2218 行（`deepl` / `google` / `azure` / `yandex` / `openaiCompatible` / `prompts`） |
| Hook / UI | `src/hooks/useTranslator.ts`、`src/app/reader/hooks/useTextTranslation.ts`、`annotator/TranslatorPopup.tsx`、`TranslationToggler.tsx`、`utils/translationMarkup.ts` |
| 自定义翻译器 | `src/components/settings/CustomTranslator{Editor,s}.tsx`、`src/store/customTranslatorStore.ts`、`src/types/translation.ts`、`src/services/sync/adapters/customTranslator.ts` |
| 服务端代理 | `src/app/api/{azure-translate,yandex-translate}/route.ts`、`src/pages/api/deepl/translate.ts` |
| 设置字段 | `translationProvider` / `translateTargetLang`（`LangPanel.tsx` 及其他设置 UI 里的翻译区） |

**连锁（必须一起处理）**：`src/services/dictionaries/contextDictionary.ts` 引用了 translators —— 词典的“上下文释义/翻译”分支要一并拆掉（或改成直读本地词典）。删完后 `useTextTranslation` 的调用点（reader 选中文后的弹单）也会消失。

> 注意：`src/hooks/useTranslation.ts` 是 **i18n** 的 `_()` 助手，**不要删**（名字很像）。

---

### Phase 2.5-A — 删登录（2026-10-15，commit `f232266de`，58 文件 / −7,541 行）
- [x] **[A-1]** `useAuth()` 换成永久登出 + 全 no-op 的 stub（`AuthContext.tsx` 重写：去 Supabase / 去 `refreshSession` 挂载调用 / 去 posthog.identify）；48 个调用点一行未改
- [~] **[A-2]** `useQuotaStats()` **未改**：它依赖 token，token 恒为 null ⇒ 自然回到默认档；而付费门控已由 `SELF_HOSTED` 解锁（`isCustomizationAllowed` 返回 true）⇒ 无需 stub。暂留
- [~] **[A-3]** 已删 `src/app/auth/{page,callback,recovery,update,error,components}`、`src/app/user/**`、`src/app/link/**`（CrossPoint 设备登录）、`src/helpers/auth.ts`、`src/hooks/useUserActions.ts`；**`src/utils/supabase.ts` / `src/libs/user.ts` 暂留**（前者还被 `libs/payment/*`、`libs/shareServer.ts`、`api/*` 路由引用 ⇒ 随云/支付那批一起删）。顺带：`utils/access.ts` 的 `getAccessToken`/`getUserID`/`validateUserAndToken` 去 supabase 化（后者返回空 ⇒ 所有 API 路由把调用者当匿名）
- [ ] **[A-4]** 随 A 走的 Android 侧：`start_server`（oauth 回环）、`BillingManager.kt`×2、`OAuthCallbackTarget.kt` —— **待做**（跟删 oauth provider / native-tts 一起，省一次 APK 构建）；`macos/{safari_auth,apple_auth}.rs` 归入最后的 Rust 减肥
- [~] **[A-5]** 创可贴：`keepLogin` 守卫已删（`initLogin` 整段移除）✅；**假 Supabase 值暂留**（理由同 [A-3]，否则 `createClient` 会拿 `.env` 里烧的公有 URL）；PostHog 的 self-hosted guard 保留
- [x] **[A-6]** 验：`tsc` 干净；**全量单测 1133 文件 / 13490 用例 / 0 失败**；`lan:build` 成功、`/` 200 + PROPFIND 207；删了 9 个断言旧登录行为的用例 + 3 个 iOS 用例（读已删的 `gen/apple`）
- [ ] **[A-7]** 可视核对（用户或下轮）：设置菜单里无 “Sign In”、空书库无 “Sign in to sync your library”、冷启动 Network 无 supabase 域名（bow 当时占用，未打扰）
- ℹ️ 残留：`navigateToLogin` 仍有 4 处调用（`LocalSend` 接收对话框 / `TTSPanel` / `LangPanel` / `SendToReadestForm`），但都在“需要账号才有意义”的分支里，且 LAN 档下 `isCustomizedAllowed` 恒 true 走不到；它们随 [C]/[D]/[B] 各自消失

#### 不建议顺手删的（不在你这次要求里）

词典（`src/services/dictionaries` 8160 行）、OPDS（2301）、ABS、BookOrbit（2478）、AI 聊天（2302）、笔记/批注、Reader 本体。它们不阻碍“只有局域网”这个目标，删了只是多风险。

#### 四件事做完后的收益

- 外网面：只剩 WebDAV 一个外部 API（且指向自己的 LAN），其余云厂商/计费/遥测入口全无
- **可以撕掉的“创可贴”**（只在 A 完成后）：`SUPABASE_PUBLIC_URL` / `SUPABASE_ANON_KEY` 假值、`keepLogin` 守卫（`library/page.tsx:733-744`）、PostHog 的 `identify(user.id)` 与 init guard —— 因为 supabase 客户端和 AuthContext 都不存在了
- 可删依赖：`@supabase/*`、`stripe`+`@stripe/*`、`@googleapis/androidpublisher`、`app-store-server-api`、`google-auth-library`、`posthog-js`、`@aws-sdk/*`（S3 provider 走后）
- 代码量：上述四块 + replica 合计约 **~32k 行**（占 `src/` 58 万行的 ~5.5%，但都是最脏的集成层）

---

### Phase 3.0 — 语言栈清理（排进执行顺序）

> 盘点与行数明细见 §7。分三个子批：**3.0a 零风险平台清理**（先做）、**3.0b 需要你判断的一批**（最后做）、**3.0c 与 A/C 耦合的**（不单独做）。

#### 3.0a — 零风险平台清理（放在四件事**之前**）

> **第二批（Apple / CEF / 桌面 Rust）的两个重要修正（2026-10-15 实地核实）**
>
> 1. **`sharekit` / `sign-in-with-apple` 不能在这里删**：`lib.rs:730` 的 `tauri_plugin_sharekit::init()` 是**无条件注册**的，npm 侧 `@choochmeque/tauri-plugin-sharekit-api` 被 `nativeAppService` 的 `shareFile`（分享/导出文件）在用——**Android 也在用**。⇒ 归属改为：`sign-in-with-apple` 跟 **Phase 2.5-A（删登录）** 走，`sharekit` 跟 **Phase 3.0b（分享功能取舍）** 走。
> 2. **macOS 专属代码在这台机器上根本没法验证**：`src/macos/**` 的 22 处引用全部在 `#[cfg(target_os = "macos")]` 里，`cargo check --target aarch64-linux-android` 和指宿主的 `cargo check` 都**不会编译它**；要编译它需要 macOS SDK（本机没有）。⇒ 删 macOS 模块只能靠“肉眼看”，而它对两个目标平台**零收益**（除仓库体积）。
>
> **因此第二批的打法**：CEF + 桌面 Rust + macOS 模块 + `packages/swift-rs`/patch **一次性删完**，只跑一次门（两个）：
> `cargo metadata --filter-platform aarch64-linux-android`（验 manifest/patch 解析）+ `pnpm tauri android build -t aarch64`（真验，10–40 min，顺便就是 Phase 4 的 APK）。
> ⚠️ 跑 Android 构建前**必须先 `pnpm lan:stop`**（它会重写 `.next/`，与运行中的 standalone 撞车），完了再 `pnpm lan:build` + `lan:start` 恢复。

**为什么放最前（在 A/B/C/D 之前）：**
1. 纯删除，目标是**不可达代码**（Apple / 桌面 / 其他生态），运行时零影响
2. 立刻缩小仓库与依赖图，后面每一刀的 diff 都更干净（尤其先干掉 swift-rs 那个 `[patch.crates-io]`）
3. 借它把「`cargo check --target aarch64-linux-android` + 一次 APK 构建」这条验证链路跑熟——这是后面 A/C 删 Rust 代码的**必备手段**

| 删什么 | 位置 |
|---|---|
| Apple 整片 | `src-tauri/gen/apple/**`（iOS 壳/Widget/ShareExtension/CarPlay/`SentryBootstrap.m`/xcodeproj）、两个插件的 `ios/`、`Info-ios.plist`、`fastlane/`、`tauri.macos-*.conf.json` |
| Apple 构建链 | `packages/swift-rs` + root `Cargo.toml` 的 `[patch.crates-io] swift-rs` + `src-tauri/Cargo.toml` 的 `[target.'cfg(target_os="macos")']` 块 |
| Apple 插件 | `tauri-plugin-sign-in-with-apple`、`tauri-plugin-sharekit`、npm 的 `@choochmeque/tauri-plugin-sharekit-api` |
| KOReader 插件 | `apps/readest.koplugin/**`（70 Lua + 它自带的 Rust crate `native/localsend-bin`）+ 脚本 `test:lua` / `lint:lua` |
| Calibre 插件 | `apps/readest-calibre-plugin/**`（16 py） |
| CrossPoint 插件 | `apps/readest-crosspoint-plugin/**` |
| Cloudflare Worker | `apps/readest-app/workers/{iap-reconcile,send-email}/` + `pnpm-workspace.yaml` 里那两行 |
| CEF | `packages/tauri-runtime-cef-stub` + `cef` feature + `.cargo/cef.toml` + `Cargo.cef.lock` + `try-appimage.yml` |
| 桌面 Rust | `src-tauri/src/{nightly_update.rs, discord_rpc.rs, spawn_fresh_browser.rs, window_state.rs, browser_cookies_macos.rs, linux_display.rs, linux_single_instance.rs, file_reveal.rs}` + `src/macos/**` + native-bridge 的 `src/platform/{windows,macos,linux_cef,cdp}.rs` |
| CI 卫生 | `.github/workflows/{pull-request,release,nightly,codeql}.yml` 里 koplugin / calibre / macOS 相关 job（`pull-request.yml` 的 `koplugin_rust_lint`、release 的 koplugin zip + `build-calibre-plugin` + macOS 矩阵） |

**验收：**
1. `cargo check -p Readest --target aarch64-linux-android`（比整包构建快得多）
2. `pnpm --filter @readest/readest-app lint`（tsc + biome）
3. 一次 `pnpm tauri android build -t aarch64` + 装机打开一本书
4. `git grep` 确认无残留 import；`pnpm test:pr:web:unit` 全绿基线

> **成本提醒**：每次动 `Cargo.toml`/依赖图都要重编一次 APK（~10 min），而且**改 `ANDROID_HOME` 会让 cargo 缓存失效**（上次踩过）。所以 3.0a 尽量一次把同一批 Rust 模块删完，不要分五次提交。

#### 3.0b — 需要你判断的一批（放最后）

| 项 | 行数 / 规模 | 不删的代价 |
|---|---|---|
| 内置浏览器 + 网页剪藏 | `web_browser.rs`(887) + `clip_url.rs`(810) + `browser_fetch.rs`(542) + `media_proxy.rs`(637) = **2876 行** + `@mozilla/readability`/`dompurify` 等依赖 + native-bridge 的 `WebBrowserController` | 留着不影响局域网目标，只是多一块要维护的代码 |
| LocalSend（设备间传书） | Rust `localsend/` + 11 个命令 + `src/services/localsend`(561) + `LocalSendForm` | 它也是局域网功能，但你之前**只选了 WebDAV**；留着无害 |
| 崩溃上报 | `sentry_config.rs`(381) + `tauri-plugin-sentry` + `@sentry/*` | 不删就还是“会出网”（需要把 DSN 置空） |
| 墨水屏 | `eink_identity.rs`(144) + `android/eink.rs` + `EinkRefreshController.kt` | 没墨水屏设备就没用 |
| 三个可选 submodule | `packages/{qcms,js-mdict,simplecc-wasm}` | 分别对应 PDF 色彩 / MDict 词典 / 简繁转换；删哪个就要删对应功能 |

#### 3.0c — 跟 A/C 一起做，不单独提交

- `plugins/tauri-plugin-native-tts/**`（整个 crate，含 Kotlin/Swift）→ 随 **C**
- `start_server`（`tauri_plugin_oauth::start`）、native-bridge 的 `BillingManager.kt`（foss/googleplay 两个 flavor）、`OAuthCallbackTarget.kt`、`macos/safari_auth.rs` + `macos/apple_auth.rs` → 随 **A**
- `tauri-plugin-turso`、`range_file.rs`、格式解析器、native-bridge 的 Android 部分 → **永远不动**

#### 更新后的完整顺序

```
Phase 0  骨架
Phase 1  LAN 档 + 外联归零验收
Phase 2  补丁（auth 启动 / keepLogin / PostHog / demo 书 / 遥测默认）
Phase 3.0a  语言栈清理（Swift/Apple、Lua、Python、Worker、CEF、桌面 Rust）
Phase 2.5-A  删登录            ← 可撕掉 Phase 2 的“创可贴”
Phase 2.5-B  删第三方同步 + KOSync + replica
Phase 2.5-C  删 TTS + 有声书    ← 顺带删 native-tts 整个 crate
Phase 2.5-D  删翻译
Phase 3.0b  判断批（网页剪藏 / LocalSend / 遥测 / 墨水屏 / 三个 submodule）
Phase 3     其余裁剪（可选）· Phase 3.5 同步覆盖扩展（可选）
Phase 6  包管理器 pnpm → bun（可选，**Phase 3 之后**；评估与验收清单见 §8）
Phase 7  demo 幽灵行 / URL 式 demo 判定修复（**排在最后**；根因与方案见 §9）
Phase 4  Android 真机验收
```

> Phase 6 与 Phase 2.5/3 无依赖关系，但**故意排在它们之后**：那几刀会改 `package.json`/删目录/改 CI，换包管理器要重验的是它们的果，先清理后迁移能减少一轮验证。在那之前日常用 `bun run lan:*` 即可。

---

### Phase 3 — 裁剪（可选，按 ROI 排序；不建议第一天做）

顺序（前面的收益/风险比最好）：
1. **删同意/支付/云存储入口**：`src/libs/payment`(39)、`src/app/api/{stripe,google,apple,crosspoint}/*`、`src/pages/api/storage/*`、`src/app/api/share/*`、`src/services/send/*`、`shareServer/share.ts`。→ 去掉外联与一堆依赖（`stripe`、`@stripe/*`、`google-auth-library`、`@aws-sdk/*`）。
2. **删非目标平台的构建面**：`src-tauri` 的 desktop/CEF/iOS 配置、`tauri.{macos,windows}*.conf.json`、`packages/tauri-runtime-cef-stub`、fastlane、`apps/readest-{calibre,crosspoint}.plugin`、`readest.koplugin`、`extensions/send-to-readest`。
   - 注意：`[patch.crates-io] tauri = { path = "packages/tauri/..." }` 是 vendored fork，**Android 构建仍依赖它**——想换回 crates.io tauri 是独立工程（先不动）。
3. **删其他第三方集成**：Hardcover(15)/Notion/Readwise/Pagebound/BookOrbit、AI(`src/services/ai` 2302 行 + `src/app/api/ai/*`)、KOReader sync、CrossPoint。
4. **收窄 file sync provider**：`providerRegistry.ts` 只留 `webdav`，删 gdrive/s3/onedrive/icloud provider 与其 settings UI。
5. **补 file sync 的覆盖**（= 重做 fork 的 Phase 3.1–3.3）：settings 白名单 / 书架 / 字体 / 词典。若先找回旧 checkout，这几项能省一大半工作量。

风险提示：裁剪同时要动测试与 import 图。本仓库测试基线目前是**全绿**（memory 2026-10-15：13701 用例通过、零失败），所以每阶段跑 `nohup setsid pnpm test:pr:web:unit` 就能看住回归。

### Phase 4 — Android（配方已按 2026-10-15 实测修正）

**首次构建前必须做的三件（本 clone 缺东西，之前配方没写全）**：

```bash
# 0) PATH 里必须有 gradle —— 本机没有，用缓存里的 wrapper 发行版：
ln -sf ~/.gradle/wrapper/dists/gradle-8.14.3-bin/*/gradle-8.14.3/bin/gradle ~/.local/bin/gradle
#    （版本必须与 src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties 一致：8.14.3）

# 1) gen/android 的 Gradle 脚手架（settings.gradle / build.gradle.kts / gradlew…）都在 .gitignore 里，
#    fresh clone 完全没有 → 必须先 init，否则构建最后一步报
#    “Directory '…/gen/android' does not contain a Gradle build”
cd apps/readest-app
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=$HOME/android-sdk \
  pnpm tauri android init --ci

# 2) 图标资源（ic_launcher*、values/ic_launcher_background.xml）由 tauri icon 生成且**未被跟踪**；
#    再 `git checkout -- .` 把被 init/icon 覆盖的跟踪文件（MainActivity.kt / AndroidManifest.xml /
#    app/build.gradle.kts / themes.xml / ic_launcher.xml / KeyLearnCaptureTest.kt）恢复
pnpm tauri icon ../../data/icons/readest-book.png
cd ../.. && git checkout -- .

# 3) 签名（gradle 读 rootProject.file("keystore.properties")，文件本身被 gitignore）
#    keystore：~/readest-lan/android/readest-lan.jks，keystore.properties 写 keyAlias/password/storeFile

# 构建（.env.local 里要有 NEXT_PUBLIC_SELF_HOSTED=true；注意 dotenv -e .env.tauri 不含它，是 Next 自己读 .env.local）
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=$HOME/android-sdk ANDROID_SDK_ROOT=$HOME/android-sdk \
  pnpm tauri android build -t aarch64
# 产物：src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

**两条坑（实测踩到）**：
- ⚠️ **构建前必须 `pnpm lan:stop`**：`beforeBuildCommand` 会跑 `next build` + `upload-sourcemaps`，会重写 `.next/`，与运行中的 standalone 撞车（完了要 `pnpm lan:build` + `lan:start`）。
- `tauri-plugin-*` 的压缩：前端资源被 tauri 的 `compression` 特性 brotli 压缩进 `.so`，**没法在 APK 里 grep 字符串**；要验内联就看 `out/_next/static/chunks/*.js`（构建后、嵌入前）。
- `upload-sourcemaps.mjs` 在无 `SENTRY_AUTH_TOKEN` 时是 no-op（不会卡构建）；`apksigner verify --print-certs` 验签名（`keytool -printcert -jarfile` 对 v2/v3 签名会误报 “Not a signed jar file”）。

```bash
# 构建期开关写 .env.local（gitignored），不要改被 git 跟踪的 .env.tauri
echo 'NEXT_PUBLIC_SELF_HOSTED=true' >> apps/readest-app/.env.local
# 若手机要用 PC 的 /api（元数据搜索/翻译/TTS），需要把 PC 的地址烧进构建：
#   NEXT_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:17321
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=$HOME/android-sdk \
  pnpm tauri android build -t aarch64
```
上次踩过、必须照抄的四步：`rm -rf gen/android` 后必须 `init` → `pnpm tauri icon` → `git checkout -- .`（顺序不能反）；`/opt/android-sdk` 不可写要自建 SDK symlink 农场；改 `ANDROID_HOME` 会失效 cargo 缓存。

**待真机确认的三件（本次没验）**：
- WebDAV 走 `http://<PC-IP>:17322` 时，Android 的 cleartext 策略是否真的被 `plugin-http`(Rust) 绕过（清单里没有 `usesCleartextTraffic`，`src-tauri/gen/android/app/src/main/AndroidManifest.xml:3` 只有 INTERNET 权限）。若被拦，加 network-security-config 即可。
- 手机端 WebDAV 服务器地址填 PC 的 LAN IP（不是 `adb reverse` 的 5302，那是会话级隧道）。
- APK 里 premium 是否解锁：上次是 grep bundle 里 `SELF_HOSTED` 被内联成 `"true"` 来静态验证。

### Phase 5 — 验证矩阵

| 场景 | 期望 |
|---|---|
| PC 冷启动（无账号） | 书库正常、无 `/auth` 跳转、Network 里 0 个外网域名 |
| PC 改进度/加笔记 → 手动 sync | 远端 `Readest/books/<hash>/config.json` 更新、对端笔记保留 |
| **对端伪造写入**（页面内 `fetch` + Basic 直接 PUT 到 WebDAV，**同一个 eval 里立刻触发同步**） | 书目磁贴/进度环/笔记都对上（分两步会被 PC 自己的后台同步无条件 PUT 覆盖——上次真机撞到过） |
| 手机收书 | 打开书时从 LAN 拉书文件并落本地 |
| 断网（拔网线） | 阅读/笔记/设置全可用，只是不同步 |
| 局域网大书（>100MB PDF） | 传输有进度、可续传，无内存爆掉 |

---

## 4.9 剩余工作清单（2026-10-16 盘点，含建议执行顺序）

### A. 死代码 / 依赖收尾 —— 零风险，半天
- `utils/access.ts` 里 **9 个已无消费者的导出**（TTS/翻译的配额与门控）：`isTTSInPlan`/`isVoiceTierInPlan`/`getTTSQuota`/`isCustomTranslatorAllowed`/`isCustomTTSAllowed`/`getTranslationQuota`/`getDailyTranslationPlanData`/`TTS_CACHE_PLANS`/`TTS_PLANS`（`getAccessToken`/`getUserID`/`validateUserAndToken` 仍有消费者，留）。
- `types/quota.ts` 的 `UserDailyTTSQuota`/`UserDailyTranslationQuota`、`services/constants.ts` 的 `DEFAULT_DAILY_{TTS,TRANSLATION}_QUOTA`、`DEFAULT_STORAGE_QUOTA`、`runtimeConfig` 的 `storageFixedQuota`/`translationFixedQuota`（配额已经没有任何 UI/路由在算）。
- `types/payment.ts` **全文孤儿**（0 消费者）⇒ 连同 `@stripe/react-stripe-js`/`@stripe/stripe-js`/`stripe`/`@googleapis/androidpublisher` 依赖一起删。
- ✅ 已清：删掉的 `native-tts` 插件留下的 **4.9MB 陈旧 `.tauri/`+`build/` 残留**（被 gitignore，`git status` 看不见，只有 `git clean -ndX` 才列出来 —— 删插件时容易漏）。
- 可选：`public/locales`（6.7MB / 35 语言）里已删功能的 i18n 键；要动就得写脚本校验剩余 key 集合，风险低但收益也低。

### B. Rust 减肥 + CI 卫生 + 一次 APK —— 一天
- CEF：`cef` feature、`.cargo/cef.toml`、`packages/tauri-runtime-cef-stub`、`try-appimage.yml`。
- 桌面专属：`nightly_update.rs`(226) `discord_rpc.rs`(182) `browser_cookies_macos.rs`(116) `file_reveal.rs`(36) `linux_display.rs`(39) `linux_single_instance.rs`、`src/macos/**`(1811 行)、native-bridge `platform/{windows,macos,linux_cef,cdp}.rs`。
- Android 侧 [A-4]：`start_server`(oauth 回环)、`BillingManager.kt`×2、`OAuthCallbackTarget.kt`。
- ⚠️ `src/macos/**` 被 `#[cfg(desktop)]` 的入口代码调用，删它必须连桌面入口一起删；每刀之后都要重建 APK（~20 分钟/次，所以攒一次做）。
- CI [P3a-8]：5 个 workflow 仍提到已删的东西（`koplugin`/`calibre`/`macOS`/`apple`/`lua`）。

### C. 待拍板的五件（需要用户 yes/no；它们决定 B 的范围）
1. 网页剪藏 —— **要拆成两半，砍法不同**（2026-10-16 查证）：
   - **内置浏览器**（可砍）：`web_browser.rs`(887) + `browser_fetch.rs`(542) + `services/webBrowser`(240) + `useWebBrowserDownloads.ts`(110) + `WebSourcesDialog.tsx` ≈ **1.8k 行**。唯一入口是书库 Import → "Web Sources"（Tauri-only），用来浏览/登录付费站点后导入书或下载文件；砍掉只失去"应用内浏览取书"。
   - **`clip_url.rs`(810) 必须留**：它是"任意 URL → 可读正文"的引擎，调用方是 **RSS 抓文章**（`services/rss/articleIngest.ts`）、**系统分享「Send to Readest」**（`app/send/page.tsx` + `useClipUrlIngress.ts`）、**网文导入**（`ImportNovelDialog`）、以及 `services/send/conversion/**`（本地 EPUB 转换管线）。**这些都不是剪藏，是保留功能。**
   - ⚠️ **`media_proxy.rs`(637) 不是剪藏** —— 它是**已删的 Audiobookshelf 残留**（把 ABS 曲目流给 `<audio>`，唯一消费者是随 [C] 删掉的 ABS 播放器；前端 0 引用）⇒ 归入 A，直接删。
2. LocalSend：Rust `localsend/`(2221) + `services/localsend` + `LocalSendForm`。**与 LAN 主题高度契合，建议留**。
3. 遥测：`sentry_config.rs` + `tauri-plugin-sentry` + `@sentry/cli` ⇒ 要么删，要么保持"DSN 未配置即 no-op"（现在就是后者：DSN 走 manifestPlaceholder→env）。
4. 墨水屏：`eink_identity.rs`(144) + `android/eink.rs` + `EinkRefreshController.kt` —— **✅ 用户 2026-10-16 拍板：删**。
5. 三个 submodule（**查证后建议全留**）：
   - `packages/qcms` = **PDF 渲染的 ICC 色彩管理**（`qcms` 的 wasm 封装 `qcms_pdf_js`，产物 `public/vendor/pdfjs/qcms_bg.wasm`，由 vendored 的 `pdf.worker.min.mjs` 加载）⇒ 删它等于放弃 PDF 色彩正确性，还要改 vendored pdf.js。
   - `packages/js-mdict` = **MDX/MDD 词典解析**（`services/dictionaries/dictionaryService.ts` → `mdictProvider`）⇒ 删它等于放弃 MDX 词典格式。
   - `packages/simplecc-wasm` = **简繁转换（OpenCC）**（`utils/simplecc.ts`）⇒ [D] 时已确认"简繁转换不是翻译，要留"，它就是那个功能的实现。
   （仓库共 8 个 submodule，`foliate-js`/`tauri`/两个 tauri-plugin/`gstack` 不在候选内。）

### D. 验证缺口（需要真机或用户）
- [P0-5] Windows 防火墙 —— 真机走 WiFi 才作数。
- [P4-4] 手机开书下载 —— **2026-10-15 模拟器已验到**（升级安装 → 点开镜像书 → 下载并回到上次位置），建议真机复验一次后勾掉。
- [P4-5] `start.sh` 加看门狗（两个进程静默死过一次）。
- [P5-1] Phase 5 验证矩阵。
- [A-7]/[P1-4] 可视核对：设置面板无 TTS/翻译/账号（本轮只验到"阅读器工具栏无朗读按钮"）；冷启动无外部域名。
- mac 键盘/剪贴板（无真机，长期挂）。

### E. 可选扩展
- [P3.5-1] file sync 覆盖扩展（settings/书架/字体/词典）。
- [P2-5] WebDAV 做进 Next 路由；[P2-4] 外链资源收口（`fontBaseUrl`/WordLens/R2 词典源）。
- [P7-1] demo 幽灵行 —— **唯一用户可见的 bug，今天截图里又复现了**（手机书库两张《指数基金投资指南》）。
- [Phase 6] pnpm → bun。

### 建议执行顺序（理由）
1. **[P7-1] demo 幽灵行** —— 唯一用户可见 bug，已复现，改动小。
2. **A 死代码 / 依赖收尾** —— 零风险，做完"代码里再也找不到 TTS/翻译/云"才算闭环。
3. **C 五个拍板** —— 决定 B 的边界（先答再动手，避免白删/白留）。
4. **B Rust 减肥 + CI + 一次 APK** —— 攒一次构建把语言栈收干净。
5. **D 真机验证** —— 防火墙/矩阵/看门狗/可视核对。
6. **E 可选扩展** —— P3.5、bun、P2-4/P2-5。

## 5. 风险表

| 风险 | 影响 | 缓解 |
|---|---|---|
| 生产构建打 `web.readest.com/api` / readest Supabase | 不满足"只局域网" | Phase 1 env + Phase 2 补丁 1/3，Phase 1 就有 Network 验收（推导见 §0.1） |
| 端口撞上本机其他项目 | 起不来/串台 | 用 §0.2 的 1732x 段；启动前 `ss -ltnp \| grep 1732` |
| FROZEN wire layout（`layout.ts:23-30`） | 加字段只能追加，不能改名 | 覆盖扩展（Phase 3.5）必须增量 |
| IndexedDB 配额/性能 | 大书库（几十 GB）可能触配额 | Chrome 配额≈磁盘 60%；书文件同步逻辑已支持"远端匹配就跳过" |
| 非安全上下文 | OPFS/统计/词典在 LAN IP 下坏 | PC 只用 `localhost` 打开；手机端无此问题 |
| standalone 静态资源漏拷 | 白屏 | Phase 0 第 3 步 |
| Android cleartext | WebDAV 连不上 | network-security-config（备选） |
| 裁剪破坏 import 图/测试 | 回归 | 分阶段 + 全绿基线对比 |
| 旧 fork 代码丢失 | Phase 3.5 需重做 | 先确认原始 checkout 是否还在别处 |

---

## 6. 工作量估算

| 阶段 | 代码量 | 预估 |
|---|---|---|
| Phase 0 骨架 | 0 | 0.5 天 |
| Phase 1 LAN 档 + 外联归零验收 | 0 | 0.5 天 |
| Phase 2 补丁 1–3（必做） | ~30 行 | 0.5 天 |
| Phase 2 补丁 4（外链收口） | 视需求 | 0.5 天 |
| Phase 2 补丁 5（Next 内置 WebDAV） | ~300–500 行 + 测试 | 2–4 天 |
| **Phase 3.0a 语言栈清理**（Swift/Apple、Lua、Python、Worker、CEF、桌面 Rust） | 删 ~200 文件 + 改 Cargo/CI/workspace | 1–2 天（含 2–3 次 APK 构建验证） |
| **Phase 3.0b 判断批**（网页剪藏 2876 行 / LocalSend / 遥测 / 墨水屏） | 视选择 | 0.5–1.5 天 |
| Phase 3 裁剪 1–2（支付/云/非目标平台） | 删 100+ 文件 | 2–3 天 |
| Phase 3 裁剪 3–4（第三方集成/provider 收窄） | 删 60+ 文件 | 2–3 天 |
| Phase 3.5 覆盖扩展（设置/书架/字体/词典） | 中 | 3–5 天（旧代码找回则减半） |
| Phase 4 Android 构建 + 真机 | 0 | 0.5–1 天 |

**建议路径**：Phase 0 → 1 → 2(1–3) → **3.0a** → 2.5-A/B/C/D → 3.0b → 4，先把"能日常用、零外联"跑起来（约 2 天），再按顺序一刀一刀删。

---

## 7. 附：语言栈盘点（Rust / Kotlin / Swift / Lua / 其他）

### 7.1 每种语言对应什么

| 语言 | 位置 | 是什么 | 与「PC web + Tauri Android」的关系 |
|---|---|---|---|
| **Rust** | `src-tauri/src/`（25 文件 / 9983 行） | Tauri 宿主的原生能力层 | **Android 必需**（app 外壳就是它），但模块可删 ~40% |
| | `src-tauri/plugins/tauri-plugin-native-bridge/`（100 文件 / 15311 行，Rust+Kotlin+Swift） | 平台桥：IAP 计费、游戏手柄、墨水屏刷新、桌面小组件、笔输入、OAuth 回调、内置浏览器、选词菜单 | Android 保留大部分（IAP/OAuth 随 A 删） |
| | `src-tauri/plugins/tauri-plugin-native-tts/`（32 文件 / 5934 行） | 原生 TTS（Android MediaSession/MediaPlaybackService、iOS Speech） | **随 C 全删** |
| | `src-tauri/plugins/tauri-plugin-{turso,webview-upgrade}/` | git submodule（本机未初始化）：SQLite / WebView 升级 | turso **必需**；webview-upgrade 可选 |
| | `packages/tauri/`（submodule） | vendored Tauri fork（root `Cargo.toml` 的 `[patch.crates-io]` 指向它） | **必需，不能简单删**（换回 crates.io tauri 是独立工程） |
| **Kotlin** | `gen/android/**`（跟踪 2 个 .kt：`MainActivity.kt` + `KeyLearnCaptureTest.kt`）+ 两个插件的 `android/` | Android 宿主与平台实现（计费/墨水屏/小组件/笔/手柄/选词/WebBrowser） | **不能删**（它就是 Android app）；只能删子集 |
| **Swift** | `gen/apple/**`（`Readest_iOS`/`ReadestWidget`/`ShareExtension`/CarPlay/`SentryBootstrap.m`）+ 两个插件的 `ios/`（`Package.swift` + `Sources/`） | Apple 平台层（iOS 壳、小组件、分享扩展、CarPlay、StoreKit 内购、原生词典弹窗） | **能全删**（放弃 macOS/iOS） |
| **Lua** | `apps/readest.koplugin/`（70 文件 Lua + 它**自带的第二个 Rust crate** `native/localsend-bin`） | **KOReader 插件**：一个完全独立的第三方阅读器生态产物，走 Readest API 同步笔记/进度 | **能全删**，与两端零共享代码；而且你已决定砍 KOSync，这条路本来就断了。删它要连带清 CI（见 §7.5） |
| **Python** | `apps/readest-calibre-plugin/`（16 个 .py） | Calibre 导入插件（走 Readest API） | 能删（第三方导入器，与两端无关） |
| **C / WASM** | submodule：`packages/qcms`（mozilla pdf.js.qcms）、`packages/simplecc-wasm`、`packages/js-mdict` | PDF 的 ICC 色彩管理 / 简繁转换 / MDict 词典解析 | 都在用但**都可选**（见 7.3） |
| **TypeScript（非 app）** | `workers/{iap-reconcile,send-email}/`（Cloudflare Worker）、`apps/readest-crosspoint-plugin/` | 内购对账 Worker、发邮件 Worker、CrossPoint 设备插件 | **全删**（云基础设施） |

### 7.2 Rust 细账：哪些必需、哪些可删

**必留**（Android 宿主 + 阅读核心，约 3600 行）：
- `range_file.rs` —— Android WebView 读本地书字节的自定义协议（注释里明写：range-in-URL，避 Android WebView 重复应用 offset）
- 格式解析与导入：`epub_parser.rs`(1534)、`mobi_parser.rs`(288)、`pdf_parser.rs`(305)、`comic_parser.rs`(150)、`parser_common.rs`(153)、`cover_thumbnail.rs`(535)、`dir_scanner.rs`(148)、`backup_zip.rs`(432)
- `lib.rs` 里的 `download_file`/`upload_file`/`get_environment_variable`/`get_executable_dir`/`set_webview_info`/`get_webview_version`/`allow_paths_in_scopes`
- 插件：`tauri-plugin-turso`(submodule)、`native_bridge` 的 Android 部分（手柄/墨水屏/小组件/笔/选词/DisplayUtils/KeyLearn）、以及 Tauri 官方插件 fs/shell/http/os/dialog/opener/clipboard-manager/device-info/persisted-scope

**可删**（约 6300 行，占 `src-tauri/src` 的 ~40%）：

| 类别 | 具体 | 行数 |
|---|---|---|
| 随 C（TTS）走 | `plugins/tauri-plugin-native-tts` 整个 crate（含 Kotlin/Swift 两端） | 5934 |
| 随 A（登录）走 | `start_server`（= `tauri_plugin_oauth::start`，第三方登录的回环服务器）、native-bridge 的 `BillingManager.kt`（foss/googleplay 两个 flavor）、`OAuthCallbackTarget.kt`、`macos/{safari_auth,apple_auth}.rs` | — |
| 哗桌面专属 | `nightly_update.rs`(226) + `install_nightly_update`、`discord_rpc.rs`(182)、`spawn_fresh_browser.rs`(184)、`window_state.rs`(143)、`browser_cookies_macos.rs`(116)、`linux_single_instance.rs`(56)、`linux_display.rs`(39)、`file_reveal.rs`(36)、`src/macos/` 整个目录 | ~1000 |
| CEF（Linux 专用） | `packages/tauri-runtime-cef-stub` + `cef` feature + `.cargo/cef.toml` | — |
| **看你要不要** | `web_browser.rs`(887) + `clip_url.rs`(810) + `browser_fetch.rs`(542) + `media_proxy.rs`(637) —— 内置浏览器 / 网页正文抓取 / 媒体代理，合计 **2876 行**；不剪网页文章就不需要 | 2876 |
| 可选 | `localsend/` + 9 个 `localsend_*` 命令（**你之前只选了 WebDAV，没选 LocalSend**）、`sentry_config.rs`(381)、`eink_identity.rs`(144) | ~1100 |

> 注意：`native-bridge` 的 `src/platform/` 里还有 `windows.rs` / `macos.rs` / `linux_cef.rs` / `cdp.rs` —— 都是桌面路径，跟上面的桌面清理一起走。

### 7.3 三个 submodule 的可删性

| submodule | 用途 | 结论 |
|---|---|---|
| `packages/foliate-js`（readest fork） | **EPUB 渲染核心**（`src/services/` 与 reader 全靠它） | **必留** |
| `packages/tauri`（readest fork） | Tauri 本体（`[patch.crates-io]`） | **必留**（换回上游是独立工程） |
| `packages/js-mdict` | MDict 词典解析（`services/dictionaries` 用） | 删词典才删它 |
| `packages/simplecc-wasm` | 简繁转换（`services/transformers/simplecc.ts`） | 小而独立，留着便宜 |
| `packages/qcms` | PDF 的 ICC 色彩管理（pdf.js 用） | 只影响 PDF 色彩保真度；若只看 EPUB/PDF 文本可删，但要实测 |

> 本机 5 个 submodule **全部未初始化**（`git submodule status` 全部带 `-` 前缀），所以 `packages/{foliate-js,qcms,js-mdict,simplecc-wasm,tauri}` 和两个插件 submodule 现在是空目录——分析基于 `.gitmodules` 与调用点，不是源码實读。

### 7.4 一句话结论

- **Lua / Python / Swift / Cloudflare Worker：能全删，而且建议删**（与两端零共享代码）
- **Kotlin：不能删**（它就是 Android app 的壳），只能删计费/OAuth/native-tts 三个子块
- **Rust：不能删**（Android 宿主必需），但可删约 40%（上表）；CEF 与桌面专属模块是最安全的第一批
- **Swift 删干净的前提**：同步删除 `packages/swift-rs` + root `Cargo.toml` 里的 `[patch.crates-io] swift-rs` + `tauri-plugin-sign-in-with-apple` + `tauri-plugin-sharekit` + npm 的 `@choochmeque/tauri-plugin-sharekit-api` + `Info-ios.plist` + `fastlane/` + `tauri.macos-*.conf.json`

### 7.5 删语言栈时会断的东西（清单，已排进 Phase 3.0a）

| 位置 | 具体 |
|---|---|
| `pnpm-workspace.yaml` | 去掉 `apps/readest-app/workers/{send-email,iap-reconcile}` 两行（`apps/*` 是通配，删目录自动生效） |
| root `package.json` | `test:lua` / `lint:lua` |
| `apps/readest-app/package.json` | `test:lua` / `lint:lua`（指向 `../readest.koplugin/scripts/*`） |
| `.github/workflows/pull-request.yml` | `koplugin_rust_lint` job（会去 `apps/readest.koplugin/native/localsend-bin` 跑 cargo）、两个 change-detection 里的 `koplugin` 路径 filter、test_extensions 里的 Lua 步骤 |
| `.github/workflows/release.yml` | koplugin zip job、`build-calibre-plugin` job、macOS 矩阵项 |
| `nightly.yml` / `codeql.yml` | 各自的 koplugin / Apple 引用 |
| 根目录 | `Cargo.cef.lock`、`fastlane/`、`try-appimage.yml` |

---

## 8. 附：包管理器 pnpm → bun 迁移评估（2026-10-15，结论：技术可行，但**不建议现在做**）

### 8.1 现状盘点（已实测）

| 项 | 数值 |
|---|---|
| `pnpm` 引用总量 | **1142 行 / 35 个文件**（6 个 workflow、`apps/readest-app/scripts` 15 个、`scripts` 4 个、Dockerfile、docker/、nix/、flake.nix、.husky 2 个、docs） |
| pnpm 专有机制（`pnpm-workspace.yaml`） | `allowBuilds`（8 个包，含原生/二进制：`sharp`/`workerd`/`esbuild`/`@sentry/cli`/`geckodriver`/`edgedriver`/`protobufjs`/`core-js`）、`onlyBuiltDependencies`、`patchedDependencies`（2 个补丁）、`overrides`（**~60 条**） |
| 工作区协议 | 只有 `foliate-js: workspace:*`（而且 `packages/foliate-js` 是 **submodule**） |
| bun 侧能力（本机 1.4.2 实测） | `--frozen-lockfile` ✓、`--linker=isolated|hoisted` ✓、`-F/--filter` ✓、`bun run --filter` ✓；`trustedDependencies` / `patchedDependencies` / `overrides` 均支持 |

### 8.2 具体阻碍（都是这个仓库特有的）

1. **`setup-vendors` 的路径假设**：`copy-pdfjs-*` 从 `../../packages/foliate-js/node_modules/pdfjs-dist` 拷贝（而 `pdfjs-dist` 是 foliate-js 的 **devDependency**）。bun 默认 **hoisted** linker 会把它提到根的 `node_modules` → 路径直接断。缓解：bunfig `linker = "isolated"`（等价 pnpm 布局），但这是全局取舍，要全量验证。
2. **`overrides` ~60 条的解析结果会变**：pnpm 与 bun 的去重/版本选择不同 → 最终打进 bundle 的版本可能不同 ⇒ 必须重跑完整测试 + 构建。这 60 条里大多是安全修复（`nanoid`/`ws`/`undici`/`dompurify`…），不能“看着差不多就行”。
3. **8 个 postinstall 信任**：bun 默认**不跑**未受信任的构建脚本 → 不迁到 `trustedDependencies` 就会静默缺二进制（`sharp` 是 Electron/next image 用的，`@sentry/cli` 要下载二进制）。
4. **两处 `patchedDependencies`**：搬到 package.json 后要验证补丁真的打上了（`patches/*.patch` 路径解析）。
5. **CI / Docker / nix 是另一半成本**：6 个 workflow + `corepack prepare pnpm@11.1.1` + Dockerfile 的 `pnpm install --frozen-lockfile` / `pnpm build-web` / `pnpm setup-vendors`。不改 → 仓库双包管理器；改 → 每次上游同步都在这几处冲突。
6. **上游同步成本**（本仓库的真成本）：`pnpm-lock.yaml` 与 `bun.lock` 不能共存为事实标准；`main` 还在往前跑（当前 `9fd7a4820`）。（缓减：本计划的 Phase 3 要删 32k 行，本来就会大幅偏离上游，所以这条权重可以降低。）

### 8.3 收益评估（为什么“不值”）

- **安装时长**：pnpm 暖缓存已经 **9.4s**；而实际瓶颈是 **Next 构建 30.8s** +（Android）APK ~10 min。换成 bun 省不了关键路径。
- **不能省掉 Node**：LAN 档运行时还是 `node apps/readest-app/server.js`（standalone）。用 bun 跑 Next server 是另一条未验证路径，不在本次范围。
- **真实的便利已经到手**：`bun run lan:start` / `lan:status` / `lan:stop` **今天就能用**（已实测，脚本是 bash，与包管理器无关）。想装工具也用 `bunx`。

### 8.4 如果要做，顺序与验收清单

**时机：放到 Phase 3 之后**（代码裁完、上游同步已不可行时），或者开独立实验分支。绝不建议在 LAN 档还没验收完时动。

1. 开 `git worktree` 或整目录副本（**别在正在跑服务的仓库里换 linker**）
2. 加 `bunfig.toml`：`linker = "isolated"`（对齐 pnpm 布局，保住 pdfjs 路径）
3. `pnpm-workspace.yaml` 的 `overrides` / `patchedDependencies` / build 信任 → 搬进 root `package.json` 的 `overrides` / `patchedDependencies` / `trustedDependencies`
4. `bun install --frozen-lockfile`（第一次会生成 `bun.lock`）
5. **必须全过的验收（缺一不可）**：
   - `bun run --filter @readest/readest-app setup-vendors` 产物与 pnpm 下**逐文件比对**（`public/vendor/pdfjs` 18 项）
   - `bun run --filter @readest/readest-app build-web`（`BUILD_STANDALONE=true`）成功，且 `.next/standalone` 能 `node server.js` 起来、`runtime-config.js` 内容正确
   - `bun run --filter @readest/readest-app test:pr:web:unit` **全绿**（基线：零失败）
   - `cargo check -p Readest --target aarch64-linux-android` + 一次 APK 构建装机
   - 对 `overrides` 里那 60 条抽验 `bun pm ls <pkg>` 解析结果与 pnpm 一致
6. 全部通过再改：6 个 workflow、Dockerfile、`docker/`、`nix/`、`flake.nix`、`.husky`、`apps/readest-app/scripts` 15 个文件，以及 `packageManager` 字段；最后删 `pnpm-lock.yaml`

**结论一句话**：bun 能做（机制齐），但在这个仓库里它换掉的是“已经够快的 install”，却要陪上“构建产物/解析结果都得重验 + 35 个文件 + CI/Docker/nix” —— 放到 Phase 3 之后再说；在那之前用 `bun run lan:*` 就行。

---

## 9. Phase 7：demo 幽灵行 / URL 式 demo 判定修复（排在最后）

### 9.1 现象与证据（2026-10-15 实测）

- 远端 `Readest/library.json` = **3 行**，本机书库 = **2 本**。
- 多出那行是 **URL-backed 的 demo 行**：`hash=1914c8c5…`，`url=http://localhost:17321/demo/testbook.epub`，文件 6,798,858 B（md5 `c82d540c…` = `/home/ruinb0w/tmp/testbook.epub`）。
- 另一行 `hash=06e01d70…`（用户在书库里看到的那本）是**另一个文件**：2,925,360 B，md5 `cb5d14a6…`，但 `url` 也写着 demo 那个地址。
- 两行的 `createdAt` **完全相同**（`1792058436556`）。
- demo 行是 `saveBook: false` 的**非持久化行**，只在 `localStorage['demoBooksFetched']` 不存在时由 `useDemoBooks` 拉；拉来后在 `library/page.tsx:915-929` 按 **hash** 合并进内存 library。⇒ 下次启动它就"消失"，但远端已留下它。

### 9.2 两条独立根因

**D1（确定）：file sync 不过滤 demo 行。**
`isDemoBook()` 只接进了**云（replica）**路径 —— `useBooksSync.ts:57`（`getNewBooks`）与 `:217`（`updateLibrary`）——而 WebDAV 路径是
`runLibrarySync.ts` 的 `runFileLibrarySyncPass` → `syncOneBackend` → `engine.syncLibrary(useLibraryStore.getState().library, …)`，**原样把所有行推上去**（包括 demo 行），并且会把它的 cover/config/书文件也推上去。
⇒ 本机 2 本 / 远端 3 行；其他设备一拉就多出一本书（幽灵行还会因 index 的 union 合并**留在远端**）。
**2026-10-15 模拟器上的实锤**：手机（全新安装、书库为空）连上后拉回 3 本，屏幕上真的出现了**两张“指数基金投资指南”卡片**（一本是远端 `06e01d70…` 真书，一本是 demo 幽灵 `1914c8c5…`）—— 这就是 D1 的可见后果。

**D2（待本地确认）：拖拽导入的真书带上了 demo URL。**
远端 `06e01d70…` 行的 `url` = demo 地址。若本地确实如此，则 `isDemoBook()` 会把这本**真书误判为 demo**（后果：云同步永久跳过它；file sync 的"过滤 demo"修法若照抄云路径，会把它一起滤掉 → 书推不上去）。
根因是 §4 **[P2-6]** 把 demo 清单换成了"同源本地路径"：那个 URL 现在指向一个**用户可能真的会导入的文件**，于是"用 URL 认 demo"这个判据从"指向 Readest CDN"退化成"指向本机一个普通 epub"。
> 待确认步骤：bow 打开 `http://localhost:17321` → 控制台读 IDB 的 `Readest/Books/library.json`（或临时把 `demoBooksFetched` 清掉再看是否多出一行），确认本地到底有几行、`06e01d70…` 的 `url` 是什么。

### 9.3 修复方案（按推荐度）

- **[P7-a] 让 demo 判定显式化（根治 D2）**
  在 `Book` 上加 `isDemo?: true`（或 `source: 'demo'`），`useDemoBooks` 导入时标上、随行持久化；`isDemoBook()` 改成看标记（保留 URL 集合作兜底，仅匹配 `cdn.readest.com` 那类远端 URL）。
  代价：动 `types/book.ts` + `demoBooks.ts` + 两处云过滤；收益：真书不可能再被误判，且以后换 demo 清单不会影响判定。**这是上游该做的修法。**

- **[P7-b] 二选一，先解决"幽灵行"（修 D1 的一半）**
  1. **推荐**：`src/data/demo/library.{en,zh}.json` 改成 `[]` —— LAN 档不需要样书，空书库回到"导入书籍"提示；从源头没有 demo 行。
  2. 保留样书：保留 JSON，但必须同时做 [P7-c]。

- **[P7-c] file sync 推送侧也过滤 demo 行（对称于云路径）**
  位置：`runLibrarySync.ts` 的 `syncOneBackend`（传给 `engine.syncLibrary` 的列表）与 `runFileBookUpload`（单本上传）。
  ⚠️ 两个前提：① 先用 [P7-a] 修好判定（否则会滤掉真书）② **只过滤"推"**，拉回来的行照旧合并（否则对端已有的行会被当成"本机没有"而反复重拉）。

- **[P7-d] 清理远端已有的幽灵行（必须做，否则幽灵行不死）**
  删 `~/readest-sync/Readest/books/1914c8c5cf9abe5a2af8c1c80b17a35c/` 整个目录，并从远端 `Readest/library.json` 的 `books[]` 里删掉该行（`url` 指向 `/demo/` 的那行）。
  ⚠️ 顺序：必须先 [P7-b]/[P7-c] 再清远端，否则下一次同步会把它重新推回来（index 是 union 合并）。

- **[P7-e] 验证清单**
  1. 清掉 `localStorage['demoBooksFetched']` → 刷新 → 本机不出现 demo 行（若保留样书：[P7-a] 后真书不会被误判）
  2. 本机行数 == 远端行数（`python3 -c` 对比两边）
  3. 拉取方向：删本地字节 → 重开书 → `webdav.log` 出现 GET（顺手补掉 `[P1-3-σ]`）
  4. 跨设备：同一地址在第二个浏览器 profile（或手机）打开 → 只看到 2 本，不多不少
  5. `pnpm test:pr:web:unit` 全绿（`isDemoBook` 的现有用例在 `src/__tests__/...`）

### 9.4 与其它阶段的关系

- 与 Phase 2.5-B（删第三方同步/replica）**有重叠但不等同**：云路径被删掉后，`useBooksSync.ts` 那两处 `isDemoBook` 过滤会一起消失，**D1 的修法就只剩 file sync 一处**——所以如果你先做 2.5-B，[P7-c] 的改动面会变小。
- [P7-b]（JSON 改 `[]`）是一行改动，**随时可做**，不依赖任何阶段；做完幽灵行就不会再生（[P7-d] 的清理仍要补）。
