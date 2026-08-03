# Plannotator ChatGPT Notes

A Manifest V3 Chrome extension for annotating assistant responses directly on `chatgpt.com`.

## What It Does

- Select assistant text and add inline notes
- Collapse saved notes into side pills beside the selected span
- Insert the generated revision prompt into ChatGPT's native composer
- Hot-reload during development without manually reloading the extension each edit

## Commands

```bash
bun install
bun run build
bun run dev
bun run e2e
bun run e2e:dev-reload
```

## Load In Chrome

1. Build the extension with `bun run build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Load unpacked from `dist/`
