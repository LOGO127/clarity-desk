import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  nativeImage,
  safeStorage,
  session,
  shell
} from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import type {
  AppInfo,
  AppendFragmentInput,
  CreateSessionInput,
  FinalizeChunkInput,
  LarkCenterFormulasInput,
  LarkCenterFormulasResult,
  LarkWriteInput,
  LarkWriteResult,
  RecordingChunk,
  SessionMetadata,
  SessionSummary,
  TranscriptDocument,
  TranscriptSegment
} from '../shared/types'
import {
  buildLarkCenterBatchArgs,
  buildLarkCenterProgressResult,
  buildLarkResolveDocumentArgs,
  buildLarkWindowsCommand,
  buildLarkWriteArgs,
  extractLarkAuthFlow,
  extractLarkDocumentId,
  extractLarkDocumentUrl,
  extractLarkCliErrorMessage,
  findStandaloneFormulaBlocks,
  readAllLarkDocumentBlocks
} from './lark-cli'
import { createSessionId, isValidSessionId } from './session-id'
import { isSafeExternalUrl, isTrustedIpcContext, isTrustedRendererUrl } from './navigation-security'
import { recoveredRecordingDisposition, recordingIntegrityError } from './recording-integrity'
import { finalizeAudioChunkFile, recoverUnindexedRecordingChunks } from './recording-files'
import {
  labelChunkSpeakers,
  parseTranscriptionSegments,
  resumeTranscriptionChunks,
  type TranscriptCheckpoint
} from './transcript-checkpoint'

const execFileAsync = promisify(execFile)
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = !app.isPackaged
const MAX_TRANSCRIPTION_FILE_BYTES = 25 * 1024 * 1024
const RECORDING_SEGMENT_DURATION_MS = 10 * 60 * 1000

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let recordingActive = false
let isQuitting = false
let trustedRendererUrl: string | null = null

const sessionLocks = new Map<string, Promise<unknown>>()

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  consentConfirmedAt: z.string().datetime(),
  microphoneLabel: z.string().max(200).optional(),
  hasSystemAudio: z.boolean()
})

const larkWriteSchema = z.object({
  mode: z.enum(['create', 'append', 'overwrite']),
  docUrl: z.string().max(500).optional(),
  xml: z.string().min(1).max(5_000_000)
})

const larkCenterFormulasSchema = z.object({
  docUrl: z.string().trim().min(1).max(1_000)
})

function recordingsDirectory(): string {
  // Explicit test launches isolate recordings before startup recovery runs.
  if (app.commandLine.hasSwitch('clarity-smoke-test')) {
    return path.join(app.getPath('userData'), 'smoke-recordings')
  }
  if (isDevelopment && process.env.CLARITY_DESK_RECORDINGS_DIR) {
    return path.resolve(process.env.CLARITY_DESK_RECORDINGS_DIR)
  }
  return path.join(app.getPath('documents'), 'Clarity Desk', 'Sessions')
}

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function assertSessionId(sessionId: string): void {
  if (!isValidSessionId(sessionId)) {
    throw new Error('无效的会话标识。')
  }
}

function sessionDirectory(sessionId: string): string {
  assertSessionId(sessionId)
  return path.join(recordingsDirectory(), sessionId)
}

function metadataPath(sessionId: string): string {
  return path.join(sessionDirectory(sessionId), 'metadata.json')
}

async function readMetadata(sessionId: string): Promise<SessionMetadata> {
  return JSON.parse(await fs.readFile(metadataPath(sessionId), 'utf8')) as SessionMetadata
}

async function writeMetadata(metadata: SessionMetadata): Promise<void> {
  await writeJsonAtomic(metadataPath(metadata.id), metadata)
}

async function writeJsonAtomic(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, destination)
}

async function writeTextAtomic(destination: string, value: string): Promise<void> {
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, value, 'utf8')
  await fs.rename(temporary, destination)
}

async function recoverInterruptedSessions(): Promise<void> {
  const root = recordingsDirectory()
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue
    try {
      const metadata = await readMetadata(entry.name)
      if (metadata.status !== 'recording' && metadata.status !== 'failed') continue
      const previousStatus = metadata.status
      const previousError = metadata.error
      const directory = sessionDirectory(entry.name)
      const recovered = await recoverUnindexedRecordingChunks(directory, metadata, RECORDING_SEGMENT_DURATION_MS)
      if (previousStatus === 'failed' && recovered.chunks.length === 0) continue
      for (const chunk of recovered.chunks) {
        metadata.chunks = metadata.chunks.filter((existing) => !(existing.track === chunk.track && existing.index === chunk.index))
        metadata.chunks.push(chunk)
      }
      metadata.chunks = metadata.chunks
        .filter((chunk, index, chunks) => chunks.findIndex((other) => other.track === chunk.track && other.index === chunk.index) === index)
        .sort((left, right) => left.startedAtMs - right.startedAtMs || left.track.localeCompare(right.track))
      metadata.durationMs = metadata.chunks.reduce(
        (duration, chunk) => Math.max(duration, chunk.startedAtMs + chunk.durationMs), metadata.durationMs
      )
      const integrityError = recordingIntegrityError(metadata.chunks, metadata.hasSystemAudio)
        ?? (recovered.errors.length > 0 ? `部分音频文件无法恢复：${recovered.errors.join('；')}` : null)
      const disposition = recoveredRecordingDisposition(previousStatus, previousError, integrityError)
      metadata.status = disposition.status
      metadata.error = disposition.error
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
    } catch (error) {
      console.error(`Unable to recover interrupted session ${entry.name}`, error)
    }
  }
}

async function withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  sessionLocks.set(sessionId, next)
  try {
    return await next
  } finally {
    if (sessionLocks.get(sessionId) === next) sessionLocks.delete(sessionId)
  }
}

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="2" y="2" width="28" height="28" rx="9" fill="#6756E8"/>
      <path d="M21.7 10.4a7 7 0 1 0 0 11.2" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round"/>
      <circle cx="21.8" cy="16" r="2.2" fill="#BFF4DD"/>
    </svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function updateTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 Clarity Desk',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: '停止当前录音',
        enabled: recordingActive,
        click: () => {
          mainWindow?.webContents.send('recording:stop-requested')
          mainWindow?.show()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          if (recordingActive) {
            mainWindow?.webContents.send('recording:stop-requested')
            mainWindow?.show()
            return
          }
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 800,
    minHeight: 620,
    show: false,
    backgroundColor: '#f6f7fb',
    icon: createTrayImage(),
    title: 'Clarity Desk',
    autoHideMenuBar: true,
    alwaysOnTop: false,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isTrustedRendererUrl(targetUrl, trustedRendererUrl)) return
    event.preventDefault()
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDevelopment) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`Renderer failed to load (${code}): ${description}`)
    })
  }
  mainWindow.on('close', (event) => {
    if (recordingActive && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    trustedRendererUrl = process.env.ELECTRON_RENDERER_URL
    void mainWindow.loadURL(trustedRendererUrl)
  } else {
    const rendererPath = path.join(currentDirectory, '../renderer/index.html')
    trustedRendererUrl = pathToFileURL(rendererPath).toString()
    void mainWindow.loadFile(rendererPath)
  }
}

async function saveSecret(key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统安全存储不可用，Clarity Desk 不会以明文保存密钥。')
  }
  await fs.mkdir(path.dirname(secretsPath()), { recursive: true })
  let secrets: Record<string, string> = {}
  try {
    secrets = JSON.parse(await fs.readFile(secretsPath(), 'utf8')) as Record<string, string>
  } catch {
    // First use: the file does not exist yet.
  }
  secrets[key] = safeStorage.encryptString(value).toString('base64')
  await fs.writeFile(secretsPath(), `${JSON.stringify(secrets, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function readSecret(key: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const secrets = JSON.parse(await fs.readFile(secretsPath(), 'utf8')) as Record<string, string>
    const encrypted = secrets[key]
    return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : null
  } catch {
    return null
  }
}

async function deleteSecret(key: string): Promise<void> {
  try {
    const secrets = JSON.parse(await fs.readFile(secretsPath(), 'utf8')) as Record<string, string>
    delete secrets[key]
    await fs.writeFile(secretsPath(), `${JSON.stringify(secrets, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Deleting an absent key is intentionally idempotent.
  }
}

function mimeExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  return 'webm'
}

function timestampLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainingSeconds = value % 60
  return [hours, minutes, remainingSeconds].map((item) => item.toString().padStart(2, '0')).join(':')
}

function transcriptToMarkdown(document: TranscriptDocument): string {
  const body = document.segments
    .map((segment) => `[${timestampLabel(segment.start)}] **${segment.speaker}**\n\n${segment.text.trim()}`)
    .join('\n\n')
  return `# ${document.title}\n\n> 由 Clarity Desk 转写于 ${document.generatedAt}\n\n${body}\n`
}

async function transcribeAudioFile(
  filePath: string,
  apiKey: string,
  offsetSeconds: number
): Promise<TranscriptSegment[]> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_TRANSCRIPTION_FILE_BYTES) {
    throw new Error(`音频切片 ${path.basename(filePath)} 超过 25 MB，无法上传转写。`)
  }

  const bytes = await fs.readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }), path.basename(filePath))
  form.append('model', 'gpt-4o-transcribe-diarize')
  form.append('response_format', 'diarized_json')
  form.append('chunking_strategy', 'auto')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`转写服务返回 ${response.status}：${message.slice(0, 400)}`)
  }

  return parseTranscriptionSegments(await response.json(), offsetSeconds)
}

async function locateLarkCli(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where.exe', ['lark-cli'], { windowsHide: true })
      const entries = stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
      return entries.find((entry) => entry.toLowerCase().endsWith('.cmd')) ?? entries[0] ?? null
    }
    const { stdout } = await execFileAsync('which', ['lark-cli'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function runLarkCli(args: string[], cwd?: string, timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
  const executable = await locateLarkCli()
  if (!executable) throw new Error('未检测到 lark-cli，请先安装后重试。')
  if (process.platform === 'win32' && executable.toLowerCase().endsWith('.cmd')) {
    const command = buildLarkWindowsCommand(executable, args)
    return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd,
      timeout,
      windowsHide: true,
      windowsVerbatimArguments: true,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }
    })
  }
  return execFileAsync(executable, args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }
  })
}

function parseLarkCliJson(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as unknown
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>
    if (envelope.ok === false) {
      throw new Error(extractLarkCliErrorMessage(envelope) ?? '飞书请求失败。')
    }
  }
  return parsed
}

async function readLarkDocumentBlocks(documentId: string): Promise<Record<string, unknown>[]> {
  return readAllLarkDocumentBlocks(documentId, async (args) =>
    parseLarkCliJson((await runLarkCli(args)).stdout)
  )
}

function assertLarkDocumentUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('请输入有效的飞书文档链接。')
  }
  if (url.protocol !== 'https:' || !/\/(docx|wiki)\/[^/]+/.test(url.pathname)) {
    throw new Error('请输入以 https:// 开头的飞书 docx 或 wiki 文档链接。')
  }
}

function documentIdFromDocxUrl(value: string): string | undefined {
  const match = new URL(value).pathname.match(/\/docx\/([^/]+)/)
  return match?.[1]
}

function assertSafeLarkDocumentId(value: string): void {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(value)) throw new Error('飞书返回了无效的文档标识。')
}

async function checkLarkCli() {
  try {
    const versionResult = await runLarkCli(['--version'])
    const authResult = await runLarkCli(['auth', 'status'])
    const status = JSON.parse(authResult.stdout) as { identities?: { user?: { available?: boolean } } }
    return {
      available: true,
      version: versionResult.stdout.trim(),
      authenticated: status.identities?.user?.available === true
    }
  } catch {
    const executable = await locateLarkCli()
    return { available: Boolean(executable), authenticated: false }
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  const isMainFrame = !event.senderFrame?.parent
  if (!isTrustedIpcContext({
    senderUrl,
    trustedRendererUrl,
    ownsWebContents: event.sender === mainWindow?.webContents,
    isMainFrame
  })) {
    throw new Error('已拒绝非受信页面的应用权限请求。')
  }
}

function handleTrusted<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return listener(event, ...(args as TArgs))
  })
}

function registerIpcHandlers(): void {
  handleTrusted('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    platform: process.platform,
    recordingsDirectory: recordingsDirectory(),
    secureStorageAvailable: safeStorage.isEncryptionAvailable()
  }))
  handleTrusted('window:minimize', () => mainWindow?.minimize())
  handleTrusted('window:show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  handleTrusted('clipboard:read-text', () => clipboard.readText())
  handleTrusted('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('剪贴板内容无效。')
    clipboard.writeText(text)
  })
  handleTrusted('file:save-text', async (_event, defaultName: unknown, content: unknown) => {
    if (typeof defaultName !== 'string' || typeof content !== 'string') throw new Error('文件参数无效。')
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName.replace(/[\\/:*?"<>|]/g, '-'),
      filters: [
        { name: 'Text', extensions: ['md', 'txt', 'xml', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, content, 'utf8')
    return true
  })

  handleTrusted('session:create', async (_event, rawInput: unknown) => {
    const input = createSessionSchema.parse(rawInput) as CreateSessionInput
    const id = createSessionId(new Date(), randomUUID().slice(0, 8))
    const now = new Date().toISOString()
    const metadata: SessionMetadata = {
      schemaVersion: 1,
      id,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      consentConfirmedAt: input.consentConfirmedAt,
      status: 'recording',
      durationMs: 0,
      microphoneLabel: input.microphoneLabel,
      hasSystemAudio: input.hasSystemAudio,
      chunks: []
    }
    await fs.mkdir(sessionDirectory(id), { recursive: true })
    await writeMetadata(metadata)
    return metadata
  })

  handleTrusted('session:append-fragment', async (_event, input: AppendFragmentInput): Promise<void> => {
    assertSessionId(input.sessionId)
    if (!['microphone', 'system', 'mixed'].includes(input.track)) throw new Error('无效的音轨类型。')
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 10_000) throw new Error('无效的切片编号。')
    if (!(input.data instanceof ArrayBuffer) || input.data.byteLength === 0) return
    if (input.data.byteLength > 5 * 1024 * 1024) throw new Error('单个录音数据片段过大。')
    await withSessionLock(input.sessionId, async () => {
      const extension = mimeExtension(input.mimeType)
      const partialPath = path.join(
        sessionDirectory(input.sessionId),
        `${input.track}-${input.index.toString().padStart(4, '0')}.${extension}.partial`
      )
      await fs.appendFile(partialPath, new Uint8Array(input.data))
    })
  })

  handleTrusted('session:finalize-chunk', async (_event, input: FinalizeChunkInput): Promise<RecordingChunk> => {
    assertSessionId(input.sessionId)
    if (!['microphone', 'system', 'mixed'].includes(input.track)) throw new Error('无效的音轨类型。')
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 10_000) throw new Error('无效的切片编号。')
    return withSessionLock(input.sessionId, async () => {
      const extension = mimeExtension(input.mimeType)
      const fileName = `${input.track}-${input.index.toString().padStart(4, '0')}.${extension}`
      const metadata = await readMetadata(input.sessionId)
      const existing = metadata.chunks.find((entry) => entry.track === input.track && entry.index === input.index && entry.fileName === fileName)
      const stat = await finalizeAudioChunkFile(sessionDirectory(input.sessionId), fileName)
      const chunk: RecordingChunk = {
        track: input.track,
        index: input.index,
        fileName,
        mimeType: input.mimeType,
        size: stat.size,
        startedAtMs: existing?.startedAtMs ?? Math.max(0, Math.round(input.startedAtMs)),
        durationMs: existing?.durationMs ?? Math.max(0, Math.round(input.durationMs))
      }
      metadata.chunks = metadata.chunks.filter((entry) => !(entry.track === chunk.track && entry.index === chunk.index))
      metadata.chunks.push(chunk)
      metadata.chunks.sort((left, right) => left.startedAtMs - right.startedAtMs || left.track.localeCompare(right.track))
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
      return chunk
    })
  })

  handleTrusted('session:finalize', async (_event, sessionId: string, durationMs: number) =>
    withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      const integrityError = recordingIntegrityError(metadata.chunks, metadata.hasSystemAudio)
      if (integrityError) throw new Error(`${integrityError} 已保留现有片段。`)
      metadata.durationMs = Math.max(0, Math.round(durationMs))
      metadata.status = 'ready'
      delete metadata.error
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
      return metadata
    })
  )
  handleTrusted('session:fail', async (_event, sessionId: string, error: string) =>
    withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      metadata.status = 'failed'
      metadata.error = String(error).slice(0, 1000)
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
    })
  )
  handleTrusted('session:list', async (): Promise<SessionSummary[]> => {
    await fs.mkdir(recordingsDirectory(), { recursive: true })
    const entries = await fs.readdir(recordingsDirectory(), { withFileTypes: true })
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
        .map(async (entry): Promise<SessionSummary | null> => {
          try {
            const metadata = await readMetadata(entry.name)
            let hasTranscript = true
            try {
              await fs.access(path.join(sessionDirectory(entry.name), 'transcript.json'))
            } catch {
              hasTranscript = false
            }
            return { ...metadata, directory: sessionDirectory(entry.name), hasTranscript }
          } catch {
            return null
          }
        })
    )
    return summaries
      .filter((entry): entry is SessionSummary => entry !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  })
  handleTrusted('session:read-transcript', async (_event, sessionId: string): Promise<TranscriptDocument | null> => {
    assertSessionId(sessionId)
    try {
      return JSON.parse(await fs.readFile(path.join(sessionDirectory(sessionId), 'transcript.json'), 'utf8')) as TranscriptDocument
    } catch {
      return null
    }
  })
  handleTrusted('session:transcribe', async (_event, sessionId: string): Promise<TranscriptDocument> => {
    assertSessionId(sessionId)
    const apiKey = await readSecret('openaiApiKey')
    if (!apiKey) throw new Error('请先在设置中保存 OpenAI API Key。')

    return withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      const statusBeforeTranscription = metadata.status
      const checkpointPath = path.join(sessionDirectory(sessionId), 'transcript.partial.json')
      let completedCount = 0
      let totalCount = 0
      metadata.status = 'transcribing'
      metadata.updatedAt = new Date().toISOString()
      delete metadata.error
      await writeMetadata(metadata)
      try {
        const mixedChunks = metadata.chunks
          .filter((chunk) => chunk.track === 'mixed')
          .sort((left, right) => left.startedAtMs - right.startedAtMs)
        if (mixedChunks.length === 0) throw new Error('该会话没有可转写的混合音轨。')
        totalCount = mixedChunks.length

        let checkpoint: TranscriptCheckpoint | null = null
        try {
          checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as TranscriptCheckpoint
        } catch {
          checkpoint = null
        }
        const completedChunks = await resumeTranscriptionChunks(
          sessionId,
          mixedChunks,
          checkpoint,
          (chunk) => transcribeAudioFile(
            path.join(sessionDirectory(sessionId), chunk.fileName),
            apiKey,
            chunk.startedAtMs / 1000
          ),
          async (completed) => {
            completedCount = completed.length
            await writeJsonAtomic(checkpointPath, {
              schemaVersion: 1,
              sessionId,
              updatedAt: new Date().toISOString(),
              chunks: completed
            } satisfies TranscriptCheckpoint)
          }
        )
        const segments = completedChunks.flatMap((entry, index) =>
          labelChunkSpeakers(entry.segments, index, completedChunks.length)
        )
        segments.sort((left, right) => left.start - right.start)
        const document: TranscriptDocument = {
          sessionId,
          title: metadata.title,
          generatedAt: new Date().toISOString(),
          model: 'gpt-4o-transcribe-diarize',
          segments,
          text: segments.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n')
        }
        await writeJsonAtomic(path.join(sessionDirectory(sessionId), 'transcript.json'), document)
        await writeTextAtomic(path.join(sessionDirectory(sessionId), 'transcript.md'), transcriptToMarkdown(document))
        metadata.status = 'transcribed'
        metadata.updatedAt = new Date().toISOString()
        delete metadata.error
        await writeMetadata(metadata)
        await fs.rm(checkpointPath, { force: true })
        return document
      } catch (error) {
        metadata.status = statusBeforeTranscription === 'transcribed'
          ? 'transcribed'
          : statusBeforeTranscription === 'failed'
            ? 'failed'
            : 'ready'
        const detail = error instanceof Error ? error.message : String(error)
        metadata.error = completedCount > 0
          ? `转写未完成，已保留 ${completedCount}/${totalCount} 个音频切片的进度；重试将从断点继续。${detail}`
          : `转写未完成：${detail}`
        metadata.updatedAt = new Date().toISOString()
        await writeMetadata(metadata)
        throw error
      }
    })
  })
  handleTrusted('session:open-folder', async (_event, sessionId: string) => {
    const result = await shell.openPath(sessionDirectory(sessionId))
    if (result) throw new Error(result)
  })
  handleTrusted('recording:set-active', (_event, active: boolean) => {
    recordingActive = Boolean(active)
    updateTrayMenu()
  })

  handleTrusted('settings:has-api-key', async () => Boolean(await readSecret('openaiApiKey')))
  handleTrusted('settings:save-api-key', async (_event, apiKey: unknown) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.length > 500) {
      throw new Error('API Key 格式无效。')
    }
    await saveSecret('openaiApiKey', apiKey.trim())
  })
  handleTrusted('settings:delete-api-key', async () => deleteSecret('openaiApiKey'))

  handleTrusted('lark:check', checkLarkCli)
  handleTrusted('lark:authenticate', async () => {
    try {
      const initiated = await runLarkCli(['auth', 'login', '--domain', 'docs', '--no-wait', '--json'])
      const flow = extractLarkAuthFlow(JSON.parse(initiated.stdout) as unknown)
      if (!flow.verificationUrl || !flow.deviceCode) throw new Error('lark-cli 未返回可用的飞书授权链接。')
      await shell.openExternal(flow.verificationUrl)
      await runLarkCli(['auth', 'login', '--device-code', flow.deviceCode], undefined, 5 * 60_000)
      return { ok: true, message: '飞书授权成功。' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  handleTrusted(
    'lark:center-formulas',
    async (_event, rawInput: unknown): Promise<LarkCenterFormulasResult> => {
      const emptyResult = {
        totalFormulaCount: 0,
        submittedFormulaCount: 0,
        updatedFormulaCount: 0,
        alreadyCenteredCount: 0,
        verifiedCenteredCount: 0,
        unsupportedFormulaCount: 0
      }

      let documentId: string | undefined
      let formulas: ReturnType<typeof findStandaloneFormulaBlocks> = []
      const submittedBlockIds = new Set<string>()
      try {
        const input = larkCenterFormulasSchema.parse(rawInput) as LarkCenterFormulasInput
        assertLarkDocumentUrl(input.docUrl)

        const resolved = parseLarkCliJson((await runLarkCli(buildLarkResolveDocumentArgs(input.docUrl))).stdout)
        documentId = extractLarkDocumentId(resolved) ?? documentIdFromDocxUrl(input.docUrl)
        if (!documentId) throw new Error('无法从该链接解析飞书文档，请确认你对文档有访问权限。')
        assertSafeLarkDocumentId(documentId)

        const before = await readLarkDocumentBlocks(documentId)
        formulas = findStandaloneFormulaBlocks(before)
        const pending = formulas.filter((formula) => formula.kind === 'text' && formula.align !== 2)

        if (formulas.length === 0) {
          return {
            ok: false,
            status: 'failed',
            message: '没有找到可识别的独占公式，未执行修改；含正文的行内公式不会被移动。',
            ...emptyResult,
            documentId
          }
        }

        for (let index = 0; index < pending.length; index += 50) {
          const batch = pending.slice(index, index + 50)
          parseLarkCliJson(
            (await runLarkCli(buildLarkCenterBatchArgs(documentId, batch, randomUUID()))).stdout
          )
          batch.forEach((formula) => submittedBlockIds.add(formula.blockId))
        }

        const after = await readLarkDocumentBlocks(documentId)
        return buildLarkCenterProgressResult(formulas, submittedBlockIds, after, undefined, documentId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (documentId && formulas.length > 0) {
          let verifiedResponse: unknown
          try {
            verifiedResponse = await readLarkDocumentBlocks(documentId)
          } catch {
            // The submitted count remains useful when the verification read itself is unavailable.
          }
          return buildLarkCenterProgressResult(formulas, submittedBlockIds, verifiedResponse, message, documentId)
        }
        return {
          ok: false,
          status: 'failed',
          message,
          ...emptyResult
        }
      }
    }
  )
  handleTrusted('lark:write', async (_event, rawInput: unknown): Promise<LarkWriteResult> => {
    const input = larkWriteSchema.parse(rawInput) as LarkWriteInput
    if (input.mode !== 'create') {
      if (!input.docUrl || !/^https?:\/\/[A-Za-z0-9._~:/?#[\]@!$'()*+,;=%-]+$/.test(input.docUrl)) {
        throw new Error('请输入有效的飞书文档链接。')
      }
    }

    const temporaryDirectory = await fs.mkdtemp(path.join(app.getPath('temp'), 'clarity-lark-'))
    try {
      await fs.writeFile(path.join(temporaryDirectory, 'content.xml'), input.xml, 'utf8')
      const args = buildLarkWriteArgs(input)
      const result = await runLarkCli(args, temporaryDirectory)
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>
      const url = extractLarkDocumentUrl(parsed)
      return { ok: true, message: input.mode === 'create' ? '飞书文档创建成功。' : '飞书文档更新成功。', url, raw: parsed }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true })
    }
  })
}

// Recovery must only run in the owning instance: another launch must never
// publish or rename partial files belonging to a recording that is still live.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.claritydesk.app')
    await fs.mkdir(recordingsDirectory(), { recursive: true })
    await recoverInterruptedSessions()
    registerIpcHandlers()

    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      const primary = sources[0]
      if (!primary) {
        callback({})
        return
      }
      callback({ video: primary, audio: 'loopback' })
    })

    createWindow()
    tray = new Tray(createTrayImage())
    tray.setToolTip('Clarity Desk')
    tray.on('double-click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    updateTrayMenu()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow?.show()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !recordingActive) app.quit()
})
