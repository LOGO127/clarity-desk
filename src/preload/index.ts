import { contextBridge, ipcRenderer } from 'electron'
import type { ClarityDeskApi } from '../shared/types'

const api: ClarityDeskApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  saveTextFile: (defaultName, content) => ipcRenderer.invoke('file:save-text', defaultName, content),
  createSession: (input) => ipcRenderer.invoke('session:create', input),
  appendRecordingFragment: (input) => ipcRenderer.invoke('session:append-fragment', input),
  finalizeRecordingChunk: (input) => ipcRenderer.invoke('session:finalize-chunk', input),
  finalizeSession: (sessionId, durationMs) => ipcRenderer.invoke('session:finalize', sessionId, durationMs),
  failSession: (sessionId, error) => ipcRenderer.invoke('session:fail', sessionId, error),
  listSessions: () => ipcRenderer.invoke('session:list'),
  readTranscript: (sessionId) => ipcRenderer.invoke('session:read-transcript', sessionId),
  transcribeSession: (sessionId) => ipcRenderer.invoke('session:transcribe', sessionId),
  openSessionFolder: (sessionId) => ipcRenderer.invoke('session:open-folder', sessionId),
  setRecordingActive: (active) => ipcRenderer.invoke('recording:set-active', active),
  onStopRecordingRequested: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('recording:stop-requested', listener)
    return () => ipcRenderer.removeListener('recording:stop-requested', listener)
  },
  hasApiKey: () => ipcRenderer.invoke('settings:has-api-key'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('settings:save-api-key', apiKey),
  deleteApiKey: () => ipcRenderer.invoke('settings:delete-api-key'),
  checkLarkCli: () => ipcRenderer.invoke('lark:check'),
  authenticateLark: () => ipcRenderer.invoke('lark:authenticate'),
  centerLarkFormulas: (input) => ipcRenderer.invoke('lark:center-formulas', input),
  writeToLark: (input) => ipcRenderer.invoke('lark:write', input)
}

contextBridge.exposeInMainWorld('clarity', api)
