# Overlap — Solana wallet tracker

Overlap finds wallet addresses that bought multiple Solana tokens within selected time ranges. It is a research tool for comparing buyer activity across tokens, with transaction links for checking the evidence. It does not require a connected wallet and cannot execute trades.

## What it does

- Compare 2–10 token mint addresses, with a common period or a separate UTC time range for each token.
- Require purchases of every token, or at least N selected tokens.
- Apply a minimum USD value to individual buys and a separate minimum total bought per wallet, per token. For example, five $20 buys satisfy a $100 total threshold when the individual-trade minimum is $20 or lower.
- Default to historical buyers; optionally find current holders with buy evidence, or buyers within an adjustable number of minutes after token creation. Entry dates intersect that early window.
- Count each owner wallet once per token. Rank by overlap count, then latest buy or realized profitability. Display matched tokens and overlap percentage.
- Optionally filter by all-time wallet realized PnL and win rate. Missing metrics do not pass active filters; they are never treated as zero.
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
7. Retry trade rate limits and temporary gateway failures with bounded backoff. Access-denied responses stop immediately.
8. After history scanning, verify potential overlap candidates in batches of up to 100 accounts. Exclude known pool IDs, executable/program-owned accounts, off-curve authorities, and accounts with data. Only existing, on-curve, zero-data System Program accounts pass. Unknown accounts are excluded and flagged.
9. For holder mode, query token accounts by owner and mint, checking exact raw balances across all accounts. A transfer or airdrop alone cannot qualify because buy evidence is still required. For early mode, fetch creation time before scanning; unavailable creation time pauses the scan.
10. Fetch optional PnL only for qualifying candidates. The minimum PnL and profitability ranking use realized USD PnL, all time across the wallet. Win rate is wins divided by wins plus losses for fully realized positions; no observations means unavailable. This is not PnL for the selected tokens or entry dates.

The browser writes trades and checkpoints in one IndexedDB transaction. Existing v4 scans retain saved history and migrate to historical mode, with wallet verification pending. Resume finishes verification and enrichment under the same request budget. Maps aggregate by owner, per-token keys ensure one overlap contribution, and sets deduplicate addresses, pool exclusions, and saved page records.

## Stack

| Component | Technology and responsibility |
| --- | --- |
| Frontend | Plain HTML, CSS and JavaScript embedded in `index.js`; responsive interface, light/dark theme |
| Backend | Cloudflare Worker using Fetch and Web Crypto APIs; validates requests and proxies data requests |
| Market data | Birdeye token metadata, creation, swap transactions and wallet PnL; Solana JSON-RPC account and balance checks |
| Response cache | Bounded in-memory map, in-flight request reuse and Cloudflare Cache API |
| Local scan storage | Browser IndexedDB for saved trades/checkpoints; Web Locks to prevent simultaneous scans in the same browser origin |
| Preferences | Browser localStorage for theme |
| Evidence links | Solscan transaction and account pages |
| Code hosting | GitHub |
| Tests | Node.js built-in test runner; no test framework dependency |

## API routes

- `GET /` — application interface.
- `GET /api/status` — scanner protocol version and whether the data secret is configured.
- `GET /api/token?mint=...` — token metadata; add `creation=1` for early-entry creation time.
- `POST /api/trades` — one validated token/time-window/page request.
- `POST /api/accounts` — verify up to 100 unique wallet owners.
- `GET /api/balance?wallet=...&mint=...` — positive current balance across token accounts.
- `GET /api/metrics?wallet=...` — available all-time wallet realized PnL and win rate.

Successful upstream responses are cached: metadata 1 hour, creation 24 hours, trade pages and PnL 5 minutes, account and balance checks 2 minutes. Identical simultaneous requests share one upstream call. Errors are not cached. Browser checkpoints preserve results during resume; start a new scan to refresh snapshots. Request budgets count application requests, including cache hits; some endpoints make multiple upstream calls.

## Deployment

Deploy `index.js` as a Cloudflare Worker module. Add `BIRDEYE_API_KEY` as a **runtime secret** in Cloudflare; never commit the value to GitHub or put it in browser code.

Optional: configure `SOLANA_RPC_URL` as a runtime secret for a dedicated **Solana mainnet** RPC endpoint. The public mainnet endpoint is used otherwise and may rate-limit account or balance checks. A verification failure pauses without accepting unverified matches. Birdeye plan access to creation and wallet PnL endpoints determines whether those features have data.

For Git-based deployment, connect the existing Worker to this repository and its production branch. The included `wrangler.jsonc` targets `winter-poetry-8d26solana-wallet-finder`, uses `index.js` as its entry point and compatibility date `2026-11-23`, and preserves dashboard variables with `keep_vars: true`. Preserve any existing resource bindings and routes when migrating configuration. The normal deploy command is `npx wrangler deploy`; this single-file application needs no separate frontend build step.

The Worker name and compatibility date were supplied by the project owner. A successful GitHub commit alone does not prove a successful Cloudflare deployment; check Cloudflare's deployment history and the live application.

## Testing

With a recent Node.js installation, run:

```sh
node --test scanner.test.mjs
```

Tests cover aggregate thresholds, unique-owner N-of-M matching, early/holder modes, missing metrics, profitability ordering, account and transfer exclusions, balance parsing, caching/coalescing, Worker routes, time boundaries, repeated pages, dense-window pagination, retries, and parity between exported and embedded browser helpers. These are local tests; they do not establish live provider completeness or API-plan access.

## Limits and interpretation

- A wallet match means the provider reported qualifying buys. `owner` attribution is provider-supplied, not independently verified against raw Solana transactions. Swap-route legs may not correspond one-to-one with end-user purchases. Ambiguous same-token swaps are rejected, but this is not full route-level reconciliation.
- First observed buy means earliest qualifying buy found in the searched range, not the wallet's lifetime first purchase.
- Totals include only buys that passed the individual-trade threshold. They are not current holdings, net investment, profit, or realized P&L.
- A finished scan exhausts the provider pages queried, not necessarily every historical blockchain transaction. Empty or partial results do not establish that no matching wallet exists.
- Scanning runs in the browser. Closing the tab stops requests; reopening the same browser/origin can resume. There is no server-side job queue or database or cross-device resume. Cached responses are temporary, not an archival database.
- Account verification is conservative: program-based smart wallets and closed accounts may be excluded. It verifies account type, not raw transaction attribution or real-world identity. Pool IDs come from the swap feed.
- Trading metrics depend on provider backfill and are labeled potentially incomplete even when available. Balance checks reflect current snapshots, not balances at a historical cutoff. Incomplete history can undercount overlap. Verified matches appear after history scanning and account checks; resume also continues unfinished enrichment.
- Request pacing is per browser scan, not a global quota. Public multi-user use needs server-side abuse controls and coordinated provider-rate limits.
- Birdeye credentials, plan access and historical coverage determine available data. Do not expose API keys in the repository.

## Troubleshooting stale builds

If Cloudflare reports that `wrangler.jsonc` is missing, check the build's commit SHA. Commit `af62365` predates that file; retrying that revision will not pick up newer commits. Select a new build from the latest `main` revision. To diagnose the checkout, temporarily use `git rev-parse HEAD && git ls-tree --name-only HEAD` as the build command. The list must contain `wrangler.jsonc`. If new pushes do not appear in Cloudflare, inspect the GitHub integration and its repository access.
