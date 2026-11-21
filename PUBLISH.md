# 发布到 GitHub

这台机器**没有安装 git 和 gh**，所以我无法代你推送。按下面步骤操作即可。

## 一、需要先补的信息

`README.md` 里没有写仓库地址。发布前把它补上，否则别人不知道去哪反馈问题。

在 `package.json` 里加 `repository` 字段（可选，但推荐）：

```json
"repository": {
  "type": "git",
  "url": "https://github.com/<你的用户名>/dsh-chat-mode.git"
}
```

## 二、安装 git

Windows 任选一种：

```powershell
winget install --id Git.Git -e
# 或到 https://git-scm.com/download/win 下载安装
```

安装后重开终端，确认：

```powershell
git --version
```

## 三、首次提交

在 `dsh-chat-mode` 目录下执行：

```powershell
cd "D:\OneDrive - 广州大学附属中学备用信息中心\文档\deepseek-harness\default-workspace\dsh-chat-mode"

git init
git add .
git commit -m "feat: chat mode with embedded official web chat

Adds a Chat/Work switch to the DeepSeek Harness top bar. Chat mode embeds
chat.deepseek.com in a Desktop webview panel via the shell's own lease
bridge, collapses the sidebar, and carries the web sign-in across restarts
through a localStorage snapshot.

Guards all webview guest calls against Electron's synchronous throw, which
previously blanked the frame when switching back to Work.
"
```

**提交前确认 `.gitignore` 生效**，不要把临时文件带进去：

```powershell
git status --short
```

正常情况下只应看到这 11 个文件：

```
A  .gitignore
A  LICENSE
A  PUBLISH.md
A  README.md
A  client.js
A  cordis.patch.yml
A  icon.svg
A  index.js
A  locale/en.json
A  locale/zh.json
A  package.json
```

如果 `PUBLISH.md` 你不想公开（它主要是给你自己看的操作手册），在 `.gitignore` 里加一行 `PUBLISH.md` 再提交即可。

## 四、在 GitHub 上建仓库

1. 打开 https://github.com/new
2. 仓库名填 `dsh-chat-mode`
3. **不要**勾选 "Add a README file"（本地已有）
4. 创建后，按页面提示推送：

```powershell
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-chat-mode.git
git push -u origin main
```

## 五、仓库设置建议

- **About**：填一句简介，例如「Chat/Work switch for DeepSeek Harness — chat mode embeds the official free web UI instead of billing API credit」
- **Topics**：`deepseek` `deepseek-harness` `dsh` `plugin` `cordis` `chatgpt` `electron`
- **License**：GitHub 会自动识别根目录的 `LICENSE`（MIT）

## 六、发布 Release（可选）

插件目前靠目录安装，不发 npm。但如果想让人一键下载：

```powershell
git tag v3.0.1
git push origin v3.0.1
```

然后在 GitHub 的 Releases 页面基于这个 tag 建一个 release，附上说明即可。

---

## 关于 `private: true`

`package.json` 里保留了 `"private": true`。这**不影响**从 GitHub 克隆后本地安装（插件管理器走的是目录 link，不是 npm registry），同时能防止误发布到 npm。

如果你确实想发到 npm，需要删掉这一行，并补上 `repository` 字段。

---

## 发布后的自查

推送完成后，建议自己克隆一份到干净目录并安装一次，确认没有遗漏文件：

```powershell
cd $env:TEMP
git clone https://github.com/<你的用户名>/dsh-chat-mode.git verify-clone
```

然后在 Harness 里用「设置 → 插件 → 安装」指向 `verify-clone` 目录，重启应用，确认顶栏的 `聊天 / 工作` 开关出现且能正常切换。

这一步能验证 `.gitignore` 有没有误伤、`files` 字段是否完整。
