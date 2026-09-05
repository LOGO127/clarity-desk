# Privacy

Clarity Desk is local-first software.

## Data stored locally

- Microphone, system, and mixed audio tracks.
- Session metadata, generated transcripts, and resumable transcription checkpoints.
- An encrypted OpenAI API Key, if configured.

Recordings are stored under `Documents/Clarity Desk/Sessions` unless a future version adds a user-selected location. Uninstalling the application does not silently delete recordings.

## Network activity

Clarity Desk has no telemetry. Network requests occur only when the user explicitly:

1. starts a transcription, which uploads the selected session's mixed audio chunks to OpenAI; or
2. uses `lark-cli` to authenticate, read a document for centering, or update a Feishu document.

Connection checks run when opening the formula tool or settings and can cause `lark-cli` to validate authentication state. They do not upload recordings.

Review the applicable provider's privacy terms before enabling either integration.

## API keys

The OpenAI API Key is encrypted using Electron `safeStorage` (Windows DPAPI). If secure storage is unavailable, the application refuses to save the key rather than falling back to plaintext.

## Recording consent

The user is responsible for obtaining any consent required by law, contract, company policy, or meeting rules. Do not use Clarity Desk for covert recording, surveillance, harassment, or publication without permission.

## Deletion

Session deletion is intentionally not automated in the first release. Users can open the session folder and move selected sessions to the Recycle Bin. This reduces the chance of an accidental irreversible deletion from the app UI.
