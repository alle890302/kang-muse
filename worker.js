// KANG MUSE — verification-first agent endpoint (Agent Games · Wildcard)
// Read-only. Verifies a BSC token's identity and PancakeSwap V2 pool state
// from on-chain evidence, and returns a verdict anyone can re-check.
// No keys, no signing, no transactions — verification only.

const RPCS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
];
const FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"; // PancakeSwap V2 factory (BSC)
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

// Function selectors (keccak-verified; see AGENTS.md lessons — derived, never guessed)
const SEL = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  getPair: "0xe6a43905",
  getReserves: "0x0902f1ac",
  balanceOf: "0x70a08231",
};

const pad = (addr) => addr.toLowerCase().replace("0x", "").padStart(64, "0");
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");

async function rpc(method, params) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // BSC dataseeds reject requests without a browser User-Agent (403)
          "user-agent": "Mozilla/5.0 (compatible; KangMuseVerifier/1.0)",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all RPC nodes failed");
}

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const toBig = (hex) => BigInt(hex);

function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  const b = hex.slice(2);
  // ABI dynamic string: offset(32) length(32) data
  if (b.length >= 128) {
    const len = Number(toBig("0x" + b.slice(64, 128)));
    const data = b.slice(128, 128 + len * 2);
    return Buffer.from(data, "hex").toString("utf8");
  }
  return Buffer.from(b.replace(/(00)+$/, ""), "hex").toString("utf8");
}

async function verifyToken(token) {
  const [nameHex, symHex, decHex, supHex, pairHex, blockHex] = await Promise.all([
    call(token, SEL.name),
    call(token, SEL.symbol),
    call(token, SEL.decimals),
    call(token, SEL.totalSupply),
    call(FACTORY, SEL.getPair + pad(token) + pad(WBNB)),
    rpc("eth_blockNumber", []),
  ]);
  const decimals = Number(toBig(decHex));
  const pair = "0x" + pairHex.slice(-40);
  const hasPair = toBig(pairHex) !== 0n;
  let pool = null;
  if (hasPair) {
    const resHex = await call(pair, SEL.getReserves);
    const r = resHex.slice(2);
    const reserve0 = toBig("0x" + r.slice(0, 64));
    const reserve1 = toBig("0x" + r.slice(64, 128));
    // Cross-check reserves against real balances — a single node's
    // getReserves can lie (observed 16x divergence); balances are truth.
    const balToken = toBig(await call(token, SEL.balanceOf + pad(pair)));
    const balWbnb = toBig(await call(WBNB, SEL.balanceOf + pad(pair)));
    const tokenIs0 = reserve0 === balToken;
    const wbnbReserve = tokenIs0 ? reserve1 : reserve0;
    const tokenReserve = tokenIs0 ? reserve0 : reserve1;
    pool = {
      pair,
      wbnbLiquidity: Number(wbnbReserve) / 1e18,
      tokenReserve: Number(tokenReserve) / 10 ** decimals,
      reservesMatchBalances: wbnbReserve === balWbnb && tokenReserve === balToken,
      sellable: wbnbReserve > 0n,
    };
  }
  return {
    token,
    name: decodeString(nameHex),
    symbol: decodeString(symHex),
    decimals,
    totalSupply: Number(toBig(supHex)) / 10 ** decimals,
    pool,
    verdict: !hasPair
      ? "NO_POOL — token identity verified on-chain; no PancakeSwap V2 pool vs WBNB exists."
      : pool.sellable
        ? "POOL_LIVE — pool exists and holds WBNB liquidity."
        : "POOL_EMPTY — pair contract exists but holds no WBNB.",
    evidence: { block: Number(toBig(blockHex)), rpc: "2-node failover, reserves cross-checked vs balanceOf" },
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, agent: "KANG MUSE", mode: "read-only verification" });
    }
    if (url.pathname === "/verify") {
      const token = url.searchParams.get("token");
      if (!isAddr(token)) {
        return Response.json({ error: "pass ?token=0x… (BSC address)" }, { status: 400 });
      }
      try {
        return Response.json(await verifyToken(token));
      } catch (e) {
        return Response.json({ error: String(e.message || e) }, { status: 502 });
      }
    }
    return Response.json({
      agent: "KANG MUSE — verification-first agent",
      endpoints: { health: "/health", verify: "/verify?token=0x…" },
      principle: "Don't trust the agent. Verify it.",
    });
  },
};
