import { CheckCircle2, ClipboardPaste, Copy, Download, ExternalLink, FileCode2, LoaderCircle, Send, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { ToastTone } from '../components/Toast'
import { convertMarkdownForLark, suggestDocumentTitle } from '../lib/formula-document'

const example = `# 梯度下降简析

梯度下降通过沿损失函数的负梯度方向迭代参数。学习率记作 $\\eta$。

$$
\\theta_{t+1} = \\theta_t - \\eta \\nabla_\\theta J(\\theta_t)
$$

当梯度接近零时，算法趋于稳定。`

export function FormulaPage({ notify }: { notify: (message: string, tone?: ToastTone) => void }) {
  const [markdown, setMarkdown] = useState(example)
  const [title, setTitle] = useState('梯度下降简析')
  const [tab, setTab] = useState<'preview' | 'xml'>('preview')
  const [mode, setMode] = useState<'create' | 'append' | 'overwrite'>('create')
  const [docUrl, setDocUrl] = useState('')
  const [writing, setWriting] = useState(false)
  const [larkStatus, setLarkStatus] = useState<{ available: boolean; authenticated?: boolean }>({ available: false })
  const result = useMemo(() => convertMarkdownForLark(markdown, mode === 'create' ? title : undefined), [markdown, title, mode])

  useEffect(() => {
    void window.clarity.checkLarkCli().then(setLarkStatus)
  }, [])

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
        <div className={`integration-state ${larkStatus.authenticated ? 'ready' : ''}`}>
          <span className="state-dot" />
          {larkStatus.authenticated ? '飞书已连接' : larkStatus.available ? '飞书待授权' : '仅导出模式'}
        </div>
      </div>

      <div className="editor-grid">
        <section className="editor-panel panel">
          <div className="panel-toolbar">
            <div><span className="section-label">INPUT</span><strong>Markdown 原文</strong></div>
            <button className="small-action" onClick={pasteFromClipboard}><ClipboardPaste size={16} />读取剪贴板</button>
          </div>
          <textarea
            className="markdown-editor"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            spellCheck={false}
            aria-label="Markdown 原文"
          />
        </section>

        <section className="preview-panel panel">
          <div className="panel-toolbar preview-toolbar">
            <div className="segmented-control">
              <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>排版预览</button>
              <button className={tab === 'xml' ? 'active' : ''} onClick={() => setTab('xml')}>飞书 XML</button>
            </div>
            <div className="toolbar-actions">
              <button className="icon-text-button" onClick={copyXml}><Copy size={15} />复制</button>
              <button className="icon-text-button" onClick={() => window.clarity.saveTextFile(`${title || 'document'}.xml`, result.xml)}>
                <Download size={15} />导出
              </button>
            </div>
          </div>
          {tab === 'preview' ? (
            <article className="markdown-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {result.normalizedMarkdown}
              </ReactMarkdown>
            </article>
          ) : (
            <pre className="xml-preview"><code>{result.xml}</code></pre>
          )}
        </section>
      </div>

      <div className="formula-footnote">
        <FileCode2 size={17} />
        <span>仅独占一段的公式会居中；正文中的 $...$ 行内公式不会被移动。</span>
        <a href="https://open.feishu.cn/" onClick={(event) => event.preventDefault()}>飞书开放平台 <ExternalLink size={13} /></a>
      </div>
    </div>
  )
}
