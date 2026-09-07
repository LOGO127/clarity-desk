# 轻量化记录

2026-09-05，v0.3.0 公开测试版的本地构建测量。轻量化不替代公式功能的真实验收；GitHub 安装包由发布流水线单独构建，其确切大小与校验值以 [Release](https://github.com/LOGO127/clarity-desk/releases/tag/v0.3.0) 为准。

## 已实现

- 默认窗口 960 × 700，直接打开公式工具，导航只保留常用入口。
- Markdown / KaTeX、录音、记录与设置按需加载。
- renderer 使用生产压缩；已打入 renderer 的库不再作为重复运行依赖打包。
- Electron 仅保留 zh-CN 与 en-US 语言资源。

## 测量

使用本地 Node.js 24、Windows x64 的生产构建；下表为未 gzip 压缩的静态文件字节，不是运行内存或启动时间。

| 项目 | 轻量化前 | 本轮构建观察值 |
| --- | --- | --- |
| 首屏 JavaScript | 约 1.56 MB | 210,766 字节 |
| 可选 Markdown / 公式导入模块 | 合并在首屏 | 443,668 字节，展开才加载 |
| Windows x64 便携版 | 116,098,072 字节 | 103,823,112 字节，约减少 10.57% |
| Windows x64 安装版 | 116,343,164 字节 | 104,068,202 字节 |
| `win-unpacked` 全部文件 | 429,040,813 字节 | 342,506,062 字节，约减少 20.17% |
| `resources/app.asar` | 44,541,780 字节 | 7,472,353 字节 |
| Chromium 语言资源 | 55 个文件，50,644,017 字节 | 2 个文件，1,178,693 字节 |
| 常驻内存、冷启动时间 | 未建立可靠基线 | 尚未测量 |

后续代码修改会改变字节数，最终发布时应重新构建并记录实际值。Electron 自带 Chromium / Node，界面代码减小不意味着安装包或内存同比减小。

本轮 `npm run dist:win` 和重建后的 `node scripts/electron-smoke.cjs --packaged` 已通过。这里只验证解压后应用的启动、页面、版本、按需加载、重复启动及外链隔离；没有自动执行 NSIS 安装/卸载。这些本地测量产物不直接上传，发布流程重新构建和验证。

验证命令：`npm run build`，统计 `out/renderer/assets/index-*.js`；最终运行 `npm run dist:win` 后统计 Release 中实际文件。桌面回归检查启动时尚未请求可选导入模块及 KaTeX 字体，但不会据此宣称所有机器的首屏更快。

## v0.3.1 复测（2026-09-07）

本次只修复运行中转写任务的重复请求和相关按钮状态，不新增依赖。以下为同一台 Windows x64、Node.js 24 的本地重新打包值；不是 GitHub 发布流水线产物，线上文件以 [v0.3.1 Release](https://github.com/LOGO127/clarity-desk/releases/tag/v0.3.1) 的附件和校验值为准。

| 项目 | v0.3.1 本地字节数 | 与上表 v0.3.0 相比 |
| --- | --- | --- |
| 首屏 JavaScript | 210,766 | 不变 |
| 可选 Markdown / 公式导入模块 | 443,668 | 不变 |
| 按需加载的录音记录页面 | 6,310 | 增加少量按钮状态逻辑 |
| Windows x64 便携版 | 103,823,188 | +76 |
| Windows x64 安装版 | 104,068,357 | +155 |
| `win-unpacked` 全部文件 | 342,506,813 | +751 |
| `resources/app.asar` | 7,473,104 | +751 |
| Chromium 语言资源 | 2 个文件，1,178,693 | 不变 |

`npm run test:desktop`、`npm run dist:win` 和重建后 `node scripts/electron-smoke.cjs --packaged` 均通过。仍未测量常驻内存、冷启动时间，也未执行 NSIS 安装/卸载或真实双声源硬件验收；不能将修复描述为新一轮体积或内存下降。详细回归范围见 [本次维护记录](MAINTENANCE-20260907.md)。
