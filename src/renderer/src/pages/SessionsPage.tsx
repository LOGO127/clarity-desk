import { Clock3, FileText, FolderOpen, LoaderCircle, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary, TranscriptDocument } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'

function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const statusLabels: Record<SessionSummary['status'], string> = {
  recording: '录音中',
  ready: '待转写',
  transcribing: '转写中',
  transcribed: '已完成',
  failed: '需处理'
}

export function SessionsPage({ refreshToken, notify }: { refreshToken: number; notify: (message: string, tone?: ToastTone) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [transcribing, setTranscribing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptDocument>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await window.clarity.listSessions())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  async function toggleTranscript(session: SessionSummary) {
    if (expanded === session.id) return setExpanded(null)
    setExpanded(session.id)
    if (!transcripts[session.id]) {
      const document = await window.clarity.readTranscript(session.id)
      if (document) setTranscripts((current) => ({ ...current, [session.id]: document }))
    }
  }

  async function transcribe(session: SessionSummary) {
    setTranscribing(session.id)
    try {
      const document = await window.clarity.transcribeSession(session.id)
      setTranscripts((current) => ({ ...current, [session.id]: document }))
      setExpanded(session.id)
      notify('转写完成，文字稿已保存到会话目录。', 'success')
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      await refresh()
    } finally {
      setTranscribing(null)
    }
  }

  return (
    <div className="page sessions-page">
      <div className="sessions-header">
        <div><span className="section-label">LOCAL ARCHIVE</span><h2>你的面试复盘</h2><p>音频和文字稿都按场次独立保存，不会混在一起。</p></div>
        <button className="button secondary" onClick={refresh}><RefreshCw size={16} />刷新</button>
      </div>

      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" size={25} />正在读取本地会话…</div>
      ) : sessions.length === 0 ? (
        <div className="panel empty-state"><div className="empty-illustration"><MessageSquareText size={34} /></div><h3>还没有复盘记录</h3><p>完成第一场面试录音后，它会安全地出现在这里。</p></div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => {
            const transcript = transcripts[session.id]
            const isExpanded = expanded === session.id
            return (
              <article className={`panel session-card ${isExpanded ? 'expanded' : ''}`} key={session.id}>
                <div className="session-main">
                  <div className="session-leading"><div className="session-icon"><FileText size={20} /></div><div><h3>{session.title}</h3><div className="session-meta"><span>{new Date(session.createdAt).toLocaleString('zh-CN')}</span><span><Clock3 size={14} />{formatDuration(session.durationMs)}</span><span>{session.chunks.length} 个音频文件</span></div></div></div>
                  <div className="session-actions">
                    <span className={`status-badge status-${session.status}`}>{statusLabels[session.status]}</span>
                    <button className="icon-text-button" onClick={() => window.clarity.openSessionFolder(session.id)}><FolderOpen size={16} />文件夹</button>
                    {session.hasTranscript ? (
                      <button className="button secondary compact" onClick={() => toggleTranscript(session)}><MessageSquareText size={16} />{isExpanded ? '收起文字稿' : '查看文字稿'}</button>
                    ) : (
                      <button className="button primary compact" disabled={transcribing === session.id || session.status === 'recording'} onClick={() => transcribe(session)}>
                        {transcribing === session.id ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                        {transcribing === session.id ? '转写中…' : '开始转写'}
                      </button>
                    )}
                  </div>
                </div>
                {session.error ? <div className="session-error">{session.error}</div> : null}
                {isExpanded ? (
                  <div className="transcript-view">
                    {transcript ? transcript.segments.map((segment, index) => (
                      <div className="transcript-segment" key={`${segment.start}-${index}`}>
                        <div className="speaker-avatar">{segment.speaker.slice(-1).toUpperCase()}</div>
                        <div><div className="segment-heading"><strong>{segment.speaker}</strong><span>{Math.floor(segment.start / 60).toString().padStart(2, '0')}:{Math.floor(segment.start % 60).toString().padStart(2, '0')}</span></div><p>{segment.text}</p></div>
                      </div>
                    )) : <div className="loading-state small"><LoaderCircle className="spin" size={18} />读取文字稿…</div>}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
