# Browser Utilities

用于存放个人使用的浏览器用户脚本和 Chrome 扩展。

当前包含两个项目：

- **TG / 头歌任务助手**：ScriptCat Userscript，当前版本 3.4
- **学习通资料下载器**：Chrome Manifest V3 Extension，当前版本 0.4.0

## 下载

| 项目 | 类型 | 版本 | 安装 / 下载 |
| --- | --- | --- | --- |
| [TG任务助手前台面板](https://scriptcat.org/zh-CN/script-show-page/6322) | ScriptCat Userscript | 3.4 | [ScriptCat 安装](https://scriptcat.org/zh-CN/script-show-page/6322) |
| [TG任务状态后台扫描器](https://scriptcat.org/zh-CN/script-show-page/6323) | ScriptCat Userscript | 3.4 | [ScriptCat 安装](https://scriptcat.org/zh-CN/script-show-page/6323) |
| [学习通资料下载器](https://github.com/YuukiRitoTeng/browser-utilities/tree/main/js/%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%B5%84%E6%96%99%E4%B8%8B%E8%BD%BD%E5%99%A8) | Chrome MV3 Extension | 0.4.0 | [GitHub Release ZIP](https://github.com/YuukiRitoTeng/browser-utilities/releases/download/2026.09/Chaoxing-Materials-Downloader-v0.4.0.zip) |

ScriptCat 作者主页：[https://scriptcat.org/zh-CN/users/188482](https://scriptcat.org/zh-CN/users/188482)

## 项目结构

```text
browser-utilities/
├─ js/
│  ├─ TG任务助手前台面板.js
│  ├─ TG任务状态后台扫描器.js
│  └─ 学习通资料下载器/
│     ├─ manifest.json
│     ├─ service_worker.js
│     ├─ content.js
│     ├─ scanner.js
│     ├─ popup.html
│     ├─ popup.js
│     ├─ README.md
│     └─ 学习通资料下载器-v0.4.0.zip
└─ docs/
```

## A. TG / 头歌任务助手

这是两个配套的 ScriptCat 用户脚本：

1. TG任务助手前台面板
2. TG任务状态后台扫描器

两个脚本已经发布并同步到 ScriptCat，推荐直接通过 ScriptCat 安装和更新。

ScriptCat 作者主页：[https://scriptcat.org/zh-CN/users/188482](https://scriptcat.org/zh-CN/users/188482)

脚本页面：

- TG任务助手前台面板：[ScriptCat 页面](https://scriptcat.org/zh-CN/script-show-page/6322)
- TG任务状态后台扫描器：[ScriptCat 页面](https://scriptcat.org/zh-CN/script-show-page/6323)

两个脚本都需要安装并启用。推荐从 ScriptCat 安装，后续更新也通过 ScriptCat 获取。GitHub 中的 `.js` 文件主要作为源码查看和版本留档，不再把 GitHub Release 作为 TG 脚本的主要下载渠道。

### 安装

1. 安装 ScriptCat。
2. 打开 [TG任务助手前台面板](https://scriptcat.org/zh-CN/script-show-page/6322)。
3. 安装“TG任务助手前台面板”。
4. 打开 [TG任务状态后台扫描器](https://scriptcat.org/zh-CN/script-show-page/6323)。
5. 安装“TG任务状态后台扫描器”。
6. 确保两个脚本都已启用。
7. 登录 TG / Educoder 后使用。

GitHub 源码和 Raw 链接仍然保留：

- [TG任务助手前台面板.js 源码](https://github.com/YuukiRitoTeng/browser-utilities/blob/main/js/TG%E4%BB%BB%E5%8A%A1%E5%8A%A9%E6%89%8B%E5%89%8D%E5%8F%B0%E9%9D%A2%E6%9D%BF.js) · [Raw](https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG%E4%BB%BB%E5%8A%A1%E5%8A%A9%E6%89%8B%E5%89%8D%E5%8F%B0%E9%9D%A2%E6%9D%BF.js)
- [TG任务状态后台扫描器.js 源码](https://github.com/YuukiRitoTeng/browser-utilities/blob/main/js/TG%E4%BB%BB%E5%8A%A1%E7%8A%B6%E6%80%81%E5%90%8E%E5%8F%B0%E6%89%AB%E6%8F%8F%E5%99%A8.js) · [Raw](https://raw.githubusercontent.com/YuukiRitoTeng/browser-utilities/main/js/TG%E4%BB%BB%E5%8A%A1%E7%8A%B6%E6%80%81%E5%90%8E%E5%8F%B0%E6%89%AB%E6%8F%8F%E5%99%A8.js)

支持入口：

- TG 外网：`https://tg.zcst.edu.cn`
- TG 内网：`http://172.16.36.150`
- Educoder / 头歌公网：`https://www.educoder.net`

两个脚本的功能包括课程与任务状态扫描、考试/小测试/图文作业汇总、截止时间整理、课程筛选、课程置顶、任务忽略与折叠、刷新状态和网络延迟检测等。详细说明见：[前台面板说明](docs/frontend-panel.md) · [后台扫描器说明](docs/backend-scanner.md)。

## B. 学习通资料下载器

类型：Chrome Manifest V3 Extension

目录：[`js/学习通资料下载器/`](https://github.com/YuukiRitoTeng/browser-utilities/tree/main/js/%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%B5%84%E6%96%99%E4%B8%8B%E8%BD%BD%E5%99%A8/)

当前版本：0.4.0

主要能力：

- 扫描学习通新版课程“资料”。
- 保留课程目录层级。
- 一键批量下载。
- 使用 Chrome 原生 Download。
- 自动 Queue / 并发调度。
- 已完成文件跳过。
- 文件名冲突时 uniquify。
- Safe Browsing 危险下载人工确认。
- 展示下载状态与异常。

### 安装方法

1. 从 [GitHub Release](https://github.com/YuukiRitoTeng/browser-utilities/releases/tag/2026.09) 下载 [Chaoxing-Materials-Downloader-v0.4.0.zip](https://github.com/YuukiRitoTeng/browser-utilities/releases/download/2026.09/Chaoxing-Materials-Downloader-v0.4.0.zip)。
2. 解压 ZIP。
3. Chrome 打开 `chrome://extensions`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择刚才解压出来的文件夹。
7. 登录学习通并进入新版课程“资料”页面。
8. 点击“扫描全部资料”。
9. 扫描完成后点击“下载全部”。

首次批量下载时，Chrome 可能询问是否允许当前学习通网站下载多个文件，请选择允许。

危险文件可能被 Chrome Safe Browsing 拦截：

- 扩展会显示“等待安全确认”。
- 点击“处理安全确认”。
- 在扩展 Popup 中继续操作。
- 最终是否允许保存由 Chrome Safe Browsing 决定。

不要关闭或弱化 Safe Browsing。

已知限制：

- 保存位置基于 Chrome Downloads。
- 暂不支持任意磁盘目录。
- `tch-courseware` 特殊资源暂不处理。
- 不使用 aria2 / 本地后端。
- 不做特殊视频解析。
- Windows / Chrome 可能规范化部分文件名。
- Safe Browsing 最终由 Chrome 控制。

更详细的扩展说明见：[`js/学习通资料下载器/README.md`](https://github.com/YuukiRitoTeng/browser-utilities/blob/main/js/%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%B5%84%E6%96%99%E4%B8%8B%E8%BD%BD%E5%99%A8/README.md)。

## Release

[Browser Utilities - 2026.09](https://github.com/YuukiRitoTeng/browser-utilities/releases/tag/2026.09) 只提供学习通资料下载器的 Chrome 扩展 ZIP；TG 两个脚本通过 ScriptCat 发布和更新。

## License

MIT License. See [LICENSE](LICENSE).
