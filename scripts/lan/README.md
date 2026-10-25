# LAN 档运维手册

这个分支只做两件事:**PC 上用浏览器读书** + **Android APK 通过局域网和 PC 同步**。
没有账号、没有云端、没有任何外部请求(除了你自己配的 WebDAV 地址)。

## 端口

| 端口 | 谁 | 说明 |
|---|---|---|
| 17321 | Next dev(PC 阅读用) | 浏览器打开 `http://localhost:17321`;**必须**用 `localhost` 或局域网 IP |
| 17322 | WebDAV hub(自带,`dav-server.mjs`) | 手机/其他设备填 `http://<PC的局域网IP>:17322` |

## 命令

PC 端不打包，直接跑开发服务器；只有安卓需要出包。

```sh
pnpm dev            # 一条命令：WebDAV hub(:17322) + Next dev(:17321)
                    # 启动时会打印「手机该填 http://<本机IP>:17322」
pnpm dev:check      # 排查：端口在不在听、hub 认证通不通、镜像里有什么、手机该填什么
pnpm dev:logs       # 盯 hub 请求日志（Next dev 的输出在 pnpm dev 那个终端里）
pnpm stop           # 逃生：pnpm dev 被强杀后，清掉残留的 hub / dev 进程

pnpm build:android:x86      # 模拟器 / x86 平板
pnpm build:android:arm64    # 手机
#   要加参数就直接调脚本：bash scripts/lan/apk.sh <x86_64|aarch64> [--devtools] [--debug]
#     --devtools  带 CDP 调试台（要连真机排查时）
#     --debug     调试构建
#   产物自动拷到 ~/readest-lan/dist/readest-lan-v<版本>-<架构>[-debug].apk

pnpm test / test:unit / test:browser / test:coverage
pnpm test:types / test:lint / test:rust / test:clippy / test:format
pnpm format                 # 按规范改写
pnpm setup:vendors          # 首次/升级 pdfjs 后拷资源
pnpm i18n:extract           # 改文案时扫待翻译键
```

`pnpm dev` 会把 hub 和 dev server 放在同一个前台进程里：Ctrl-C 一起收，不留孤儿。
两条退出路径都会把端口还回去；被 `kill -9` 打断时才需要 `pnpm stop`。

## 镜像结构(FROZEN,别手改目录名)

```
<SYNC_ROOT>/
  Readest/
    library.json                 书库索引(所有设备的并集)
    settings.json                书架分组 + 阅读偏好(允许清单内的三组)
    books/<hash>/
      <标题>.epub                书文件
      cover.png                  封面(本地有才上传)
      config.json                进度 + 标注/笔记
```

## 手机/其他设备怎么配

1. 设置 → 集成 → **云同步 → WebDAV**
2. 服务器 URL:`http://<PC 的局域网 IP>:17322`
3. 用户名/密码:上面 `webdav.env` 里的值
4. 根目录:`/`
5. 点「连接」→ 状态应显示「几秒前已同步」,书库出现 PC 上的书

点一本没有本地文件的书会从镜像下载;读了之后进度/标注会推回镜像。书架分组和阅读偏好也会跟着走。

## 防火墙(Windows)

端口在 `0.0.0.0` 上监听但手机连不上,九成是防火墙。规则**必须覆盖所有 profile**,
默认的 `Private,Domain` 在 Windows 把网络判定为「公用」时完全不生效:

```powershell
New-NetFirewallRule -DisplayName 'ReadestLAN-17321-17322' -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 17321-17322 -Profile Any
```

临时验证不想动防火墙,可以用 adb 隧道(仅调试):

```sh
adb -s <serial> reverse tcp:17322 tcp:17322   # 手机里的 http://localhost:17322 直通 PC
```

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| PC 打开是白屏 | `pnpm dev:check` 看 Next dev 有没有在听 17321；编译报错都在 `pnpm dev` 那个终端里 |
| 手机「同步失败 error sending request for url (...localhost...)」 | 手机端 URL 还是 `localhost`(调试隧道已断)。改成 PC 局域网 IP,或重开隧道后重启应用 |
| 服务在听但手机 TCP 超时 | 防火墙:见上,`-Profile Any` |
| 改完 WebDAV 地址后第一次同步像没生效 | 已知小问题:紧接着的那次同步可能用了保存前的设置快照。再点一次「立即同步」或重启应用即可 |
| 书库里有书但打开是空白/闪回 | 书文件没落到本地。打开 WebDAV 子页看目录里 `books/<hash>/` 是否有书文件;`pnpm dev:logs` 看 `webdav.log` 有无 4xx/5xx |
| 镜像里某本书没封面 | 导出/生成封面失败,不是同步问题:上传链路对没有封面的书会跳过 |
| 服务静默死掉 | 重跑 `pnpm dev`;端口被占或进程残留用 `pnpm stop` 清。日志在 `~/readest-lan/logs/` |

## 为什么 WebDAV 不用 rclone / 不放 Next 路由里

- Next App Router 只派发它认识的方法(GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS),
  **PROPFIND / MKCOL 根本进不来**,要用 middleware 绕(Edge runtime 没有 fs)。
- rclone 是 60 MB 外部二进制,还得单独学一套配置语法。
- 所以留了一份 ~250 行的 `scripts/lan/dav-server.mjs`:七个动词、HTTP Basic、
  路径逃逸防护,协议行为有单测(`src/__tests__/services/sync/file/dav-server.test.ts`)。

## 更新 APK

没有应用内更新(那份逻辑会请求外网,已删)。手动换包:

```sh
pnpm build:android:arm64        # 手机
pnpm build:android:x86          # 模拟器
adb install -r ~/readest-lan/dist/readest-lan-v<版本>-<架构>.apk   # 同签名可覆盖,数据保留
```

想远程调试 WebView(CDP)就打带特性的包:`bash scripts/lan/apk.sh aarch64 --devtools`
(日常包不要带,它会把调试台暴露给任何能 adb 的设备)。

装包时国产 ROM(vivo 超级守护等)会拦「外部来源应用」,要在手机上点一次授权;
`adb install` 在那之前会一直挂着直到超时。
