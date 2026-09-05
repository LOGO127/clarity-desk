import { AlignCenter, CheckCircle2, ClipboardPaste, FileCode2, Link2, LoaderCircle, ScanSearch } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { LarkCenterFormulasResult } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'

const FormulaImport = lazy(() => import('./FormulaImport').then((module) => ({ default: module.FormulaImport })))

export function FormulaPage({ notify, onConfigure }: {
  notify: (message: string, tone?: ToastTone) => void
  onConfigure: () => void
}) {
  const [showImport, setShowImport] = useState(false)
  const [existingDocUrl, setExistingDocUrl] = useState('')
  const [centering, setCentering] = useState(false)
  const busy = useRef(false)
  const [centerResult, setCenterResult] = useState<LarkCenterFormulasResult | null>(null)
  const [checking, setChecking] = useState(true)
  const [larkStatus, setLarkStatus] = useState<{ available: boolean; authenticated?: boolean }>({ available: false })

  const refreshConnection = useCallback(async () => {
    setChecking(true)
    try {
      setLarkStatus(await window.clarity.checkLarkCli())
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setChecking(false)
    }
  }, [notify])

  useEffect(() => { void refreshConnection() }, [refreshConnection])

  async function pasteExistingDocUrl() {
    try {
      const value = (await window.clarity.readClipboardText()).trim()
      if (!value) return notify('剪贴板里没有飞书文档链接。', 'info')
      setExistingDocUrl(value)
      setCenterResult(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  async function centerExistingFormulas() {
    if (busy.current) return
    if (!larkStatus.authenticated) return notify('请先连接飞书账号。', 'error')
    busy.current = true
    setCentering(true)
    setCenterResult(null)
    try {
      const targetUrl = existingDocUrl.trim() || (await window.clarity.readClipboardText()).trim()
      if (!targetUrl) return notify('请先复制要处理的飞书文档链接。', 'info')
      setExistingDocUrl(targetUrl)
      const response = await window.clarity.centerLarkFormulas({ docUrl: targetUrl })
      setCenterResult(response)
      notify(response.message, response.ok ? 'success' : response.status === 'partial' ? 'info' : 'error')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      busy.current = false
      setCentering(false)
    }
  }

  return (
    <div className="page formula-page">
      <section className="formula-simple panel">
        <div className="formula-simple-heading">
          <div><h2>飞书文档里的公式，一键居中</h2><p>粘贴已有 docx 或 wiki 链接，批量居中仅含公式的文本段落。</p></div>
          <span className={`integration-state ${larkStatus.authenticated ? 'ready' : ''}`}>
            <span className="state-dot" />{checking ? '正在连接…' : larkStatus.authenticated ? '已连接' : '未连接'}
          </span>
        </div>
        <div className="field">
          <label htmlFor="existing-document-url">飞书文档链接</label>
          <div className="document-link-input">
            <Link2 size={17} />
            <input id="existing-document-url" placeholder="https://your-team.feishu.cn/docx/…"
              value={existingDocUrl} disabled={centering}
              onChange={(event) => { setExistingDocUrl(event.target.value); setCenterResult(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !centering) void centerExistingFormulas() }} />
            <button className="small-action" onClick={pasteExistingDocUrl} disabled={centering}><ClipboardPaste size={15} />粘贴</button>
          </div>
        </div>
        <div className="formula-simple-actions">
          <button className="button primary" onClick={centerExistingFormulas} disabled={centering || checking || !larkStatus.authenticated}>
            {centering ? <LoaderCircle className="spin" size={18} /> : <AlignCenter size={18} />}
            {centering ? '正在居中并校验…' : existingDocUrl.trim() ? '一键居中' : '从剪贴板一键居中'}
          </button>
          {!checking && !larkStatus.authenticated ? (
            <button className="text-button" onClick={onConfigure}>{larkStatus.available ? '连接飞书账号' : '首次使用：连接飞书'}</button>
          ) : null}
        </div>
        <p className="formula-simple-note">只改对齐，不改公式内容。正文、行内公式、图片和代码不处理；旧式公式块会报告为暂不支持。真实飞书文档效果仍待验收。</p>
      </section>

      {centerResult ? (
        <section className={`center-result panel ${centerResult.status}`} aria-live="polite">
          <div className="result-heading">
            {centerResult.ok ? <CheckCircle2 size={22} /> : <ScanSearch size={22} />}
            <div><strong>{centerResult.ok ? '处理完成' : centerResult.status === 'partial' ? '部分完成，可安全重试' : '处理未完成'}</strong><span>{centerResult.message}</span></div>
          </div>
          <div className="result-metrics">
            <div><strong>{centerResult.totalFormulaCount}</strong><span>独立公式</span></div>
            <div><strong>{centerResult.submittedFormulaCount}</strong><span>已提交更新</span></div>
            <div><strong>{centerResult.updatedFormulaCount}</strong><span>本次确认居中</span></div>
            <div><strong>{centerResult.verifiedCenteredCount}</strong><span>共确认居中</span></div>
          </div>
        </section>
      ) : null}

      <div className="optional-import">
        <button className="text-button" aria-expanded={showImport} onClick={() => setShowImport((current) => !current)}>
          <FileCode2 size={15} />{showImport ? '收起 Markdown 导入' : 'Markdown 导入（可选）'}
        </button>
        {showImport ? (
          <Suspense fallback={<p role="status">正在加载导入工具…</p>}>
            <FormulaImport notify={notify} larkStatus={larkStatus} />
          </Suspense>
        ) : null}
      </div>
    </div>
  )
}
