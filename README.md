# Readest（局域网档）

[Readest](https://github.com/readest/readest) 的个人分支，只保留两件事：

- **PC 上用浏览器读书** —— 不打包桌面版，直接跑 Next dev server
- **Android APK 通过局域网和 PC 同步** —— 同步后端只有 WebDAV，服务跑在自己机器上

没有账号、没有 Readest 云端、没有应用内更新。除你自己填的 WebDAV 地址外，同步链路上不请求任何外部服务。

阅读器本体（多格式、标注/笔记、词典、分屏、剪藏、OPDS、无障碍……）与上游一致，只是发版路径换成了上面两条。

## 快速开始

```sh
pnpm install                # 首次；升级 pdfjs 后还要 pnpm setup:vendors

pnpm dev                    # WebDAV hub(:17322) + Next dev(:17321)，一条命令，Ctrl-C 一起收
                            # 启动时会打印「手机该填 http://<本机IP>:17322」
```

浏览器打开 `http://localhost:17321` 读书。

出安卓包、装到手机：

```sh
pnpm build:android:arm64    # 手机；模拟器/ x86 平板用 build:android:x86
adb install -r ~/readest-lan/dist/readest-lan-v<版本>-<架构>.apk   # 同签名可覆盖，数据保留
```

手机里填同步：设置 → 集成 → 云同步 → **WebDAV**，地址 `http://<PC 的局域网 IP>:17322`，用户名/密码在
`~/readest-lan/webdav.env`（第一次跑 `pnpm dev` 时自动生成，密码是随机的）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | WebDAV hub + Next dev（PC 阅读 + 手机同步） |
| `pnpm dev:check` | 排查手机连不上：端口、hub 认证、镜像内容、手机该填什么 |
| `pnpm dev:logs` | 盯 hub 的请求日志 |
| `pnpm stop` | `pnpm dev` 被 `kill -9` 后清残留进程 |
| `pnpm build:android:arm64` / `:x86` | 出 APK，产物拷到 `~/readest-lan/dist/` |
| `bash scripts/lan/apk.sh aarch64 --devtools` | 同上，但打开 WebView CDP（连真机排查用） |
| `bash scripts/lan/apk.sh aarch64 --debug` | 调试构建 |
| `pnpm test` | 全量门禁：types → lint → format → rust → unit |
| `pnpm test:{types,lint,format,rust,clippy,unit,browser,coverage}` | 单项 |
| `pnpm format` | 按规范改写 |
| `pnpm i18n:extract` | 改文案后扫待翻译键 |

## 同步是怎么走的

hub 就是一份普通目录（默认 `~/readest-sync`，见 `webdav.env` 的 `SYNC_ROOT`），手机和 PC 都把它当 WebDAV 远端：

```
<SYNC_ROOT>/Readest/
  library.json            书库索引（各设备的并集）
  settings.json           书架分组 + 阅读偏好（只搬允许清单内的几组）
  books/<hash>/           <标题>.<格式> + cover.png + config.json（进度、标注、笔记）
```

目录结构是冻结的，别手改名字。协议、防火墙、排障、镜像字段的细节都在
**[scripts/lan/README.md](scripts/lan/README.md)**（运维手册，改动同步相关的东西前先看它）。

## 常见坑

| 现象 | 处理 |
| --- | --- |
| 手机 TCP 超时、服务明明在听 | Windows 防火墙要 `-Profile Any`，见运维手册 |
| vivo/国产 ROM 装包被拦 | 系统的「外部来源应用」闸门，手机上点一次授权；`adb install` 会一直挂到超时 |
| 笔记/词典弹层被软键盘盖住 | 已修（`MainActivity.kt` 把 IME inset 加到底部 padding）。根因是 Android WebView 从 M139 起才把键盘高度交给页面 |
| 手机同步报 `...localhost...` | 手机端 URL 还是 `localhost`，改成 PC 的局域网 IP |

## 与上游的差别

- **发版**：只有 PC（dev server）+ Android APK；macOS/Windows/Linux/iOS 的构建脚本与 CI 配置已删除。
- **账号与云端**：登录、Readest 云端同步、以及 Dropbox/Drive 之类的第三方后端已移除，同步只剩 WebDAV。
- **更新**：应用内更新会请求外网，已删除；换包靠 `adb install -r`。
- **新增**：`scripts/lan/`（dev/apk/运维脚本 + `dav-server.mjs` 这个自带 WebDAV hub）与
  `src-tauri/plugins/` 下的 `native-bridge`、`turso`、`webview-upgrade`。

细节看 `git log --no-merges` 里的 `lan` 系列提交。

## 许可

AGPL-3.0，与原项目一致（见 [LICENSE](LICENSE)）。上游：<https://github.com/readest/readest> · <https://readest.com>
