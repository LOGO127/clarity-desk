# Contributing

Thank you for helping improve Clarity Desk.

## Setup

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
npm run test:desktop
```

Dependency checks use the official registry's advisory endpoint:

```bash
npm audit --registry=https://registry.npmjs.org
```

Some registry mirrors do not implement security auditing. An audit request error is not a zero-vulnerability result. Major dependency upgrades should be reviewed separately; check bundler peer ranges and the renderer/CSS versions together, and verify Windows packaging when changing Electron or rcedit.

## Pull requests

- Keep changes focused and explain the user-facing problem.
- Add tests for parser, storage, or transcript-merging behavior.
- Do not commit recordings, transcripts, API keys, tokens, `.env` files, or screenshots containing personal data.
- Preserve the non-overlay design: do not introduce always-on-top windows or meeting-screen overlays without prior discussion.
- New IPC handlers must use the centralized trusted-sender wrapper, validate inputs, and never expose a generic shell or arbitrary filesystem access.
- UI changes should work at the minimum supported window size (800 × 620) and with reduced-motion preferences.
- Keep optional renderer features lazy-loaded. Renderer-only dependencies belong in devDependencies because Vite already bundles them.

## Commit style

Short imperative commits are preferred, for example:

```text
fix: recover interrupted audio fragments
feat: export renamed speaker labels
docs: clarify Feishu authentication
```

## Test data

Use synthetic audio and invented transcripts. Never upload a real interview recording to an issue or pull request.

`npm test` includes four Node.js tests for smoke-startup sequencing, in addition to the application unit tests. Source and packaged smoke use the same small readiness helper: wait for the exact built renderer file URL, then the visible main heading, before invoking the application bridge. Do not replace this with a fixed delay or retry failed IPC calls.

`scripts/electron-smoke.cjs` always supplies an isolated `--user-data-dir` and `--clarity-smoke-test`. The latter redirects recordings and startup recovery to that profile's `smoke-recordings` directory, including in packaged builds. Do not remove these isolation arguments when testing locally. Normal startup retains the user's existing Documents directory; packaged builds ignore the development-only `CLARITY_DESK_RECORDINGS_DIR` variable.

The opt-in `scripts/feishu-live-acceptance.cjs` performs real writes only when both `CLARITY_ALLOW_TEST_DOCUMENT_WRITE=1` and `FEISHU_TEST_DOC_URL` are supplied. Use a disposable document with at least one uncentered formula and explicit permission. This script is not part of CI; do not configure repository secrets to run it automatically. Verify content preservation and Feishu visual rendering separately.
