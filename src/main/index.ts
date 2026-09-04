import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
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
import { fileURLToPath } from 'node:url'
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
  buildLarkListBlocksArgs,
  buildLarkResolveDocumentArgs,
  buildLarkWindowsCommand,
  buildLarkWriteArgs,
  extractLarkAuthFlow,
  extractLarkDocumentId,
  extractLarkDocumentUrl,
  findStandaloneFormulaBlocks
} from './lark-cli'
import { createSessionId, isValidSessionId } from './session-id'

const execFileAsync = promisify(execFile)
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = !app.isPackaged
const MAX_TRANSCRIPTION_FILE_BYTES = 25 * 1024 * 1024
const RECORDING_SEGMENT_DURATION_MS = 10 * 60 * 1000

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let recordingActive = false
let isQuitting = false

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
  const destination = metadataPath(metadata.id)
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
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
      if (metadata.status !== 'recording') continue
      const directory = sessionDirectory(entry.name)
      const files = await fs.readdir(directory)
      const partialFiles = files.filter((file) => /^(microphone|system|mixed)-\d{4}\.(webm|ogg|m4a)\.partial$/.test(file))
      let recoveredDurationMs = 0
      for (const partialName of partialFiles) {
        const match = partialName.match(/^(microphone|system|mixed)-(\d{4})\.(webm|ogg|m4a)\.partial$/)
        if (!match?.[1] || !match[2] || !match[3]) continue
        const track = match[1] as RecordingChunk['track']
        const index = Number(match[2])
        const extension = match[3]
        const finalName = partialName.replace(/\.partial$/, '')
        const partialPath = path.join(directory, partialName)
        const finalPath = path.join(directory, finalName)
        const stat = await fs.stat(partialPath)
        await fs.rename(partialPath, finalPath)
        const startedAtMs = index * RECORDING_SEGMENT_DURATION_MS
        const elapsedByMtime = Math.max(1_000, stat.mtimeMs - new Date(metadata.createdAt).getTime() - startedAtMs)
        const durationMs = Math.min(RECORDING_SEGMENT_DURATION_MS, elapsedByMtime)
        recoveredDurationMs = Math.max(recoveredDurationMs, startedAtMs + durationMs)
        metadata.chunks.push({
          track,
          index,
          fileName: finalName,
          mimeType: extension === 'ogg' ? 'audio/ogg' : extension === 'm4a' ? 'audio/mp4' : 'audio/webm',
          size: stat.size,
          startedAtMs,
          durationMs
        })
      }
      metadata.chunks = metadata.chunks
        .filter((chunk, index, chunks) => chunks.findIndex((other) => other.track === chunk.track && other.index === chunk.index) === index)
        .sort((left, right) => left.startedAtMs - right.startedAtMs || left.track.localeCompare(right.track))
      metadata.durationMs = Math.max(metadata.durationMs, recoveredDurationMs)
      metadata.status = metadata.chunks.length ? 'ready' : 'failed'
      metadata.error = metadata.chunks.length
        ? '上次录音异常中断，Clarity Desk 已恢复落盘的音频片段。请先试听确认完整性。'
        : '上次录音异常中断，未找到可恢复的音频片段。'
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
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 680,
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
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(currentDirectory, '../renderer/index.html'))
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

  const payload = (await response.json()) as {
    segments?: Array<{ speaker?: string; text?: string; start?: number; end?: number }>
  }
  return (payload.segments ?? [])
    .filter((segment) => typeof segment.text === 'string')
    .map((segment) => ({
      speaker: segment.speaker || '说话人',
      text: segment.text?.trim() ?? '',
      start: offsetSeconds + (segment.start ?? 0),
      end: offsetSeconds + (segment.end ?? segment.start ?? 0)
    }))
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
      throw new Error(typeof envelope.message === 'string' ? envelope.message : '飞书请求失败。')
    }
  }
  return parsed
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

function registerIpcHandlers(): void {
  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    platform: process.platform,
    recordingsDirectory: recordingsDirectory(),
    secureStorageAvailable: safeStorage.isEncryptionAvailable()
  }))
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  ipcMain.handle('clipboard:read-text', () => clipboard.readText())
  ipcMain.handle('clipboard:write-text', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('剪贴板内容无效。')
    clipboard.writeText(text)
  })
  ipcMain.handle('file:save-text', async (_event, defaultName: unknown, content: unknown) => {
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

  ipcMain.handle('session:create', async (_event, rawInput: unknown) => {
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

  ipcMain.handle('session:append-fragment', async (_event, input: AppendFragmentInput): Promise<void> => {
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

  ipcMain.handle('session:finalize-chunk', async (_event, input: FinalizeChunkInput): Promise<RecordingChunk> => {
    assertSessionId(input.sessionId)
    if (!['microphone', 'system', 'mixed'].includes(input.track)) throw new Error('无效的音轨类型。')
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 10_000) throw new Error('无效的切片编号。')
    return withSessionLock(input.sessionId, async () => {
      const extension = mimeExtension(input.mimeType)
      const fileName = `${input.track}-${input.index.toString().padStart(4, '0')}.${extension}`
      const partialPath = path.join(sessionDirectory(input.sessionId), `${fileName}.partial`)
      const filePath = path.join(sessionDirectory(input.sessionId), fileName)
      await fs.rename(partialPath, filePath)
      const stat = await fs.stat(filePath)
      const chunk: RecordingChunk = {
        track: input.track,
        index: input.index,
        fileName,
        mimeType: input.mimeType,
        size: stat.size,
        startedAtMs: Math.max(0, Math.round(input.startedAtMs)),
        durationMs: Math.max(0, Math.round(input.durationMs))
      }
      const metadata = await readMetadata(input.sessionId)
      metadata.chunks = metadata.chunks.filter((entry) => !(entry.track === chunk.track && entry.index === chunk.index))
      metadata.chunks.push(chunk)
      metadata.chunks.sort((left, right) => left.startedAtMs - right.startedAtMs || left.track.localeCompare(right.track))
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
      return chunk
    })
  })

  ipcMain.handle('session:finalize', async (_event, sessionId: string, durationMs: number) =>
    withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      metadata.durationMs = Math.max(0, Math.round(durationMs))
      metadata.status = 'ready'
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
      return metadata
    })
  )
  ipcMain.handle('session:fail', async (_event, sessionId: string, error: string) =>
    withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      metadata.status = 'failed'
      metadata.error = String(error).slice(0, 1000)
      metadata.updatedAt = new Date().toISOString()
      await writeMetadata(metadata)
    })
  )
  ipcMain.handle('session:list', async (): Promise<SessionSummary[]> => {
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
  ipcMain.handle('session:read-transcript', async (_event, sessionId: string): Promise<TranscriptDocument | null> => {
    assertSessionId(sessionId)
    try {
      return JSON.parse(await fs.readFile(path.join(sessionDirectory(sessionId), 'transcript.json'), 'utf8')) as TranscriptDocument
    } catch {
      return null
    }
  })
  ipcMain.handle('session:transcribe', async (_event, sessionId: string): Promise<TranscriptDocument> => {
    assertSessionId(sessionId)
    const apiKey = await readSecret('openaiApiKey')
    if (!apiKey) throw new Error('请先在设置中保存 OpenAI API Key。')

    return withSessionLock(sessionId, async () => {
      const metadata = await readMetadata(sessionId)
      metadata.status = 'transcribing'
      metadata.updatedAt = new Date().toISOString()
      delete metadata.error
      await writeMetadata(metadata)
      try {
        const mixedChunks = metadata.chunks
          .filter((chunk) => chunk.track === 'mixed')
          .sort((left, right) => left.startedAtMs - right.startedAtMs)
        if (mixedChunks.length === 0) throw new Error('该会话没有可转写的混合音轨。')

        const segments: TranscriptSegment[] = []
        for (const chunk of mixedChunks) {
          const filePath = path.join(sessionDirectory(sessionId), chunk.fileName)
          segments.push(...(await transcribeAudioFile(filePath, apiKey, chunk.startedAtMs / 1000)))
        }
        segments.sort((left, right) => left.start - right.start)
        const document: TranscriptDocument = {
          sessionId,
          title: metadata.title,
          generatedAt: new Date().toISOString(),
          model: 'gpt-4o-transcribe-diarize',
          segments,
          text: segments.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n')
        }
        await fs.writeFile(
          path.join(sessionDirectory(sessionId), 'transcript.json'),
          `${JSON.stringify(document, null, 2)}\n`,
          'utf8'
        )
        await fs.writeFile(path.join(sessionDirectory(sessionId), 'transcript.md'), transcriptToMarkdown(document), 'utf8')
        metadata.status = 'transcribed'
        metadata.updatedAt = new Date().toISOString()
        await writeMetadata(metadata)
        return document
      } catch (error) {
        metadata.status = 'failed'
        metadata.error = error instanceof Error ? error.message : String(error)
        metadata.updatedAt = new Date().toISOString()
        await writeMetadata(metadata)
        throw error
      }
    })
  })
  ipcMain.handle('session:open-folder', async (_event, sessionId: string) => {
    const result = await shell.openPath(sessionDirectory(sessionId))
    if (result) throw new Error(result)
  })
  ipcMain.handle('recording:set-active', (_event, active: boolean) => {
    recordingActive = Boolean(active)
    updateTrayMenu()
  })

  ipcMain.handle('settings:has-api-key', async () => Boolean(await readSecret('openaiApiKey')))
  ipcMain.handle('settings:save-api-key', async (_event, apiKey: unknown) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.length > 500) {
      throw new Error('API Key 格式无效。')
    }
    await saveSecret('openaiApiKey', apiKey.trim())
  })
  ipcMain.handle('settings:delete-api-key', async () => deleteSecret('openaiApiKey'))

  ipcMain.handle('lark:check', checkLarkCli)
  ipcMain.handle('lark:authenticate', async () => {
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
  ipcMain.handle(
    'lark:center-formulas',
    async (_event, rawInput: unknown): Promise<LarkCenterFormulasResult> => {
      const emptyResult = {
        totalFormulaCount: 0,
        updatedFormulaCount: 0,
        alreadyCenteredCount: 0,
        verifiedCenteredCount: 0
      }

      try {
        const input = larkCenterFormulasSchema.parse(rawInput) as LarkCenterFormulasInput
        assertLarkDocumentUrl(input.docUrl)

        const resolved = parseLarkCliJson((await runLarkCli(buildLarkResolveDocumentArgs(input.docUrl))).stdout)
        const documentId = extractLarkDocumentId(resolved) ?? documentIdFromDocxUrl(input.docUrl)
        if (!documentId) throw new Error('无法从该链接解析飞书文档，请确认你对文档有访问权限。')
        assertSafeLarkDocumentId(documentId)

        const before = parseLarkCliJson((await runLarkCli(buildLarkListBlocksArgs(documentId))).stdout)
        const formulas = findStandaloneFormulaBlocks(before)
        const alreadyCentered = formulas.filter((formula) => formula.align === 2)
        const pending = formulas.filter((formula) => formula.align !== 2)

        if (formulas.length === 0) {
          return {
            ok: true,
            message: '没有找到独占一段的公式；含正文的行内公式不会被移动。',
            ...emptyResult,
            documentId
          }
        }

        for (let index = 0; index < pending.length; index += 50) {
          const batch = pending.slice(index, index + 50)
          parseLarkCliJson(
            (await runLarkCli(buildLarkCenterBatchArgs(documentId, batch, randomUUID()))).stdout
          )
        }

        const after = parseLarkCliJson((await runLarkCli(buildLarkListBlocksArgs(documentId))).stdout)
        const verified = findStandaloneFormulaBlocks(after)
        const verifiedById = new Map(verified.map((formula) => [formula.blockId, formula.align]))
        const updatedFormulaCount = pending.filter((formula) => verifiedById.get(formula.blockId) === 2).length
        const verifiedCenteredCount = formulas.filter((formula) => verifiedById.get(formula.blockId) === 2).length
        const ok = updatedFormulaCount === pending.length

        return {
          ok,
          message: ok
            ? pending.length > 0
              ? `已将 ${pending.length} 个独立公式居中，并完成回读校验。`
              : '文档中的独立公式已经全部居中。'
            : `已居中 ${updatedFormulaCount}/${pending.length} 个待处理公式，请重试或检查文档权限。`,
          totalFormulaCount: formulas.length,
          updatedFormulaCount,
          alreadyCenteredCount: alreadyCentered.length,
          verifiedCenteredCount,
          documentId
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          ...emptyResult
        }
      }
    }
  )
  ipcMain.handle('lark:write', async (_event, rawInput: unknown): Promise<LarkWriteResult> => {
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
