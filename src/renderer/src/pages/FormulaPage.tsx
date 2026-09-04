import {
  AlignCenter,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  FileCode2,
  Link2,
  LoaderCircle,
  ScanSearch,
  Send,
  ShieldCheck,
  WandSparkles
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { LarkCenterFormulasResult } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'
import { convertMarkdownForLark, suggestDocumentTitle } from '../lib/formula-document'

const example = `# 梯度下降简析

梯度下降通过沿损失函数的负梯度方向迭代参数。学习率记作 $\\eta$。

$$
\\theta_{t+1} = \\theta_t - \\eta \\nabla_\\theta J(\\theta_t)
$$

当梯度接近零时，算法趋于稳定。`

export function FormulaPage({ notify }: { notify: (message: string, tone?: ToastTone) => void }) {
  const [workflow, setWorkflow] = useState<'center' | 'import'>('center')
  const [existingDocUrl, setExistingDocUrl] = useState('')
  const [centering, setCentering] = useState(false)
  const [centerResult, setCenterResult] = useState<LarkCenterFormulasResult | null>(null)
  const [markdown, setMarkdown] = useState(example)
  const [title, setTitle] = useState('梯度下降简析')
  const [previewTab, setPreviewTab] = useState<'preview' | 'xml'>('preview')
  const [mode, setMode] = useState<'create' | 'append' | 'overwrite'>('create')
  const [docUrl, setDocUrl] = useState('')
  const [writing, setWriting] = useState(false)
  const [larkStatus, setLarkStatus] = useState<{ available: boolean; authenticated?: boolean }>({ available: false })
  const result = useMemo(() => convertMarkdownForLark(markdown, mode === 'create' ? title : undefined), [markdown, title, mode])

  useEffect(() => {
    void window.clarity.checkLarkCli().then(setLarkStatus)
  }, [])

  async function pasteExistingDocUrl() {
    const value = (await window.clarity.readClipboardText()).trim()
    if (!value) return notify('剪贴板里没有飞书文档链接。', 'info')
    setExistingDocUrl(value)
    setCenterResult(null)
    notify('已粘贴文档链接。', 'success')
  }

  async function centerExistingFormulas() {
    if (!larkStatus.available) return notify('没有检测到 lark-cli，请先在设置中安装。', 'error')
    if (!larkStatus.authenticated) return notify('请先在设置中完成飞书授权。', 'error')
    let targetUrl = existingDocUrl.trim()
    if (!targetUrl) {
      targetUrl = (await window.clarity.readClipboardText()).trim()
      if (!targetUrl) return notify('请先复制要处理的飞书文档链接。', 'error')
      setExistingDocUrl(targetUrl)
    }

    setCentering(true)
    setCenterResult(null)
    try {
      const response = await window.clarity.centerLarkFormulas({ docUrl: targetUrl })
      setCenterResult(response)
      notify(response.message, response.ok ? 'success' : 'error')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setCentering(false)
    }
  }

  async function pasteFromClipboard() {
    const value = await window.clarity.readClipboardText()
    if (!value.trim()) return notify('剪贴板里没有文本。', 'info')
    setMarkdown(value)
    setTitle(suggestDocumentTitle(value))
    notify('已读取剪贴板。', 'success')
  }

  async function copyXml() {
    await window.clarity.writeClipboardText(result.xml)
    notify('飞书 XML 已复制。', 'success')
  }

  async function writeToLark() {
    if (!larkStatus.available) return notify('没有检测到 lark-cli，可先导出 XML。', 'error')
    if (!larkStatus.authenticated) return notify('请先在设置中完成飞书授权。', 'error')
    if (mode !== 'create' && !docUrl.trim()) return notify('请粘贴目标飞书文档链接。', 'error')
    setWriting(true)
    try {
      const response = await window.clarity.writeToLark({ mode, docUrl: docUrl.trim() || undefined, xml: result.xml })
      if (!response.ok) throw new Error(response.message)
      if (response.url) await window.clarity.writeClipboardText(response.url)
      notify(response.url ? `${response.message}链接已复制。` : response.message, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="page formula-page">
      <div className="formula-workflow-tabs" role="tablist" aria-label="公式工具模式">
        <button className={workflow === 'center' ? 'active' : ''} onClick={() => setWorkflow('center')}>
          <AlignCenter size={16} />已有文档一键居中
        </button>
        <button className={workflow === 'import' ? 'active' : ''} onClick={() => setWorkflow('import')}>
          <FileCode2 size={16} />Markdown 导入（可选）
        </button>
      </div>

      {workflow === 'center' ? (
        <div className="center-workflow">
          <section className="center-hero panel">
            <div className="center-hero-icon"><AlignCenter size={29} /></div>
            <div className="center-hero-copy">
              <span className="section-label">ONE CLICK ALIGNMENT</span>
              <h2>把现有飞书文档里的独立公式一次居中</h2>
              <p>粘贴 docx 或 wiki 链接。程序只修改公式所在块的对齐样式，不重建文档，也不改正文内容。</p>
            </div>
            <div className={`integration-state center-connection ${larkStatus.authenticated ? 'ready' : ''}`}>
              <span className="state-dot" />
              {larkStatus.authenticated ? '飞书已连接' : larkStatus.available ? '需要授权' : '未安装工具链'}
            </div>
          </section>

          <section className="center-action panel">
            <div className="field grow">
              <label htmlFor="existing-document-url">飞书文档链接</label>
              <div className="document-link-input">
                <Link2 size={17} />
                <input
                  id="existing-document-url"
                  placeholder="https://your-team.feishu.cn/docx/... 或 /wiki/..."
                  value={existingDocUrl}
                  onChange={(event) => {
                    setExistingDocUrl(event.target.value)
                    setCenterResult(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !centering) void centerExistingFormulas()
                  }}
                />
                <button className="small-action" onClick={pasteExistingDocUrl}><ClipboardPaste size={15} />粘贴</button>
              </div>
            </div>
            <button className="button primary center-button" onClick={centerExistingFormulas} disabled={centering}>
              {centering ? <LoaderCircle className="spin" size={18} /> : <AlignCenter size={18} />}
              {centering ? '正在扫描并校验' : existingDocUrl.trim() ? '一键居中全部独立公式' : '从剪贴板一键居中'}
            </button>
          </section>

          {centerResult ? (
            <section className={`center-result panel ${centerResult.ok ? 'success' : 'failed'}`} aria-live="polite">
              <div className="result-heading">
                {centerResult.ok ? <CheckCircle2 size={22} /> : <ScanSearch size={22} />}
                <div><strong>{centerResult.ok ? '处理完成' : '处理未完成'}</strong><span>{centerResult.message}</span></div>
              </div>
              <div className="result-metrics">
                <div><strong>{centerResult.totalFormulaCount}</strong><span>检测到的独立公式</span></div>
                <div><strong>{centerResult.updatedFormulaCount}</strong><span>本次成功居中</span></div>
                <div><strong>{centerResult.alreadyCenteredCount}</strong><span>原本已经居中</span></div>
                <div><strong>{centerResult.verifiedCenteredCount}</strong><span>回读确认居中</span></div>
              </div>
            </section>
          ) : null}

          <section className="center-safety-grid">
            <div className="panel safety-card">
              <ShieldCheck size={21} />
              <div><strong>只改对齐样式</strong><span>不会覆盖、追加或重新生成现有正文。</span></div>
            </div>
            <div className="panel safety-card">
              <WandSparkles size={21} />
              <div><strong>自动避开行内公式</strong><span>含普通文字的段落保持原样，只处理独占一段的公式。</span></div>
            </div>
            <div className="panel safety-card">
              <ScanSearch size={21} />
              <div><strong>修改后回读校验</strong><span>完成后再次读取公式块，确认居中样式真正生效。</span></div>
            </div>
          </section>
        </div>
      ) : (
        <div className="import-workflow">
          <div className="formula-toolbar panel">
            <div className="field grow">
              <label htmlFor="document-title">文档标题</label>
              <input id="document-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
            </div>
            <div className="field mode-field">
              <label htmlFor="write-mode">写入方式</label>
              <select id="write-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                <option value="create">新建飞书文档</option>
                <option value="append">追加到文档末尾</option>
                <option value="overwrite">覆盖文档正文</option>
              </select>
            </div>
            {mode !== 'create' ? (
              <div className="field doc-url-field">
                <label htmlFor="document-url">飞书文档链接</label>
                <input id="document-url" placeholder="https://.../docx/..." value={docUrl} onChange={(event) => setDocUrl(event.target.value)} />
              </div>
            ) : null}
            <button className="button primary write-button" onClick={writeToLark} disabled={writing || !markdown.trim()}>
              {writing ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
              {writing ? '正在写入' : '写入飞书'}
            </button>
          </div>

          <div className="formula-stats" aria-label="解析统计">
            <div><WandSparkles size={17} /><strong>{result.stats.displayFormulaCount}</strong><span>个独立公式将居中</span></div>
            <div><CheckCircle2 size={17} /><strong>{result.stats.inlineFormulaCount}</strong><span>个行内公式保持原位</span></div>
          </div>

          <div className="editor-grid">
            <section className="editor-panel panel">
              <div className="panel-toolbar">
                <div><span className="section-label">INPUT</span><strong>Markdown 原文</strong></div>
                <button className="small-action" onClick={pasteFromClipboard}><ClipboardPaste size={16} />读取剪贴板</button>
              </div>
              <textarea className="markdown-editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck={false} aria-label="Markdown 原文" />
            </section>

            <section className="preview-panel panel">
              <div className="panel-toolbar preview-toolbar">
                <div className="segmented-control">
                  <button className={previewTab === 'preview' ? 'active' : ''} onClick={() => setPreviewTab('preview')}>排版预览</button>
                  <button className={previewTab === 'xml' ? 'active' : ''} onClick={() => setPreviewTab('xml')}>飞书 XML</button>
                </div>
                <div className="toolbar-actions">
                  <button className="icon-text-button" onClick={copyXml}><Copy size={15} />复制</button>
                  <button className="icon-text-button" onClick={() => window.clarity.saveTextFile(`${title || 'document'}.xml`, result.xml)}><Download size={15} />导出</button>
                </div>
              </div>
              {previewTab === 'preview' ? (
                <article className="markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{result.normalizedMarkdown}</ReactMarkdown>
                </article>
              ) : <pre className="xml-preview"><code>{result.xml}</code></pre>}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
