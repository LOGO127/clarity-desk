export type TrackKind = 'microphone' | 'system' | 'mixed'

export interface RecordingChunk {
  track: TrackKind
  index: number
  fileName: string
  mimeType: string
  size: number
  startedAtMs: number
  durationMs: number
}

export type SessionStatus = 'recording' | 'ready' | 'transcribing' | 'transcribed' | 'failed'

export interface SessionMetadata {
  schemaVersion: 1
  id: string
  title: string
  createdAt: string
  updatedAt: string
  consentConfirmedAt: string
  status: SessionStatus
  durationMs: number
  microphoneLabel?: string
  hasSystemAudio: boolean
  chunks: RecordingChunk[]
  error?: string
}

export interface SessionSummary extends SessionMetadata {
  directory: string
  hasTranscript: boolean
}

export interface TranscriptSegment {
  speaker: string
  text: string
  start: number
  end: number
}

export interface TranscriptDocument {
  sessionId: string
  title: string
  generatedAt: string
  model: string
  segments: TranscriptSegment[]
  text: string
}

export interface CreateSessionInput {
  title: string
  consentConfirmedAt: string
  microphoneLabel?: string
  hasSystemAudio: boolean
}

export interface AppendFragmentInput {
  sessionId: string
  track: TrackKind
  index: number
  mimeType: string
  data: ArrayBuffer
}

export interface FinalizeChunkInput {
  sessionId: string
  track: TrackKind
  index: number
  mimeType: string
  startedAtMs: number
  durationMs: number
}

export interface FormulaDocumentStats {
  displayFormulaCount: number
  inlineFormulaCount: number
  blockCount: number
}

export interface LarkWriteInput {
  mode: 'create' | 'append' | 'overwrite'
  docUrl?: string
  xml: string
}

export interface LarkWriteResult {
  ok: boolean
  message: string
  url?: string
  raw?: unknown
}

export interface LarkCenterFormulasInput {
  docUrl: string
}

export interface LarkCenterFormulasResult {
  ok: boolean
  status: 'completed' | 'partial' | 'failed'
  message: string
  totalFormulaCount: number
  submittedFormulaCount: number
  updatedFormulaCount: number
  alreadyCenteredCount: number
  verifiedCenteredCount: number
  unsupportedFormulaCount: number
  documentId?: string
}

export interface AppInfo {
  version: string
  platform: string
  recordingsDirectory: string
  secureStorageAvailable: boolean
}

export interface ClarityDeskApi {
  getAppInfo(): Promise<AppInfo>
  minimizeWindow(): Promise<void>
  showWindow(): Promise<void>
  readClipboardText(): Promise<string>
  writeClipboardText(text: string): Promise<void>
  saveTextFile(defaultName: string, content: string): Promise<boolean>
  createSession(input: CreateSessionInput): Promise<SessionMetadata>
  appendRecordingFragment(input: AppendFragmentInput): Promise<void>
  finalizeRecordingChunk(input: FinalizeChunkInput): Promise<RecordingChunk>
  finalizeSession(sessionId: string, durationMs: number): Promise<SessionMetadata>
  failSession(sessionId: string, error: string): Promise<void>
  listSessions(): Promise<SessionSummary[]>
  readTranscript(sessionId: string): Promise<TranscriptDocument | null>
  transcribeSession(sessionId: string): Promise<TranscriptDocument>
  openSessionFolder(sessionId: string): Promise<void>
  setRecordingActive(active: boolean): Promise<void>
  onStopRecordingRequested(callback: () => void): () => void
  hasApiKey(): Promise<boolean>
  saveApiKey(apiKey: string): Promise<void>
  deleteApiKey(): Promise<void>
  checkLarkCli(): Promise<{ available: boolean; version?: string; authenticated?: boolean }>
  authenticateLark(): Promise<{ ok: boolean; message: string }>
  centerLarkFormulas(input: LarkCenterFormulasInput): Promise<LarkCenterFormulasResult>
  writeToLark(input: LarkWriteInput): Promise<LarkWriteResult>
}
