<p align="center">
  <img src="build/icon.svg" width="112" alt="Clarity Desk 品牌符号">
</p>

<h1 align="center">Clarity Desk</h1>

<p align="center"><strong>把 AI 文档排得更清楚，把每场面试复盘得更明白。</strong></p>

<p align="center">
  自动识别 Markdown 公式并按飞书规则排版；同时录下麦克风、面试官系统声和混合音轨，<br>
  在你主动发起后生成带说话人时间轴的面试文字稿。
</p>

<p align="center">
  <a href="https://github.com/LOGO127/clarity-desk/releases/tag/v0.1.0"><img alt="Release" src="https://img.shields.io/badge/release-v0.1.0-6757e5?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-2563eb?style=flat-square">
  <a href="https://github.com/LOGO127/clarity-desk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/LOGO127/clarity-desk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-17211c?style=flat-square"></a>
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local--first-0f9f78?style=flat-square">
</p>

<p align="center">
  <a href="#下载与使用">下载</a> ·
  <a href="#当前能力">功能</a> ·
  <a href="#面试录音怎么工作">录音</a> ·
  <a href="#隐私边界">隐私</a> ·
  <a href="#兼容性与限制">限制</a> ·
  <a href="docs/ARCHITECTURE.md">架构</a>
</p>

<p align="center">
  <img src="docs/images/home.png" width="960" alt="Clarity Desk 首页：公式排版、双声道面试记录和最近复盘">
</p>

<p align="center"><sub>两个高频场景，一个安静的工作台。窗口永不置顶，开始录音后自动最小化。</sub></p>

> [!IMPORTANT]
> 当前为 `v0.1.0` 首个开源版本，主要面向 Windows 10/11 x64。录音前请明确告知面试官用途、保存方式并取得同意。首个版本尚未代码签名，Windows SmartScreen 可能显示“未知发布者”。

## 为什么做这个项目

大模型已经很擅长生成带公式的 Markdown，但把内容复制进飞书后，独立公式和行内公式往往需要逐个整理。飞书没有“一键把所有独立公式居中、同时保留行内公式位置”的入口，一篇稍长的技术文档就会变成重复劳动。

面试复盘也有类似问题：只靠记忆很难还原追问、停顿和回答细节；普通录音又经常只录到自己的麦克风，或者把双方声音混在一起，后续很难判断是谁说了什么。

Clarity Desk 把这两个具体问题放进同一个本地优先桌面工具：

- **写文档时**，粘贴 Markdown，立即看到公式识别数量和飞书排版预览；
- **做面试时**，分别保存自己的声音、面试官系统声和可转写混合音轨；
- **需要复盘时**，由你决定是否把混合音轨发送到 OpenAI 做说话人分离转写。

## 当前能力

| 能力 | 当前实现 |
| --- | --- |
| 公式识别 | 支持 `$...$`、`\(...\)`、`$$...$$` 与 `\[...\]` |
| 飞书排版 | 独占一段的公式居中；正文行内公式保持原位 |
| 文档结构 | 保留标题、列表、引用、代码块、链接、图片与 GFM 表格 |
| 飞书写入 | 预览、复制/导出 XML；通过 `lark-cli` 新建、追加或覆盖文档 |
| 面试录音 | 麦克风、系统声音、混合音轨三路独立 Opus/WebM |
| 录音可靠性 | 每秒追加到磁盘、每 10 分钟切片、异常退出后恢复 `.partial` 片段 |
| 非遮挡设计 | 普通窗口、永不置顶；录音开始后自动最小化，托盘可安全停止 |
| 面试转写 | OpenAI `gpt-4o-transcribe-diarize` 说话人时间轴，导出 JSON 与 Markdown |
| 密钥保护 | OpenAI API Key 使用 Electron `safeStorage` / Windows DPAPI 加密 |
| 数据边界 | 无遥测、无自动上传；只有用户主动转写或写入飞书时联网 |

## 公式排版

把大模型输出复制到左侧，Clarity Desk 会解析 Markdown AST，而不是用简单的全局替换猜测公式位置。

```markdown
梯度下降的学习率记作 $\eta$。

$$
\theta_{t+1}=\theta_t-\eta\nabla_\theta J(\theta_t)
$$
```

处理后：

- `$\eta$` 仍然跟在正文中；
- 独立公式输出为 `<p align="center"><latex>...</latex></p>`；
- 原始 HTML 会转义，链接协议会校验，避免把不可信内容直接注入 XML。

<p align="center">
  <img src="docs/images/formula-studio.png" width="960" alt="Clarity Desk 公式排版工作台：左侧 Markdown，右侧居中公式预览">
</p>

### 写入飞书

预览、复制和 XML 导出不需要账号。直接新建、追加或覆盖飞书文档是可选能力，需要安装飞书命令行工具：

```powershell
npm install -g @larksuite/cli
lark-cli auth login --domain docs
```

随后在“设置 → 飞书文档”中重新检测。Clarity Desk 使用版本化的 `docs v2` XML 工作流，授权由飞书处理，应用不会保存飞书密码或访问令牌。

## 面试录音怎么工作

```text
麦克风 ───────────────> microphone-0000.webm ─┐
                                               ├─> 本地会话目录
Windows 系统声音 ─────> system-0000.webm ─────┤
                                               │
麦克风 + 系统声音 ────> mixed-0000.webm ──────┘
                                      │
                         用户主动点击“开始转写”
                                      │
                                      └─> 说话人时间轴 / Markdown / JSON
```

三路录音并不是录完后才一次性保存。`MediaRecorder` 每秒产生片段，主进程通过受限 IPC 追加到 `.partial` 文件；正常停止后再原子地完成切片。如果应用异常退出，下次启动会恢复已落盘片段并提醒试听确认。

<p align="center">
  <img src="docs/images/interview-setup.png" width="47%" alt="面试录音准备界面：麦克风、系统声和录音同意确认">
  <img src="docs/images/recording-live.png" width="47%" alt="录音进行界面：三条音轨状态与停止按钮">
</p>

开始前建议：

1. 戴上耳机，避免面试官声音从扬声器回到麦克风；
2. 关闭系统通知音，减少系统声轨中的无关声音；
3. 明确说明录音只用于个人复盘，并取得同意；
4. 先做一次 10 秒测试，确认麦克风与系统声轨都有数据。

推荐告知话术：

> 为了面试结束后复盘，我想录音并转成文字，仅供个人使用、不对外传播，可以吗？

## 下载与使用

### Windows 软件包

从 [v0.1.0 Release](https://github.com/LOGO127/clarity-desk/releases/tag/v0.1.0) 选择一种方式：

| 下载文件 | 使用方式 | 适合场景 |
| --- | --- | --- |
| `Clarity-Desk-Portable-0.1.0-x64.exe` | 下载后双击运行，无需安装 | 首次体验，推荐 |
| `Clarity-Desk-Setup-0.1.0-x64.exe` | 图形化安装，可选择目录并创建快捷方式 | 长期使用 |
| `SHA256SUMS.txt` | 核对下载文件完整性 | SmartScreen 提示时检查来源 |

便携版首次启动会把 Electron 运行库释放到 Windows 临时目录，等待数秒属于正常现象。

> [!NOTE]
> 当前发布包尚未购买 Windows 代码签名证书。请只从本仓库 Releases 下载，并核对同一 Release 中的 SHA-256。

### 第一次录音

1. 打开“面试录音”，选择正确的麦克风；
2. 保持“同时录制系统声音”开启；
3. 确认已经取得录音同意；
4. 点击“开始录音并最小化”；
5. 面试结束后从任务栏或托盘打开 Clarity Desk，停止并保存。

录音默认保存在：

```text
文档/Clarity Desk/Sessions/<session-id>/
├── metadata.json
├── microphone-0000.webm
├── system-0000.webm
├── mixed-0000.webm
├── transcript.json      # 主动转写后生成
└── transcript.md        # 主动转写后生成
```

### 开启语音转写

在“设置 → 语音转写”中填写 OpenAI API Key。密钥只以 Windows 加密后的形式保存。转写会上传当前会话的 **混合音轨切片**，可能产生 API 费用；原始麦克风与系统声轨不会自动上传。

## 隐私边界

Clarity Desk 是本地优先软件，但不是“永不联网”软件。联网行为由用户显式动作触发：

| 数据行为 | 是否发生 |
| --- | :---: |
| 自动上传录音或文字稿 | 否 |
| 遥测、埋点或后台分析 | 否 |
| 本地保存三路录音 | 是 |
| 主动转写时上传混合音轨到 OpenAI | 是 |
| 主动写入飞书时调用 `lark-cli` | 是 |
| 将 OpenAI API Key 明文保存 | 否 |
| 卸载时静默删除用户录音 | 否 |

完整边界见 [PRIVACY.md](PRIVACY.md)，安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 兼容性与限制

| 项目 | 当前状态 |
| --- | --- |
| 操作系统 | Windows 10/11 x64 |
| 发布状态 | `v0.1.0`，适合个人试用和受控测试 |
| Windows 签名 | 暂无代码签名 |
| 系统声范围 | 捕获默认输出设备的整路回环声音，不是单个会议进程 |
| 面试官识别 | 转写服务返回通用说话人标签，尚未自动命名为“我/面试官” |
| 离线转写 | 尚未实现；当前转写需要 OpenAI API Key 与网络 |
| 飞书直写 | 依赖兼容的 `@larksuite/cli` 和用户授权 |
| macOS | 尚未支持系统音频录制 |

“应用能录音”不等于“任何声卡、蓝牙耳机和会议软件组合都完全一致”。正式面试前请务必做短录音测试。恢复出的 WebM 可能缺少干净的尾部索引，多数播放器能够读取，但仍应先试听确认完整性。

## 验证状态

当前版本不是以“没有报错”作为完成标准，而是完成了以下检查：

| 检查 | `v0.1.0` 结果 |
| --- | --- |
| 自动化测试 | 3 个测试文件、11 项测试通过 |
| TypeScript | 主进程、预加载与 React 渲染进程类型检查通过 |
| 依赖审计 | `npm audit`：0 个已知漏洞 |
| 飞书格式 | `docs +create` 与 `docs +update` v2 XML dry-run 通过 |
| 三路录音 | 麦克风、Windows 系统提示音、混合音轨实机写入通过 |
| 非遮挡行为 | 普通窗口、永不置顶、开始录音后自动最小化实测通过 |
| 异常恢复 | 录制中强制结束进程，重启后恢复三路 `.partial` 文件通过 |
| Windows 发布包 | 安装版与便携版构建通过，便携版黑盒启动通过 |

这些检查不能证明软件不存在任何 bug。硬件、会议软件、飞书 CLI 和外部转写服务仍可能带来环境差异；欢迎提交可复现 Issue。

## 从源码运行

需要 Windows 10/11、Node.js 22.12+ 与 npm 10+：

```powershell
git clone https://github.com/LOGO127/clarity-desk.git
cd clarity-desk
npm ci
npm run dev
```

质量检查：

```powershell
npm test
npm run typecheck
npm run build
```

生成 Windows 安装版和便携版：

```powershell
npm run dist:win
```

产物位于 `release/`。详细的进程边界、录音数据流和安全设计见 [架构文档](docs/ARCHITECTURE.md)。

## 项目结构

```text
src/
├── main/                 # 文件、托盘、异常恢复、转写和飞书 CLI
├── preload/              # 类型化、最小化的 contextBridge API
├── renderer/             # React UI、公式转换和三路 MediaRecorder
└── shared/               # IPC 与会话数据类型

docs/                     # 架构说明与真实界面截图
.github/                  # CI、Release、Dependabot 与 Issue 模板
build/                    # 应用图标
```

## 路线图

- `v0.2`：本地 `faster-whisper` 离线转写后端
- `v0.3`：说话人重命名、参考音频与“我/面试官”自动映射
- `v0.4`：会话搜索、标签、删除与保留策略
- `v0.5`：单进程系统音频捕获，减少通知音与其他应用干扰
- `v0.6`：macOS 系统音频与多语言界面

路线图表达方向，不代表交付承诺。当前实现以 [Releases](https://github.com/LOGO127/clarity-desk/releases) 与测试结果为准。

## 参与开发

问题报告和改进建议请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

提交 Issue 时请附上：

- Clarity Desk、Windows、会议软件与 `lark-cli` 版本；
- 使用非敏感测试数据的复现步骤；
- 已脱敏的错误信息。

请勿上传真实面试录音、API Key、飞书令牌或包含个人信息的文字稿。

## 品牌与声明

Clarity Desk 是独立开源项目，与飞书、OpenAI 或任何会议软件官方无隶属、授权或背书关系。飞书、OpenAI 及其他产品名称与商标归各自权利人所有。

## License

[MIT](LICENSE) © 2026 Clarity Desk contributors.
