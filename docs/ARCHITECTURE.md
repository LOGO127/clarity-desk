# Architecture

Clarity Desk is an Electron desktop application with a deliberately small trust boundary.

## Processes

### Renderer

The renderer uses React and has no Node.js access. `contextIsolation`, sandboxing, and a restrictive Content Security Policy are enabled. It is responsible for:

- UI state and navigation.
- Markdown parsing, formula classification, and local preview.
- Requesting microphone/display media streams from Chromium.
- Encoding three Opus/WebM tracks with `MediaRecorder`.

### Preload

The preload exposes a narrow typed API through `contextBridge`. It does not expose `ipcRenderer`, filesystem primitives, shell execution, or environment variables.

### Main process

The main process owns all privileged operations:

- Atomic session metadata and append-only audio fragments.
- Interrupted-session recovery.
- Tray behavior and window lifecycle.
- Encrypted API-key storage.
- OpenAI transcription network requests.
- Validated `lark-cli` execution.

## Recording data flow

1. Chromium obtains the selected microphone and a Windows loopback stream.
2. Web Audio creates a mixed stream without changing the two original tracks.
3. Three `MediaRecorder` instances emit Opus fragments every second.
4. Each fragment crosses isolated IPC and is appended to a `.partial` file.
5. Every ten minutes, or at normal stop, the partial file is finalized and added to `metadata.json`.
6. If the app exits unexpectedly, the next startup recovers partial files and marks the session for manual review.

The recording path does not depend on transcription. API failure cannot destroy the original audio.

## Formula conversion

Markdown is parsed into an mdast tree with `remark-parse`, `remark-gfm`, and `remark-math`. Block `math` nodes are emitted as:

```xml
<p align="center"><latex>...</latex></p>
```

Inline `inlineMath` nodes stay in their containing paragraph. Text and attributes are XML-escaped, and URLs are restricted to `http`, `https`, and `mailto`.

## Security decisions

- No renderer Node integration.
- No generic shell or filesystem IPC method.
- Session identifiers and file names are validated before path construction.
- API keys never cross back into the renderer after storage.
- `lark-cli` arguments are allow-listed and document content is passed through a temporary file rather than the command line.
- Temporary flying-document files are removed after each operation.
- No telemetry or auto-update service in the first release.

## Known boundaries

- Windows is the primary supported platform for loopback recording.
- Speaker labels returned by the transcription provider may be generic unless a reference voice is supplied.
- A recovered WebM stream can lack a clean final cue block; most players can read streaming WebM, but users should verify recovered sessions.
- Feishu write support depends on a compatible `@larksuite/cli` installation and user-granted document permissions.
