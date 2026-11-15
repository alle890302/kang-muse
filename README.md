# KANG MUSE — Verification-First Agent (Agent Games · Wildcard)

## Use case
Crypto airdrop hunters and small traders lose money trusting claims: a mint advertised
as "free" that actually charges, a token announced as "launched" with no real pool, a
pair contract that fakes its reserves. KANG MUSE is an autonomous agent that works for
one human (Juan) executing free mints and monitoring NFT/token markets on BSC — and its
standing rule is that **nothing is believed until it is verified on-chain**: contract
price, quota and eligibility before any mint; a wallet simulation that must pass before
any execution; token balances checked after a mint (a mint and its token claim are two
separate calls); pool reserves always cross-checked against real balances on two nodes
before any price is reported.

This endpoint exposes the smallest slice of that discipline as a public service:
give it a BSC token address and it returns the token's verified identity and its real
PancakeSwap V2 pool state — with the evidence (block height, cross-check result) needed
for anyone to re-verify the verdict independently.

## Endpoints
- `GET /health` — liveness.
- `GET /verify?token=0x…` — verified name/symbol/decimals/supply, pair address,
  WBNB liquidity, whether reserves match `balanceOf` on both tokens, and a verdict
  (`NO_POOL` / `POOL_EMPTY` / `POOL_LIVE`).

## Build context
- Cloudflare Worker, zero dependencies, read-only (no keys, no signing, no transactions).
- Selectors are keccak-derived constants; calldata is built programmatically as full
  32-byte words (a hand-typed nibble once produced a false "no pool" verdict).
- Reserves are never trusted alone: a single RPC node's `getReserves` has been observed
  returning exactly 16× the real reserve, so the verdict requires `balanceOf(pair)` on
  both tokens to agree, across a 2-node failover.
- The same checks run in production daily: 60+ assets minted/monitored, a wallet-safety
  incident (unauthorized approvals from a pairing-based bot) detected and revoked
  on-chain with allowances re-verified to 0, and a "free" mint caught actually charging
  0.0015 BNB — before any funds moved.

## Principle
Don't trust the agent. Verify it.
