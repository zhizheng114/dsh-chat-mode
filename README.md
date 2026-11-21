# dsh-chat-mode

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的顶栏改成 `聊天 / 工作` 双模式，**聊天模式内嵌 chat.deepseek.com 官方网页版**，走你的网页版账号，不消耗 API 余额。

工作模式是原封不动的 Harness 会话、工具与视图。

> **未经 DeepSeek 官方授权。** 这是一个第三方插件，使用的都是 Harness 自己公开的插件接口与桌面端内建的 webview 通道，没有修改应用本体。详见 [限制与风险](#限制与风险)。

---

## 它解决什么问题

Harness 的对话走 API 计费。DeepSeek 还有免费的网页版，但两者的登录态、界面、限额体系完全独立，过去只能在两个应用之间来回切。

这个插件把官方网页版嵌进 Harness 的中央面板，用顶栏开关一键切换：

- 想免费聊 → `聊天`，用的是网页版账号
- 想用工具、计划、轨迹视图 → `工作`，回到原生 Harness

## 功能

- **顶栏开关**：`聊天 / 工作` 分段控件，位置在会话头部；内嵌面板的工具栏里也有一份（因为两个面板同一时刻只挂载一个，所以永远只看到一个）
- **真实内嵌**：面板里加载的是 `chat.deepseek.com` 本体，不是仿制的 UI
- **自动收起侧边栏**：进入聊天模式时折叠侧边栏，切回时还原 —— 但**只还原自己折叠的那次**；你本来就把侧边栏收起来了，它全程不碰
- **记住登录**：在同一台机器上跨重启免重登（实现方式见下）
- **清除已保存登录**：工具栏里有入口，可随时删除本机保存的凭证

## 安装

需要**桌面版** DeepSeek Harness（`聊天` 模式依赖桌面端的 Electron webview，网页版 Harness 用不了）。

```bash
# 1. 放到本地任意目录
git clone https://github.com/zhizheng114/dsh-chat-mode.git dsh-chat-mode

# 2. 用 Harness 的插件管理器安装该目录
#    在 Harness 里：设置 → 插件 → 安装 → 选择该目录
#    或让 Agent 调用 plugin_manager install_bundle，target 指向该目录
```

安装后**需要完全退出并重启应用**才能生效。插件的客户端半边是启动时加载的，热更新不会替换已经加载的模块。

## 使用

顶栏点 `聊天` → 中央面板变成官方网页版，侧边栏收起。首次使用需要在里面正常登录一次。

点 `工作` 回到 Harness 会话。你的登录态会保留。

## 限制与风险

这些是**已核实的事实**，不是猜测。发布时请一并阅读。

### 1. 登录态的实现方式

网页版把凭证放在 `localStorage`（`userToken` / `__appKit_userInfo`），用于 `Authorization: Bearer` 鉴权。之所以不用 cookie，是因为 cookie 是 `HttpOnly`，页面脚本读不到。

Harness 桌面端给每张访客页发的分区是 `dsh-sidebar-browser-<随机UUID>`，**没有 `persist:` 前缀**，进程退出即销毁。所以插件在页面存活期间把这两个键复制到 Harness 页面自己的 `localStorage`，下次启动再写回去。

**这意味着：token 以明文形式存在本机磁盘上**（Harness 应用数据目录的 localStorage）。任何能读取你用户目录的进程都能拿到它。工具栏的「清除已保存的登录」可以删除它。

如果这个代价你不接受，用工具栏的「在浏览器打开」是更安全的选择。

### 2. 第三方登录（Google / Apple）需要能连上对应服务器

网页版的第三方登录走**弹窗**。但 Harness 主进程会拒绝访客页打开的任何窗口，只把 URL 报给插件。插件把认证类 URL（Google / Apple / 微信 / Microsoft）改为在**同一个 guest 内跳转**，这样登录完成后重定向回 `chat.deepseek.com` 时，登录态落在正确的会话里。

**但这一步修不了网络封锁。** 实测：`accounts.google.com` 在国内网络下**直连不通**，`appleid.apple.com` 可通。所以：

- 邮箱 / 手机号 + 密码 / 验证码登录：不受影响
- Google 登录：需要能访问 `accounts.google.com`
- Apple 登录：通常可用

如果认证页打开后一直转圈或报错，那是到该服务器的网络问题，不是插件问题。工具栏的「回到对话」按钮可以把你从认证页带回。

### 3. 依赖网页版的内部实现

快照依赖 `userToken` / `__appKit_userInfo` 这两个键名。DeepSeek 改版、改名、或对 token 加密，快照就会失效。

**失效时的行为**：降级为显示未登录页面，你需要重新登录一次。不会卡死，也不会出错。

### 4. 开发者工具在访客页不可用

Harness 桌面端主进程在 `will-attach-webview` 里对访客页强制设置 `devTools: !app.isPackaged`。打包版下为 `false`，插件无法绕过。因此**没有为内嵌页面加右键菜单开 DevTools** —— 加了也是一个点了没反应的按钮。

主窗口（Harness 自身）的 DevTools 可用（F12），但看不到访客页内部的 DOM。

### 5. 合规

本插件不修改 Harness 应用本体，也不伪造任何客户端标识或绕过第三方风控。它做的事情是：在你自己的机器上，用官方网页版自己的登录态，在应用内嵌的浏览器里打开官网。

但请自行确认这符合 DeepSeek 用户协议与 Harness 的许可条款。**本项目不提供任何担保**，使用风险自负。

## 工作原理

想改代码的话，这几个位置是关键：

| 关注点 | 位置 |
| --- | --- |
| 模式开关渲染位置 | `conversation.header.leading` 槽位 + 内嵌面板工具栏 |
| 面板注册 | `main` 槽位，key 为 `chat-mode-web` |
| 面板切换 | `layout.selectPanel('chat-mode-web')` / `selectPanel(null)` |
| 侧边栏 | `layout.toggleSidebar()`，配合 `[data-sidebar-collapsed]` 判断当前状态 |
| guest 租约 | `window.dshDesktop.browser.acquire(identity)` |
| 快照 | `snapshotScript` / `restoreScript`，通过 `webview.executeJavaScript` 执行 |

两个容易踩的坑，写在这里省得你重新踩：

**webview 的调用会同步抛异常。** `executeJavaScript` / `loadURL` / `reload` 在 guest 未 attach 时是**同步 throw**，不是 rejected promise。必须 `try { } catch { }` 包住调用本身 —— 只包 `.catch()` 接不住。这个坑曾导致切回工作模式时整棵 React 树被杀掉、页面全白。

**恢复快照需要一次 reload。** 网页版在启动时就读取 token，等到 `dom-ready` 再写入已经太晚。所以写完要 reload 一次，让它下次启动时读到。

## 开发

无构建步骤。`client.js` 是纯 JS，用 `React.createElement`（没有 JSX 转译）。

```bash
node --check client.js    # 语法
node --check index.js
```

插件结构遵循 Cordis bundle 约定：`package.json` 的 `dsh.bundle.patch` + `dsh.client`，宿主半边 `index.js` 导出 `apply()`，客户端半边通过 `window.__ModuleLoader__.load` 注册。

## 许可

MIT，见 [LICENSE](LICENSE)。
