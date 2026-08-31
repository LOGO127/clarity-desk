import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'

export function SettingsPage({ notify }: { notify: (message: string, tone?: ToastTone) => void }) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lark, setLark] = useState<{ available: boolean; version?: string; authenticated?: boolean }>({ available: false })
  const [authenticating, setAuthenticating] = useState(false)

  async function refresh() {
    const [info, keyStatus, larkStatus] = await Promise.all([
      window.clarity.getAppInfo(),
      window.clarity.hasApiKey(),
      window.clarity.checkLarkCli()
    ])
    setAppInfo(info)
    setHasKey(keyStatus)
    setLark(larkStatus)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function saveKey() {
    setSaving(true)
    try {
      await window.clarity.saveApiKey(apiKey)
      setApiKey('')
      setHasKey(true)
      notify('API Key 已使用 Windows 安全存储加密。', 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeKey() {
    if (!window.confirm('确定删除本机保存的 API Key？已录制的文件不会被删除。')) return
    await window.clarity.deleteApiKey()
    setHasKey(false)
    notify('API Key 已删除。', 'success')
  }

  async function authenticateLark() {
    setAuthenticating(true)
    try {
      const result = await window.clarity.authenticateLark()
      notify(result.message, result.ok ? 'success' : 'error')
      await refresh()
    } finally {
      setAuthenticating(false)
    }
  }

  return (
    <div className="page settings-page">
      <section className="settings-section panel">
        <div className="settings-heading"><div className="settings-icon"><KeyRound size={20} /></div><div><h2>语音转写</h2><p>只有你主动转写某场会话时，混合音频才会上传。</p></div><span className={`connection-chip ${hasKey ? 'connected' : ''}`}>{hasKey ? <CheckCircle2 size={15} /> : null}{hasKey ? '已配置' : '未配置'}</span></div>
        <div className="settings-body">
          <div className="field">
            <label htmlFor="api-key">OpenAI API Key</label>
            <div className="inline-field"><input id="api-key" type="password" autoComplete="off" placeholder={hasKey ? '••••••••••••••••  已安全保存' : 'sk-...'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button className="button primary" onClick={saveKey} disabled={saving || apiKey.length < 20}>{saving ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}安全保存</button>{hasKey ? <button className="icon-button destructive" onClick={removeKey} title="删除密钥"><Trash2 size={17} /></button> : null}</div>
            <small className="field-help"><ShieldCheck size={14} />密钥通过 Electron safeStorage 调用 Windows DPAPI 加密，不会写入日志或 Git 仓库。</small>
          </div>
        </div>
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><div className="settings-icon lark"><span>飞</span></div><div><h2>飞书文档</h2><p>公式排版工具通过 lark-cli 以你的身份新建或更新文档。</p></div><span className={`connection-chip ${lark.authenticated ? 'connected' : ''}`}>{lark.authenticated ? <CheckCircle2 size={15} /> : null}{lark.authenticated ? '已授权' : lark.available ? '待授权' : '未安装'}</span></div>
        <div className="settings-body lark-body">
          <div><strong>{lark.available ? lark.version || '已检测到 lark-cli' : '没有检测到 lark-cli'}</strong><p>{lark.available ? '授权过程会打开浏览器，由飞书直接处理登录。' : '仍然可以使用公式预览、复制与 XML 导出功能。'}</p></div>
          {lark.available && !lark.authenticated ? <button className="button secondary" onClick={authenticateLark} disabled={authenticating}>{authenticating ? <LoaderCircle className="spin" size={16} /> : <ExternalLink size={16} />}{authenticating ? '等待浏览器授权…' : '连接飞书账号'}</button> : <button className="button ghost" onClick={refresh}><RefreshCw size={15} />重新检测</button>}
        </div>
      </section>

      <section className="settings-section panel about-section">
        <div className="settings-heading"><div className="settings-icon"><ShieldCheck size={20} /></div><div><h2>存储与隐私</h2><p>Clarity Desk 不设置自动上传、遥测或后台分析。</p></div></div>
        <dl className="about-list"><div><dt>录音目录</dt><dd>{appInfo?.recordingsDirectory || '正在读取…'}</dd></div><div><dt>安全存储</dt><dd>{appInfo?.secureStorageAvailable ? '可用' : '不可用（将拒绝保存密钥）'}</dd></div><div><dt>应用版本</dt><dd>v{appInfo?.version || '0.1.0'} · {appInfo?.platform || 'Windows'}</dd></div></dl>
      </section>
    </div>
  )
}
