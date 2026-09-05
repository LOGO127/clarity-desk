import { lazy, Suspense, useCallback, useState } from 'react'
import { Layout } from './components/Layout'
import { ToastStack, type ToastData, type ToastTone } from './components/Toast'
import { FormulaPage } from './pages/FormulaPage'
const InterviewPage = lazy(() => import('./pages/InterviewPage').then((module) => ({ default: module.InterviewPage })))
const SessionsPage = lazy(() => import('./pages/SessionsPage').then((module) => ({ default: module.SessionsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export type Page = 'formula' | 'interview' | 'sessions' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('formula')
  const [recording, setRecording] = useState(false)
  const [recordingStarting, setRecordingStarting] = useState(false)
  const [sessionRefresh, setSessionRefresh] = useState(0)
  const [toasts, setToasts] = useState<ToastData[]>([])

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4_500)
  }, [])

  function navigate(next: Page) {
    if ((recording || recordingStarting) && next !== 'interview') {
      notify(recordingStarting ? '正在连接录音设备，请等待连接完成或取消授权后再切换页面。' : '请先结束当前录音，再切换到其他页面。', 'info')
      return
    }
    setPage(next)
  }

  return (
    <>
      <Layout page={page} recording={recording || recordingStarting} onNavigate={navigate}>
        <Suspense fallback={<div className="page" role="status">正在加载…</div>}>
        {page === 'formula' ? <FormulaPage notify={notify} onConfigure={() => navigate('settings')} /> : null}
        {page === 'interview' ? (
          <InterviewPage
            recording={recording}
            onStartingChange={setRecordingStarting}
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
        </Suspense>
      </Layout>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </>
  )
}
