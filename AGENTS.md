# AGENTS.md

## Project overview

Robinhood Pools — a single-process Python observatory for liquidity pools on Robinhood Chain (chain ID 4663). One process reads public RPC data, maintains a local SQLite index, and serves both JSON/SSE APIs and a plain-HTML/CSS/JS terminal/workbench. No external credentials are needed for the default run (uses Robinhood Chain's public RPC endpoint).

## Running in the Base44 sandbox

- `docker-compose.base44.yml` runs the app from bind-mounted source via `uv sync --locked && uv run rhpools`.
- The app listens on port 8196 inside the container, mapped to host port 3000 for the preview.
- SQLite database lives in a named volume (`rhpools-data`) at `/data`.
- `--public-origin` is passed using `BASE44_PUBLIC_HOST_SUFFIX` so POST origin checks can work from the preview; GET requests (browsing pools, terminal) have no origin restriction.
- No external secrets required. The default RPC is `https://rpc.mainnet.chain.robinhood.com`.

## Key facts

- Python 3.11+ required; uses `uv` for dependency management (`uv.lock` is committed).
- Entry point: `rhpools` CLI → `rhpools.lp_server:main`.
- POST endpoints (`/api/lp/allocation`, `/api/workbench/simulate`, `/api/workbench/prepare`) require same-origin and most require loopback — they will not work from the preview.
- The app binds to `127.0.0.1` by default; `--host 0.0.0.0` is needed for Docker.
- Health: `GET /` serves the terminal HTML; `GET /api/lp/status` returns index freshness and provider status.
- During startup the server is available but indexed data may be incomplete/stale while it catches up to the chain head.

## Tests

```sh
uv sync --locked --extra test
uv run pytest
```
