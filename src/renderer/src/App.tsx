import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '../../shared/types'
import { Layout } from './components/Layout'
import { ToastStack, type ToastData, type ToastTone } from './components/Toast'
import { FormulaPage } from './pages/FormulaPage'
import { HomePage } from './pages/HomePage'
import { InterviewPage } from './pages/InterviewPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'

export type Page = 'home' | 'formula' | 'interview' | 'sessions' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [recording, setRecording] = useState(false)
  const [recent, setRecent] = useState<SessionSummary[]>([])
  const [sessionRefresh, setSessionRefresh] = useState(0)
  const [toasts, setToasts] = useState<ToastData[]>([])

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4_500)
  }, [])

  useEffect(() => {
    void window.clarity.listSessions().then(setRecent)
  }, [sessionRefresh])

  function navigate(next: Page) {
    if (recording && next !== 'interview') {
      notify('请先结束当前录音，再切换到其他页面。', 'info')
      return
    }
    setPage(next)
  }

  return (
    <>
      <Layout page={page} recording={recording} onNavigate={navigate}>
        {page === 'home' ? <HomePage onNavigate={navigate} recent={recent} /> : null}
        {page === 'formula' ? <FormulaPage notify={notify} /> : null}
        {page === 'interview' ? (
          <InterviewPage
            recording={recording}
            onRecordingChange={setRecording}
            onSessionFinished={() => {
              setSessionRefresh((value) => value + 1)
              setPage('sessions')
            }}
            notify={notify}
          />
        ) : null}
        {page === 'sessions' ? <SessionsPage refreshToken={sessionRefresh} notify={notify} /> : null}
        {page === 'settings' ? <SettingsPage notify={notify} /> : null}
      </Layout>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </>
  )
}
