import { History, Mic2, Settings2, Sigma } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Page } from '../App'

const navigation = [
  { id: 'formula' as const, label: '公式居中', icon: Sigma },
  { id: 'interview' as const, label: '面试录音', icon: Mic2 },
  { id: 'sessions' as const, label: '录音记录', icon: History },
  { id: 'settings' as const, label: '设置', icon: Settings2 }
]

interface LayoutProps {
  page: Page
  recording: boolean
  onNavigate: (page: Page) => void
  children: ReactNode
}

export function Layout({ page, recording, onNavigate, children }: LayoutProps) {
  return (
    <div className="app-shell compact-shell">
      <header className="compact-header">
        <span className="compact-brand">Clarity Desk</span>
        <nav className="compact-navigation" aria-label="主要导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`compact-nav ${page === id ? 'active' : ''} ${id === 'sessions' || id === 'settings' ? 'utility' : ''}`}
              onClick={() => onNavigate(id)} disabled={recording && id !== 'interview'}
              aria-current={page === id ? 'page' : undefined}>
              <Icon size={17} /><span>{label}</span>
              {id === 'interview' && recording ? <i className="recording-dot" /> : null}
            </button>
          ))}
        </nav>
      </header>
      <main className="content-scroll">{children}</main>
    </div>
  )
}
