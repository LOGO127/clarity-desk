# 架构

本文描述当前 v0.3.0 开发代码，不代表该版本已经发布。Clarity Desk 是面向 Windows 的 Electron 桌面工具，核心流程为已有飞书文档的公式居中，以及本地录音与主动转写。

## 进程与模块边界

| 层 | 主要代码 | 职责 |
| --- | --- | --- |
| Renderer | `src/renderer/src/` | React 界面、页面状态、可选 Markdown 预览、浏览器音频采集与编码 |
| Preload | `src/preload/index.ts` | 通过 `contextBridge` 暴露操作级、带类型的 `window.clarity` API |
| Main | `src/main/index.ts` | IPC 入口、窗口与托盘、录音文件与元数据、系统密钥存储、飞书 CLI 和转写网络请求 |
| 主进程辅助模块 | `src/main/lark-cli.ts`、`recording-*.ts`、`transcript-checkpoint.ts`、`navigation-security.ts` | 可独立测试的接口构造、分页与结果判断、文件恢复、完整性与信任边界规则 |
| 共享契约 | `src/shared/types.ts` | IPC 输入输出、会话、录音切片与转写数据类型 |

Renderer 没有 Node.js 权限；Preload 不暴露通用文件读写、命令执行或原始 `ipcRenderer`。所有特权操作由主进程接收并校验。

## 轻量加载与打包

应用默认进入 `FormulaPage`，首屏只提供已有文档居中。`InterviewPage`、`SessionsPage`、`SettingsPage` 通过 React `lazy` 按页面加载；展开可选导入区域后才加载 `FormulaImport`、Markdown 解析和 KaTeX 样式。

Renderer 由 Vite 打包并使用 esbuild 压缩。React、Markdown、KaTeX 等界面依赖已编入静态产物，放在开发依赖中，避免再以完整运行依赖重复打包；主进程保留外置的 `zod`。Electron 语言资源仅保留 `zh-CN` 和 `en-US`。

这没有移除 Electron 自带的 Chromium / Node，也不等于内存占用或冷启动时间按同一比例下降。体积口径见 [轻量化记录](LIGHTWEIGHT.md)。

## 已有飞书文档居中

操作按钮在 Clarity Desk 中，不在飞书工具栏内。文档编辑权限和凭据由用户授权的 `lark-cli` 提供。

1. 主进程验证 docx/wiki URL，通过 `docs +fetch --api-version v2` 解析并校验文档 ID。
2. 使用原生块列表 API 显式逐页读取，每页最多 500 块。校验成功状态、块结构、`has_more` 和下一页游标；缺失/重复游标、请求失败或超过 100 页都会停止，不能将部分结果当成全文。
3. 只更新 `block_type: 2` 的 Text 段落：除空白文字外，全部元素必须为 `equation`。正文混排、图片、代码、纯 LaTeX 文字和其他块类型不自动改动。
4. 跳过已居中的段落，其余每批最多 50 个，发送 `update_text_style`，仅设置 `style.align = 2`、`fields = [1]`，不重写公式内容或重建块。
5. 再次完整读取并按原块 ID 核对对齐值。结果分别报告已提交、回读确认及未支持数量；回读不完整或中途失败时不报告全部成功。重试会重新读取当前状态，跳过已居中的段落。

旧式 Equation 块（`block_type: 16`）会被识别，但尚无已验证的样式更新契约。未居中的该类块被明确跳过；请求构造函数也拒绝为它生成写入请求。已经居中的该类块仅参与读取确认。

该流程不把文档正文传给 Renderer，界面只接收计数、状态、文档 ID 和消息。段落在表格或分栏内时，以所在容器为对齐基准；段落对齐不保证超宽公式或公式内部多行布局的视觉效果。接口支持范围和真实测试边界分别见 [兼容性说明](FEISHU-COMPATIBILITY.md) 与 [验收记录](FEISHU-ACCEPTANCE-20260905.md)；服务端回读和 PDF 检查不替代网页刷新验收。

## 可选 Markdown 导入

`formula-document.ts` 使用 remark 解析 Markdown。独立数学节点输出为 `<p align="center"><latex>...</latex></p>`，行内数学节点保留在原段落中。文本与属性进行 XML 转义，内容链接只接受 `http`、`https` 和 `mailto`。

用户可复制/导出 XML，或另行选择飞书新建、追加、覆盖。主进程将 XML 写入单次操作的临时目录，由 CLI 读取文件；完成后清理临时目录。此流程与直接修改已有文档的对齐样式独立，不能以本地预览居中证明线上文档已居中。

## 录音、完整性与恢复

`dual-track-recorder.ts` 管理浏览器音频和编码，`InterviewPage` 管理授权确认、声源检查及故障提示。点击开始后，在等待媒体授权前立即进入启动忙碌状态，阻止重复启动和页面切换；失败或取消授权后解除启动锁，成功后由录音状态继续保护导航。

1. 取得录音同意后，Chromium 获取所选麦克风；启用系统声音时，再获取 Windows 回环音频。系统声不是仅某个面试应用的声音。
2. Web Audio 混合两路输入，同时保留原始分轨。启用系统声音时录制麦克风、系统声、混音三轨；关闭时录制麦克风和混音两轨。
3. 录音开始后先保持窗口可见。每 400 毫秒采样音量，必需音轨都曾检测到声音且仍处于 `live` 状态，才允许点击“确认声音并最小化”。音量检测不识别说话人，也不能保证音质。
4. 每轨 `MediaRecorder` 约每秒产生数据，经串行写入队列和受限 IPC 追加到 `.partial` 文件。主进程按会话串行化文件与元数据操作。
5. 每十分钟或停止时结束分段；等待最终数据事件和所有写盘任务完成，再发布音频文件、更新 `metadata.json`。一条音轨失败时仍尝试保存其他健康音轨；设备断开、编码或写盘故障会锁定失败、提示并停止录音，清理计时器和媒体流。
6. 正常完成前按每个分段编号检查必需的非空音轨，包含中间缺段和最后一段；不能因前一段完整就把整场标记成功。

`recording-files.ts` 用硬链接把已有 `.partial` 字节发布为最终文件，避免覆盖已有音频。元数据写入失败后的重试可复用最终文件；发生冲突时保留原有最终文件和未发布的 partial。该发布方式依赖文件系统硬链接支持，失败时保留数据并报告错误，不降级为覆盖写入。

主进程先取得 `requestSingleInstanceLock`，再进行目录初始化和录音恢复。重复启动的进程退出，`second-instance` 只唤回已有窗口，避免把仍在录制的 partial 当作异常中断数据处理。

下次启动仅检查 `recording` / `failed` 会话，尝试恢复未登记的最终文件和 partial，再做逐段检查。此前 `failed` 的会话不会因为恢复了部分片段就升级为成功；异常中断且分段检查通过的会话会进入 `ready`，仍保留必须试听的提示。检查依据文件非空及音轨/分段元数据，不包含媒体解码和人声质量鉴定；恢复的 WebM 也可能缺少正常结束信息。

录音保存在用户文档目录的 `Clarity Desk/Sessions/`。转写与录音独立，转写失败不会删除音频。

## 主动转写与断点

主进程只在用户点击转写后，将混合音轨分段提交给 OpenAI `gpt-4o-transcribe-diarize`；可能产生 API 费用，不包含离线模型。API Key 通过 Electron `safeStorage` 加密保存；安全存储不可用时拒绝明文保存，已保存密钥不回传 Renderer。

每段响应需有非空文字及合法时间范围，时间戳按该录音段的起点偏移。每完成一段，原子写入 `transcript.partial.json`。重试仅复用版本、会话 ID、文件名、文件大小和片段结构校验通过的缓存，并保留所有有效缓存，包括失败位置之后已完成的段。

全部成功后生成 `transcript.json` / `transcript.md` 并清理断点。转写失败保留断点和音频，恢复到此前适用的 `ready`、`failed` 或 `transcribed` 状态，不把 API 错误当作录音丢失。

多段转写给说话人标签增加“片段 01 / 02”前缀。不同段的同名标签不能视为同一人；当前不自动映射为“我 / 面试官”。

## IPC 与导航隔离

- 窗口启用 `contextIsolation`、沙箱和 CSP，关闭 Node integration。
- 所有 IPC handler 使用统一入口，核对发送者属于主窗口、来自顶层 frame，且 URL 与受信 Renderer 页面匹配（忽略查询串和锚点）。
- 页面外部导航和新窗口请求被拦截，仅将 HTTPS 外链交给系统浏览器，不让外站接管有桥接权限的应用页面。
- 会话 ID、音轨类型、分段编号、文件名和关键操作参数在主进程校验；CLI 参数由操作专用函数构造，不向 Renderer 提供任意命令接口。
- 没有遥测、后台自动上传或应用内自动更新服务。开发回归可使用隔离录音目录；发布包不接受该开发环境变量覆盖真实目录。源码和打包 smoke 均显式传入 `--clarity-smoke-test` 与独立 `--user-data-dir`：测试开关在启动恢复前将录音根目录固定到该 profile 的 `smoke-recordings`，不扫描正常录音目录。

自动化测试和真实验收只能证明已覆盖场景。Windows 声卡/蓝牙组合、飞书结构与权限、外部转写服务以及异常恢复后的实际音频仍需对应环境验证。
