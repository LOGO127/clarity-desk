# 飞书公式居中：支持范围与验收

核对日期：2026-09-05。状态：**合成飞书文档的真实按钮写入、回读、内容保护、重复点击和飞书导出 PDF 排版已通过；网页刷新视觉检查待登录**。详见 [真实验收记录](FEISHU-ACCEPTANCE-20260905.md)。

本轮安全修正后：全量 55/55 单元测试、TypeScript、生产构建和普通 Electron 桌面回归通过。普通桌面回归不调用飞书写入；另行执行了显式授权的真实飞书验收脚本，不将两者混淆。

## 当前功能

在 Clarity Desk 中粘贴现有 docx/wiki 链接，程序读取块列表，仅对受支持的公式段落发送对齐样式更新，随后回读确认。它不是飞书工具栏插件，也不是把 Markdown 预览居中后重新粘贴。

| 实际存储形式 | 当前处理 |
| --- | --- |
| Text 块，全部有效元素为 equation（允许空白文字） | 发送 `update_text_style`，仅设置 `style.align = 2`、`fields = [1]` |
| 公式与普通文字同段 | 不处理，避免把正文一起居中 |
| 旧式 Equation 块（block_type 16） | 识别并计数；未居中的块暂不更新，结果报告未处理 |
| 公式截图、代码块、纯 LaTeX 文字 | 不识别为可更新的飞书公式 |
| 标题、列表等其他文本块中的公式 | 当前不自动改其段落样式 |

段落位于表格或分栏内时，对齐基准是所在容器，不等于整页中心。超宽公式、公式内部多行布局也不能仅靠段落对齐保证视觉居中。

## 本轮发现的问题

v0.2.0 曾对 Equation(16) 发送只有 style/fields 的 `update_text` 请求。但是官方文档把 `update_text.elements` 列为必填；`update_text_style` 的明确支持列表也不包含 Equation。旧单元测试复述了实现中的假设，不能证明接口接受它。

本轮停止发送这个未证实请求，不以复制/重建块作为绕过方式，以免改变公式内容、块 ID 或关联信息。不应据此推断飞书所有公式均不能居中：只含 equation 元素的 Text 段落是另一条有文档依据的路径。

结果区区分已提交和回读确认。提交成功不等于页面验收成功；零匹配、未支持类型、读取结构异常或回读不完整，均不能被描述为“全部公式已经居中”。

当前安装的 lark-cli v1.0.51 自动分页在后续页失败时可能返回已合并的部分结果。应用因此必须显式逐页读取并校验，不能把 `--page-all` 的成功退出视为已读完全文。参见官方 CLI 的 [分页实现](https://github.com/larksuite/cli/blob/v1.0.51/internal/client/pagination.go) 与 [客户端实现](https://github.com/larksuite/cli/blob/v1.0.51/internal/client/client.go)。

## 官方依据

- [批量更新块的内容](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/batch_update)：PATCH 路径、所需权限、`update_text_style` 支持类型、align/fields 和 `update_text.elements` 必填约束。
- [块的数据结构](https://open.feishu.cn/document/docs/docs/data-structure/block)：Text / TextElement / Equation 数据结构。
- [文档概述](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview)：块模型与操作能力范围。

使用相同页面的 `.md` 版本核对。文档依据不替代线上验收；飞书客户端与 API 返回的结构可能随版本变化。

## 真实验收还缺什么

已用获准新建的合成测试文档完成写入验证；还需要用户实际从大模型复制进飞书的公式，以及浏览器页面验收。完整标准如下：

1. 操作前读取公式块结构、内容与对齐方式，记录支持/跳过数量。
2. 在应用中点击一次居中；确认匹配公式的回读对齐值为 2。
3. 刷新飞书页面，人工或授权浏览器检查公式真实显示居中。
4. 确认正文、行内公式与公式内容没有变化。
5. 重复点击无额外内容变化；无权限或失败时没有假成功提示。

未取得测试文档和修改许可前，不写入用户的工作文档。以上未完成的项不得在 README、Release 或测试报告里标记为已通过。
