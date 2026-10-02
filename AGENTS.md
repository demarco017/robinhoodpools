# Base44 Development Notes

## Project

RobinhoodPools (`rhpools`) — a standalone Python observatory for liquidity pools
on Robinhood Chain (chain ID 4663). One process serves the HTTP API, static
HTML/CSS/JS terminal, and a SQLite index fed by public RPC.

## Stack

- Python 3.11+, managed with [uv](https://docs.astral.sh/uv/) and hatchling
- No external credentials needed for the default run (public RPC endpoint)
- SQLite database stored under `RHP_DATA_DIR` (set to `/data` in compose)

## Running in Base44

`docker compose -f docker-compose.base44.yml up -d` starts the app on port 3000.

The compose passes `--public-origin https://3000-${BASE44_PUBLIC_HOST_SUFFIX}`
so the preview iframe can load pages. Without `--public-origin`, the app sends
`X-Frame-Options: DENY` and `frame-ancestors 'none'` for all HTML pages, which
blocks iframe embedding. The `_asset` method in `lp_server.py` includes
configured origins in the CSP `frame-ancestors` directive.

## Verification

```sh
curl -fsS http://localhost:3000/                          # serves the terminal
curl -fsS http://localhost:3000/api/lp/status             # JSON status
docker compose -f docker-compose.base44.yml exec -T app uv run pytest -x -q
```

## Tests

All 248 tests are deterministic and pass under `uv run pytest`.
