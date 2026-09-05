import {
  Check,
  ChevronDown,
  CircleStop,
  Headphones,
  LoaderCircle,
  Mic2,
  MonitorSpeaker,
  Radio,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMetadata, TrackKind } from '../../../shared/types'
import type { ToastTone } from '../components/Toast'
import { DualTrackRecorder, type RecorderTrackState } from '../lib/dual-track-recorder'

function defaultTitle(): string {
  return `${new Date().toLocaleDateString('zh-CN').replaceAll('/', '-')} 面试复盘`
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

function trackStateLabel(state: RecorderTrackState | undefined, level = 0): string {
  if (state === 'muted') return '暂无信号'
  if (state === 'ended') return '已断开'
  if (state === 'error') return '写入失败'
  return level >= 0.015 ? '检测到声音' : '等待声音'
}

interface InterviewPageProps {
  recording: boolean
  onStartingChange: (active: boolean) => void
  onRecordingChange: (active: boolean) => void
  onSessionFinished: (session: SessionMetadata) => void
  notify: (message: string, tone?: ToastTone) => void
}

export function InterviewPage({ recording, onStartingChange, onRecordingChange, onSessionFinished, notify }: InterviewPageProps) {
  const recorderRef = useRef(new DualTrackRecorder())
  const startingRef = useRef(false)
  const stoppingRef = useRef(false)
  const [title, setTitle] = useState(defaultTitle)
  const [consent, setConsent] = useState(false)
  const [systemAudio, setSystemAudio] = useState(true)
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [microphoneId, setMicrophoneId] = useState('')
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recordingIssue, setRecordingIssue] = useState('')
  const [trackHealth, setTrackHealth] = useState<Partial<Record<TrackKind, RecorderTrackState>>>({})
  const [trackLevels, setTrackLevels] = useState<Partial<Record<TrackKind, number>>>({})
  const [heardTracks, setHeardTracks] = useState<Partial<Record<TrackKind, boolean>>>({})
  const [awaitingAudioConfirmation, setAwaitingAudioConfirmation] = useState(false)
  const [preflightWarning, setPreflightWarning] = useState(false)

  const selectedMicrophone = useMemo(
    () => microphones.find((device) => device.deviceId === microphoneId),
    [microphones, microphoneId]
  )
  const requiredAudioReady = Boolean(
    heardTracks.microphone && trackHealth.microphone === 'live' &&
    heardTracks.mixed && trackHealth.mixed === 'live' &&
    (!systemAudio || (heardTracks.system && trackHealth.system === 'live'))
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

  useEffect(() => {
    if (!recording || !awaitingAudioConfirmation || requiredAudioReady) {
      setPreflightWarning(false)
      return
    }
    const timer = window.setTimeout(() => setPreflightWarning(true), 5_000)
    return () => window.clearTimeout(timer)
  }, [awaitingAudioConfirmation, recording, requiredAudioReady])

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current.sessionId || stoppingRef.current) return
    stoppingRef.current = true
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
      stoppingRef.current = false
      setStopping(false)
    }
  }, [notify, onRecordingChange, onSessionFinished])

  useEffect(() => window.clarity.onStopRecordingRequested(stopRecording), [stopRecording])

  async function startRecording() {
    if (startingRef.current || recording) return
    if (!consent) return notify('请先确认已经取得面试官同意。', 'error')
    if (!title.trim()) return notify('请填写本场面试名称。', 'error')
    startingRef.current = true
    onStartingChange(true)
    setStarting(true)
    setRecordingIssue('')
    setTrackHealth({})
    setTrackLevels({})
    setHeardTracks({})
    setAwaitingAudioConfirmation(false)
    setPreflightWarning(false)
    try {
      await recorderRef.current.start({
        title: title.trim(),
        consentConfirmedAt: new Date().toISOString(),
        microphoneDeviceId: microphoneId || undefined,
        microphoneLabel: selectedMicrophone?.label,
        hasSystemAudio: systemAudio,
        onHealthChange: ({ track, state, level, message }) => {
          setTrackHealth((current) => ({ ...current, [track]: state }))
          if (level !== undefined) setTrackLevels((current) => ({ ...current, [track]: level }))
          if (level !== undefined && level >= 0.015) setHeardTracks((current) => ({ ...current, [track]: true }))
          if (message && state === 'muted') setRecordingIssue(message)
          if (state === 'live') setRecordingIssue((current) => current.includes('暂时没有信号') ? '' : current)
        },
        onFatalError: (error) => {
          setRecordingIssue(error.message)
          notify(error.message, 'error')
          void window.clarity.showWindow()
          window.setTimeout(() => void stopRecording(), 0)
        }
      })
      onRecordingChange(true)
      setElapsed(0)
      setAwaitingAudioConfirmation(true)
      notify('录音已开始。请先让双方各说一句，确认两条声源都有响应。', 'info')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      await refreshDevices()
    } finally {
      startingRef.current = false
      setStarting(false)
      onStartingChange(false)
    }
  }

  async function confirmAudioAndMinimize() {
    if (!requiredAudioReady) return notify('尚未检测到所有必需声源，请让双方各说一句后再确认。', 'error')
    setAwaitingAudioConfirmation(false)
    notify('声源检查通过，窗口将最小化并继续录音。', 'success')
    await window.clarity.minimizeWindow()
  }

  if (recording || stopping) {
    const attention = Object.values(trackHealth).some((state) => state !== 'live')
    return (
      <div className="page recording-page">
        <section className="recording-stage panel">
          <div className={`live-pill ${attention ? 'attention' : ''}`}><span /> {stopping ? 'SAVING' : attention ? 'CHECK AUDIO' : 'LIVE'}</div>
          <div className="recording-time">{formatDuration(elapsed)}</div>
          <h2>{title}</h2>
          <p>{recordingIssue || '录音正在保存到本地。'}</p>
          {awaitingAudioConfirmation ? (
            <div className={`audio-preflight ${preflightWarning ? 'warning' : ''}`}>
              <div>
                <strong>{requiredAudioReady ? '声源检查通过' : preflightWarning ? '仍有声源没有检测到声音' : '请检查声音'}</strong>
                <span>{systemAudio ? '请自己说一句，再让会议测试扬声器或对方说一句；两条都显示“检测到声音”后再最小化。' : '请自己说一句；麦克风显示“检测到声音”后再最小化。'}</span>
              </div>
              <button className="button primary compact" onClick={confirmAudioAndMinimize} disabled={!requiredAudioReady}>
                <Check size={16} />确认声音并最小化
              </button>
            </div>
          ) : null}
          <div className="live-tracks">
            <div><span className="track-icon"><Mic2 size={18} /></span><strong>我的声音<small>{trackStateLabel(trackHealth.microphone, trackLevels.microphone)}</small></strong><i className={`track-live ${trackHealth.microphone ?? 'live'}`} style={{ opacity: .45 + (trackLevels.microphone ?? 0) * .55 }} /></div>
            {systemAudio ? <div><span className="track-icon"><MonitorSpeaker size={18} /></span><strong>面试官声音<small>{trackStateLabel(trackHealth.system, trackLevels.system)}</small></strong><i className={`track-live ${trackHealth.system ?? 'live'}`} style={{ opacity: .45 + (trackLevels.system ?? 0) * .55 }} /></div> : null}
            <div><span className="track-icon"><Headphones size={18} /></span><strong>转写混音<small>{trackStateLabel(trackHealth.mixed, trackLevels.mixed)}</small></strong><i className={`track-live ${trackHealth.mixed ?? 'live'}`} style={{ opacity: .45 + (trackLevels.mixed ?? 0) * .55 }} /></div>
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
      <div className="interview-simple">
        <section className="panel setup-panel">
          <div className="setup-heading">
            <div><h2>记录一场面试</h2><p>录下自己和对方的声音，结束后再转写复盘。</p></div>
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
              {starting ? '正在连接音频设备…' : '开始录音'}
            </button>
          </div>
        </section>

        <p className="formula-simple-note">建议佩戴耳机并关闭通知音。开始后，确认双方声音都有响应，再最小化窗口。</p>
      </div>
    </div>
  )
}
