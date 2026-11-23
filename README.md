# Overlap — Solana wallet tracker

Overlap finds wallet addresses that bought multiple Solana tokens within selected time ranges. It is a research tool for comparing buyer activity across tokens, with transaction links for checking the evidence. It does not require a connected wallet and cannot execute trades.

## What it does

- Compare 2–10 token mint addresses, with a common period or a separate UTC time range for each token.
- Require purchases of every token, or at least N selected tokens.
- Apply a minimum USD value to individual buys and a separate minimum total bought per wallet, per token. For example, five $20 buys satisfy a $100 total threshold when the individual-trade minimum is $20 or lower.
- Rank matches by number of matching tokens, then most recent observed buy. This is overlap ranking, not a profitability or insider score.
- Show known purchase amounts, buy counts, first/last observed buys, and up to three recent transaction links per matching token.
- Export matching tokens and filter settings to CSV.
- Pause/resume scans, enforce a per-run request budget, and save progress after each page.
- Display incomplete coverage and unresolved dense intervals rather than treating partial results as complete blockchain history.

## How scanning works

1. Validate and deduplicate input mint addresses; freeze each token's requested time range.
2. Fetch token metadata and paginated swap records through the server. Only buys inside the requested half-open interval `[start, end)` count.
3. Apply the individual-trade threshold, deduplicate saved provider records, and aggregate qualifying buys by wallet and token.
4. Check each token's known USD total against the aggregate threshold, then apply the required token count. Unknown USD values never count toward a dollar threshold.
5. Scan recent-to-old time windows, rotating between tokens. Busy windows are narrowed after 2,000 rows, retaining overlap at the boundary second. At one-second resolution, continue pagination to the existing 10,000-row ceiling and report a gap if the provider still indicates more records.
6. Fingerprint provider pages. If a page repeats within the same time window or an unfinished page is empty, pause without advancing its checkpoint.
7. Retry rate limits and temporary gateway failures with bounded backoff. Access-denied responses stop immediately.

The browser writes trades and checkpoints in one IndexedDB transaction. Existing v4 scans retain their saved state; new settings default to all tokens and no aggregate threshold when absent.

## Stack

| Component | Technology and responsibility |
| --- | --- |
| Frontend | Plain HTML, CSS and JavaScript embedded in `index.js`; responsive interface, light/dark theme |
| Backend | Cloudflare Worker using Fetch and Web Crypto APIs; validates requests and proxies data requests |
| Market data | Birdeye Solana token metadata and swap transaction APIs |
| Local scan storage | Browser IndexedDB for saved trades/checkpoints; Web Locks to prevent simultaneous scans in the same browser origin |
| Preferences | Browser localStorage for theme |
| Evidence links | Solscan transaction and account pages |
| Code hosting | GitHub |
| Tests | Node.js built-in test runner; no test framework dependency |

## API routes

- `GET /` — application interface.
- `GET /api/status` — scanner protocol version and whether the data secret is configured.
- `GET /api/token?mint=...` — token metadata.
- `POST /api/trades` — one validated token/time-window/page request.

## Deployment

Deploy `index.js` as a Cloudflare Worker module. Add `BIRDEYE_API_KEY` as a **runtime secret** in Cloudflare; never commit the value to GitHub or put it in browser code.

For Git-based deployment, connect the existing Worker to this repository and its production branch. The included `wrangler.jsonc` targets `winter-poetry-8d26solana-wallet-finder`, uses `index.js` as its entry point and compatibility date `2026-11-23`, and preserves dashboard variables with `keep_vars: true`. Preserve any existing resource bindings and routes when migrating configuration. The normal deploy command is `npx wrangler deploy`; this single-file application needs no separate frontend build step.

The Worker name and compatibility date were supplied by the project owner. A successful GitHub commit alone does not prove a successful Cloudflare deployment; check Cloudflare's deployment history and the live application.

## Testing

With a recent Node.js installation, run:

```sh
node --test scanner.test.mjs
```

Tests cover aggregate thresholds, all/N-of-M matching, time boundaries, invalid filters, repeated pages, dense-window pagination, malformed swap values, temporary-error retries, and parity between the exported and embedded browser helpers. These are local tests; they do not establish live provider completeness or API-plan access.

## Limits and interpretation

- A wallet match means the provider reported qualifying buys. `owner` attribution is provider-supplied, not independently verified against raw Solana transactions. Swap-route legs may not correspond one-to-one with end-user purchases. Ambiguous same-token swaps are rejected, but this is not full route-level reconciliation.
- First observed buy means earliest qualifying buy found in the searched range, not the wallet's lifetime first purchase.
- Totals include only buys that passed the individual-trade threshold. They are not current holdings, net investment, profit, or realized P&L.
- A finished scan exhausts the provider pages queried, not necessarily every historical blockchain transaction. Empty or partial results do not establish that no matching wallet exists.
- Scanning runs in the browser. Closing the tab stops requests; reopening the same browser/origin can resume. There is no server-side job queue or database, cross-device resume, or shared historical cache yet.
- Candidate-first wallet lookups and independent buyer verification are not implemented. They require verified provider support and additional data retrieval.
- Request pacing is per browser scan, not a global quota. Public multi-user use needs server-side abuse controls and coordinated provider-rate limits.
- Birdeye credentials, plan access and historical coverage determine available data. Do not expose API keys in the repository.
