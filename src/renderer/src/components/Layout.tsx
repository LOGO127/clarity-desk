import {
  Clock3,
  History,
  LayoutDashboard,
  Mic2,
  Settings2,
  ShieldCheck,
  Sigma,
  Sparkles
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Page } from '../App'

const navigation = [
  { id: 'home' as const, label: '概览', icon: LayoutDashboard },
  { id: 'formula' as const, label: '公式居中', icon: Sigma },
  { id: 'interview' as const, label: '面试录音', icon: Mic2 },
  { id: 'sessions' as const, label: '复盘记录', icon: History },
  { id: 'settings' as const, label: '设置', icon: Settings2 }
]

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  home: { title: '晚上好', subtitle: '把文档整理与面试复盘做得更清楚。' },
  formula: { title: '飞书文档公式一键居中', subtitle: '粘贴已有文档链接，一次居中全部独立公式。' },
  interview: { title: '面试录音', subtitle: '三音轨备份，窗口最小化后持续录制。' },
  sessions: { title: '复盘记录', subtitle: '录音、文字稿和导出文件都保存在本地。' },
  settings: { title: '设置', subtitle: '连接转写服务与飞书工具链。' }
}

interface LayoutProps {
  page: Page
  recording: boolean
  onNavigate: (page: Page) => void
  children: ReactNode
}

export function Layout({ page, recording, onNavigate, children }: LayoutProps) {
  const heading = pageTitles[page]
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div>
            <div className="brand-name">Clarity Desk</div>
            <div className="brand-tagline">清晰，从这里开始</div>
          </div>
        </div>

        <nav className="navigation" aria-label="主要导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => onNavigate(id)}
              disabled={recording && id !== 'interview'}
              title={recording && id !== 'interview' ? '请先结束当前录音' : undefined}
            >
              <Icon size={19} strokeWidth={2} />
              <span>{label}</span>
              {id === 'interview' && recording ? <span className="recording-dot" /> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <ShieldCheck size={20} />
          <div>
            <strong>本地优先</strong>
            <span>录音默认保存在你的文档目录</span>
          </div>
        </div>
        <div className="sidebar-version">Open source · MIT</div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div>
            <h1>{heading.title}</h1>
            <p>{heading.subtitle}</p>
          </div>
          <div className={`window-behavior ${recording ? 'is-recording' : ''}`}>
            {recording ? <Clock3 size={16} /> : <ShieldCheck size={16} />}
            <span>{recording ? '正在后台录音' : '普通窗口 · 永不置顶'}</span>
          </div>
        </header>
        <div className="content-scroll">{children}</div>
      </main>
    </div>
  )
}
