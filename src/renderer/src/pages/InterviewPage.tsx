import {
  Check,
  ChevronDown,
  CircleStop,
  Headphones,
  Info,
  LoaderCircle,
  Mic2,
  MonitorSpeaker,
  Radio,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMetadata } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'
import { DualTrackRecorder } from '../lib/dual-track-recorder'

function defaultTitle(): string {
  return `${new Date().toLocaleDateString('zh-CN').replaceAll('/', '-')} 面试复盘`
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

interface InterviewPageProps {
  recording: boolean
  onRecordingChange: (active: boolean) => void
  onSessionFinished: (session: SessionMetadata) => void
  notify: (message: string, tone?: ToastTone) => void
}

export function InterviewPage({ recording, onRecordingChange, onSessionFinished, notify }: InterviewPageProps) {
  const recorderRef = useRef(new DualTrackRecorder())
  const [title, setTitle] = useState(defaultTitle)
  const [consent, setConsent] = useState(false)
  const [systemAudio, setSystemAudio] = useState(true)
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [microphoneId, setMicrophoneId] = useState('')
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const selectedMicrophone = useMemo(
    () => microphones.find((device) => device.deviceId === microphoneId),
    [microphones, microphoneId]
  )

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((device) => device.kind === 'audioinput')
      setMicrophones(inputs)
      if (!microphoneId && inputs[0]) setMicrophoneId(inputs[0].deviceId)
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法读取麦克风列表。', 'error')
    }
  }, [microphoneId, notify])

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed(recorderRef.current.elapsedMs), 500)
    return () => window.clearInterval(timer)
  }, [recording])

  const stopRecording = useCallback(async () => {
    if (!recording || stopping) return
    setStopping(true)
    try {
      const session = await recorderRef.current.stop()
      onRecordingChange(false)
      setElapsed(0)
      if (session) {
        onSessionFinished(session)
        notify('录音已安全保存，可以开始转写。', 'success')
      }
    } catch (error) {
      onRecordingChange(false)
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setStopping(false)
    }
  }, [notify, onRecordingChange, onSessionFinished, recording, stopping])

  useEffect(() => window.clarity.onStopRecordingRequested(stopRecording), [stopRecording])

  async function startRecording() {
    if (!consent) return notify('请先确认已经取得面试官同意。', 'error')
    if (!title.trim()) return notify('请填写本场面试名称。', 'error')
    setStarting(true)
    try {
      await recorderRef.current.start({
        title: title.trim(),
        consentConfirmedAt: new Date().toISOString(),
        microphoneDeviceId: microphoneId || undefined,
        microphoneLabel: selectedMicrophone?.label,
        hasSystemAudio: systemAudio
      })
      onRecordingChange(true)
      setElapsed(0)
      notify('录音已开始，Clarity Desk 将最小化到任务栏。', 'success')
      window.setTimeout(() => void window.clarity.minimizeWindow(), 650)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      await refreshDevices()
    } finally {
      setStarting(false)
    }
  }

  if (recording || stopping) {
    return (
      <div className="page recording-page">
        <section className="recording-stage panel">
          <div className="live-pill"><span /> LIVE</div>
          <div className="recording-orb"><Radio size={38} /></div>
          <div className="recording-time">{formatDuration(elapsed)}</div>
          <h2>{title}</h2>
          <p>麦克风、系统音频和混合音轨正在分别写入本地。</p>
          <div className="live-tracks">
            <div><span className="track-icon"><Mic2 size={18} /></span><strong>我的声音</strong><i className="track-live" /></div>
            {systemAudio ? <div><span className="track-icon"><MonitorSpeaker size={18} /></span><strong>面试官声音</strong><i className="track-live" /></div> : null}
            <div><span className="track-icon"><Headphones size={18} /></span><strong>转写混音</strong><i className="track-live" /></div>
          </div>
          <button className="button danger stop-button" onClick={stopRecording} disabled={stopping}>
            {stopping ? <LoaderCircle className="spin" size={19} /> : <CircleStop size={19} />}
            {stopping ? '正在安全保存…' : '结束并保存录音'}
          </button>
          <div className="minimize-reminder"><ShieldCheck size={16} />可以最小化本窗口；托盘菜单也可以结束录音。</div>
        </section>
      </div>
    )
  }

  return (
    <div className="page interview-page">
      <div className="interview-grid">
        <section className="panel setup-panel">
          <div className="setup-heading">
            <div className="feature-icon mint"><Radio size={22} /></div>
            <div><span className="section-label">NEW SESSION</span><h2>准备一场面试记录</h2><p>开始后窗口会自动最小化，不遮挡会议软件。</p></div>
          </div>

          <div className="form-stack">
            <div className="field">
              <label htmlFor="session-title">本场面试名称</label>
              <input id="session-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="field">
              <div className="field-label-row"><label htmlFor="microphone">麦克风</label><button className="text-button" onClick={refreshDevices}><RefreshCw size={14} />刷新设备</button></div>
              <div className="select-wrap">
                <select id="microphone" value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
                  {microphones.length === 0 ? <option value="">系统默认麦克风</option> : null}
                  {microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
                </select>
                <ChevronDown size={17} />
              </div>
            </div>

            <label className={`option-card ${systemAudio ? 'selected' : ''}`}>
              <input type="checkbox" checked={systemAudio} onChange={(event) => setSystemAudio(event.target.checked)} />
              <span className="option-check">{systemAudio ? <Check size={14} /> : null}</span>
              <span className="option-icon"><MonitorSpeaker size={20} /></span>
              <span><strong>同时录制系统声音</strong><small>用于捕获飞书会议、Zoom、Teams 或浏览器中的面试官声音</small></span>
            </label>

            <label className={`consent-card ${consent ? 'confirmed' : ''}`}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span className="consent-checkbox">{consent ? <Check size={15} /> : null}</span>
              <span><strong>我已明确告知对方并取得录音同意</strong><small>录音仅用于个人复盘，不擅自公开或传播。</small></span>
            </label>

            <button className="button primary start-button" disabled={starting || !consent} onClick={startRecording}>
              {starting ? <LoaderCircle className="spin" size={19} /> : <Radio size={19} />}
              {starting ? '正在检查音频设备…' : '开始录音并最小化'}
            </button>
          </div>
        </section>

        <aside className="interview-side">
          <section className="panel checklist-panel">
            <span className="section-label">BEFORE YOU START</span>
            <h3>三件小事，让录音更干净</h3>
            <ol className="checklist">
              <li><span>1</span><div><strong>戴上耳机</strong><p>避免面试官声音再次被麦克风收进去。</p></div></li>
              <li><span>2</span><div><strong>关闭系统通知</strong><p>系统音频会忠实记录所有提示音。</p></div></li>
              <li><span>3</span><div><strong>先说清楚用途</strong><p>明确说明仅用于个人复盘并征得同意。</p></div></li>
            </ol>
          </section>
          <section className="consent-script">
            <div className="script-icon"><Info size={18} /></div>
            <div><strong>推荐告知话术</strong><p>“为了面试结束后复盘，我想录音并转成文字，仅供个人使用、不对外传播，可以吗？”</p></div>
          </section>
        </aside>
      </div>
    </div>
  )
}
