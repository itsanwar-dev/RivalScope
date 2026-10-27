# RivalScope

A minimal TypeScript/Node development starter, initialized to make this repository usable in a Codex cloud environment. Product features can be added on this baseline.

## Requirements

- Node.js 24.19.0 (`.nvmrc`)
- npm 11 (developed with 11.9.0)
- No database, credentials, or external services are required.

## Development

Run these commands from the repository root (`/workspace/RivalScope` in the cloud environment):

```sh
npm ci
npm run check
npm run dev
```

`dev` runs the TypeScript source with Node's built-in file watcher. The server defaults to host `127.0.0.1` and port `3000`; set `HOST` and `PORT` in the process environment to override them. No `.env` file loader is used. The npm cache lives in the ignored `.cache/npm` directory, so setup does not need to write to the user's home directory.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exact dependencies from the committed lockfile |
| `npm run dev` | Run source with automatic restart on file changes |
| `npm run typecheck` | Check TypeScript without generating output |
| `npm run build` | Compile source to `dist/` |
| `npm test` | Build and run HTTP and process lifecycle tests |
| `npm run check` | Run type checking, build, and tests |
| `npm start` | Run compiled output after a build |

## HTTP readiness

- `GET /health` returns HTTP 200 and `{"status":"ok"}`.
- `GET /` returns starter metadata.
- Unknown paths return 404; unsupported methods on known paths return 405.

Validate internally with `curl --fail --silent http://127.0.0.1:3000/health`. Stop the server with Ctrl-C or SIGTERM.

## Cloud lifecycle

Use the existing checkout: each Codex cloud task is already isolated, so no Git worktree is needed unless explicitly requested. Installation and startup instructions are also saved in the cloud environment configuration. Installed files can be retained in a published snapshot, but running processes must be restarted in future tasks.

Required checks are `npm run check` and a live HTTP readiness request after starting the server. CI runs the same checks on Node 24. There is no frontend, database, or external API integration to validate yet.
