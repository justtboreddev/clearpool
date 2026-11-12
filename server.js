// ClearPool server: static app, relayer, association-set provider (ASP), TEE agent proxy, Intents quotes.
// Holds no user secrets: notes are created and kept in the browser; proofs are generated in the browser.
import express from "express";
import compression from "compression";
import fs from "fs";
import crypto from "crypto";
import { KeyPair, Account } from "near-api-js";
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { verifyMessage } from "ethers";
import * as C from "./lib/core.js";
import { account, view, provider, NEAR, keyFor } from "./lib/near.js";

// ---------- config ----------
try { for (const l of fs.readFileSync(".env", "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2]; } } catch {}
const SUF = process.env.SUFFIX || fs.readFileSync(".keys/suffix", "utf8").trim();
const CONTRACT = `clearpool-${SUF}.testnet`; // the original 1 NEAR pool
// Fixed-size pools: same contract code, one deployment per size. Fixed sizes keep every deposit in a pool identical.
const POOLS = Object.fromEntries([["0.1", 4], ["0.5", 4], ["1", 4], ["5", 2]].map(([amt, seedN]) => [amt, {
  amt, seedN, contract: amt === "1" ? CONTRACT : `clearpool-p${amt.replace(".", "")}-${SUF}.testnet`,
  deposits: [], approved: [], stats: null, syncing: null,
}]));
const poolOf = a => POOLS[String(a ?? "1").replace(/near$/i, "")] || null;
const ASP = `cp-asp-${SUF}.testnet`;
const HACKER = `cp-hacker-${SUF}.testnet`;
const FUNDERS = ["alice", "d1", "d2", "d3"].map(n => `cp-${n}-${SUF}.testnet`);
const FLAGGED = new Set([HACKER, ...(process.env.FLAGGED || "").split(",").filter(Boolean)]);
const MODEL = process.env.NEARAI_MODEL || "Qwen/Qwen3.8-27B";
const NEARAI = "https://cloud-api.near.ai/v1";
const PORT = process.env.PORT || 8080;
const TGAS = 10n ** 12n;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await C.init();
const extraFunders = []; // accounts auto-created from the faucet when demo funds run low: {id, key}

// ---------- chain state + ASP (per pool) ----------
async function sync(P) {
  if (P.syncing) return P.syncing;
  P.syncing = (async () => {
    const stats = await view(P.contract, "get_stats");
    while (P.deposits.length < stats.deposits) P.deposits.push(...await view(P.contract, "get_deposits", { from: P.deposits.length, limit: 50 }));
    P.approved = P.deposits.filter(d => !FLAGGED.has(d.depositor)).map(d => d.commitment);
    const want = C.buildTree(P.approved).root.toString();
    if (P.approved.length && want !== stats.asp_root) {
      log(`ASP publishing ${P.amt} NEAR pool root for`, P.approved.length, "approved deposits");
      await account(ASP).callFunction({ contractId: P.contract, methodName: "set_asp_root", args: { root: want }, gas: 30n * TGAS });
      stats.asp_root = want;
    }
    P.stats = stats;
  })().finally(() => { P.syncing = null; });
  return P.syncing;
}
const syncAll = () => Promise.all(Object.values(POOLS).map(P => sync(P).catch(e => log(P.amt, "sync error", e.message))));
setInterval(syncAll, 10000);

// ---------- demo funding ----------
const balance = async id => BigInt((await provider.viewAccount({ accountId: id })).amount);
const keyOf = id => extraFunders.find(f => f.id === id)?.key || keyFor(id);
async function faucetAccount() {
  const id = `cp-f${crypto.randomBytes(4).toString("hex")}-${SUF}.testnet`;
  const kp = KeyPair.fromRandom("ed25519");
  const r = await fetch("https://helper.nearprotocol.com/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error("faucet unavailable");
  extraFunders.push({ id, key: kp.toString() });
  log("faucet funded", id);
  return id;
}
async function pickFunder(amt = 1) {
  for (const id of [...FUNDERS, ...extraFunders.map(f => f.id)]) {
    try { if (await balance(id) > NEAR(amt + 0.3)) return id; } catch {}
  }
  return faucetAccount();
}
const acct = id => new Account(id, provider, keyOf(id));

async function depositFrom(P, id, commitment) {
  return acct(id).callFunctionRaw({ contractId: P.contract, methodName: "deposit", args: { commitment }, deposit: NEAR(Number(P.amt)), gas: 100n * TGAS, waitUntil: "FINAL" });
}

// seed a small anonymity set so the demo pool isn't empty (these notes are discarded; funds stay in the pool)
async function seed() {
  for (const P of Object.values(POOLS)) {
    try {
      await sync(P);
      for (let i = P.approved.length; i < P.seedN; i++) {
        const id = await pickFunder(Number(P.amt));
        await depositFrom(P, id, C.makeNote().commitment.toString());
        log(`seed ${P.amt} NEAR deposit from`, id);
      }
      await sync(P);
    } catch (e) { log(P.amt, "seed error", e.message); }
  }
}

// ---------- simple rate limit ----------
const hits = new Map();
function limit(req, res, key, max, windowMs) {
  const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
  const k = key + ip, now = Date.now(), arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { res.status(429).json({ error: "Slow down a little. Try again in a few minutes." }); return false; }
  arr.push(now); hits.set(k, arr); return true;
}
const friendly = e => {
  const m = String(e?.message || e);
  const known = ["note already spent", "invalid proof", "association set root not recognised", "unknown pool root", "only the original depositor", "commitment already used", "no such deposit"];
  return known.find(k => m.includes(k)) || m.slice(0, 200);
};
const txHash = r => r?.transaction?.hash || r?.transaction_outcome?.id;

// ---------- TEE attestation + agent ----------
let verifiedSigner = null; // { address, at, checks }
async function attest(nonce) {
  if (!/^[0-9a-f]{64}$/.test(nonce)) nonce = crypto.randomBytes(32).toString("hex");
  const u = new URL(NEARAI + "/attestation/report");
  for (const [k, v] of Object.entries({ model: MODEL, provider: "near", signing_algo: "ecdsa", nonce })) u.searchParams.set(k, v);
  const d = await (await fetch(u, { headers: { "x-no-aliasing": "true", accept: "application/json" } })).json();
  const reps = d.model_attestations || [];
  if (!reps.length) throw new Error("no model attestation returned");
  const out = [];
  for (const m of reps) {
    const r = await getCollateralAndVerify(Buffer.from(m.intel_quote, "hex"));
    const rd = Buffer.from(r.report.data.reportData).toString("hex");
    const addr = m.signing_address.toLowerCase().replace(/^0x/, "");
    out.push({
      signing_address: m.signing_address,
      checks: [
        { name: "Intel TDX quote signature", ok: !!r.status, detail: `TCB ${r.status}` },
        { name: "Your nonce is inside the quote", ok: rd.slice(64) === nonce },
        { name: "Model signing key is inside the quote", ok: rd.slice(0, 40) === addr },
        { name: "NVIDIA GPU evidence present", ok: !!m.nvidia_payload },
      ],
    });
  }
  const good = out.filter(o => o.checks.slice(0, 3).every(c => c.ok));
  if (good.length === 1) verifiedSigner = { address: good[0].signing_address.toLowerCase(), at: Date.now() };
  return { model: MODEL, nonce, reports: out, verified: good.length === 1 };
}

const sha256hex = b => crypto.createHash("sha256").update(b).digest("hex");
const SYSTEM = `You are ClearPool's privacy assistant, running inside a verified TEE.
ClearPool is a privacy pool on NEAR: fixed-size deposits (separate pools of 0.1, 0.5, 1 and 5 NEAR), private withdrawals with a zero-knowledge proof, and only deposits in the approved (clean) set can withdraw privately.
Answer in 1-3 short sentences, plain words, no markdown. Give a clear recommendation.
Rules, in order: if approved is false, say it cannot be withdrawn privately and can only go back to the sender. If depositsAfter is under 3, recommend waiting for more deposits (timing can link you). If minutesSinceDeposit is under 10, suggest waiting a bit longer. If freshRecipient is false, warn that sending to a known account weakens privacy. Otherwise say it's reasonable to withdraw now. Never invent pool numbers; only use the context given.
You never ask for the user's note or secret.`;

async function agentReply(question, ctx) {
  const key = process.env.NEARAI_API_KEY;
  if (!key) return { text: localAdvice(ctx), offline: true };
  if (!verifiedSigner || Date.now() - verifiedSigner.at > 30 * 60e3) await attest();
  const body = JSON.stringify({ model: MODEL, max_tokens: 160, temperature: 0.2, chat_template_kwargs: { enable_thinking: false }, messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Pool context: ${JSON.stringify(ctx)}\nQuestion: ${String(question).slice(0, 400)}` },
  ] });
  const r = await fetch(NEARAI + "/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-no-aliasing": "true", "accept-encoding": "identity" }, body });
  const raw = Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error("agent error " + r.status + " " + raw.toString().slice(0, 120));
  const j = JSON.parse(raw);
  const text = j.choices?.[0]?.message?.content?.trim() || "";
  let signed = { ok: false, detail: "no signature yet" };
  for (let i = 0; i < 6 && !signed.ok; i++) {
    await new Promise(s => setTimeout(s, 700));
    const s = await fetch(`${NEARAI}/signature/${j.id}?signing_algo=ecdsa`, { headers: { authorization: `Bearer ${key}` } });
    if (!s.ok) continue;
    const sj = await s.json();
    if (!sj.signature) continue;
    const expected = `${MODEL}:${sha256hex(Buffer.from(body))}:${sha256hex(raw)}`;
    const signer = verifyMessage(sj.text, sj.signature).toLowerCase();
    signed = { ok: sj.text === expected && signer === verifiedSigner?.address, signer, kind: sj.signature_kind, detail: sj.text === expected ? (signer === verifiedSigner?.address ? "signed by the attested model key" : "signer differs from attested key") : "hash mismatch" };
  }
  return { text, signed, model: MODEL };
}
function localAdvice(c) {
  if (c.approved === false) return "This deposit isn't in the approved set, so it can't be withdrawn privately. You can take it back to the account that sent it.";
  const after = Number(String(c.depositsAfter ?? 0).replace("+", ""));
  if (after < 3) return after === 0 ? "No deposits have landed after yours yet. Waiting for a few more makes it much harder to link you by timing." : `Only ${after} deposit${after > 1 ? "s have" : " has"} landed after yours. Waiting for a few more makes it harder to link you by timing.`;
  return `Your deposit sits among ${c.anonymitySet} approved deposits. Withdrawing to a fresh address now is reasonable.`;
}

// ---------- Intents quote ----------
const DEST = {
  zec: { asset: "nep141:zec.omft.near", label: "ZEC on Zcash", ph: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs" },
  "usdc-base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC on Base", ph: "0x000000000000000000000000000000000000dead" },
  sol: { asset: "nep141:sol.omft.near", label: "SOL on Solana", ph: "11111111111111111111111111111111" },
};
async function quote(to, recipient, amt = 1) {
  const d = DEST[to] || DEST.zec;
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:wrap.near", depositType: "ORIGIN_CHAIN",
    destinationAsset: d.asset, amount: NEAR(amt).toString(), recipient: recipient || d.ph, recipientType: "DESTINATION_CHAIN",
    refundTo: "clearpool.near", refundType: "ORIGIN_CHAIN", deadline: new Date(Date.now() + 5 * 60e3).toISOString(),
  }) });
  const j = await r.json();
  if (!j.quote) throw new Error(j.message || "no quote");
  return { to: d.label, out: j.quote.amountOutFormatted, outUsd: j.quote.amountOutUsd, inUsd: j.quote.amountInUsd, seconds: j.quote.timeEstimate };
}

// ---------- http ----------
const app = express();
app.use(compression());
app.use(express.json({ limit: "200kb" }));
app.use((req, res, next) => { res.set("x-content-type-options", "nosniff"); next(); });
app.use("/zk", express.static("build", { maxAge: "7d", index: false, setHeaders: r => r.set("cache-control", "public, max-age=604800") }));
app.use(express.static("public", { index: "index.html" }));

app.get("/api/state", async (req, res) => {
  try {
    const P = poolOf(req.query.pool);
    if (!P) return res.status(400).json({ error: "Unknown pool size" });
    await sync(P);
    res.json({
      network: "testnet", pool: P.amt, contract: P.contract, asp: ASP, denomination: P.amt, stats: P.stats, poolRoot: P.stats.last_root, aspRoot: P.stats.asp_root,
      pools: Object.values(POOLS).map(x => ({ amount: x.amt, contract: x.contract, deposits: x.deposits.length })),
      poolLeaves: P.deposits.map(d => d.commitment), approvedLeaves: P.approved,
      deposits: P.deposits.map(d => ({ index: d.index, ts: d.ts, depositor: d.depositor, approved: !FLAGGED.has(d.depositor), flagged: FLAGGED.has(d.depositor) })),
      agent: !!process.env.NEARAI_API_KEY, model: MODEL,
    });
  } catch (e) { res.status(500).json({ error: friendly(e) }); }
});

app.post("/api/demo/deposit", async (req, res) => {
  if (!limit(req, res, "dep", 12, 3600e3)) return;
  try {
    const { commitment, flagged } = req.body, P = poolOf(req.body.pool);
    if (!P) return res.status(400).json({ error: "Unknown pool size" });
    if (!/^\d{1,78}$/.test(commitment || "")) return res.status(400).json({ error: "bad commitment" });
    const amt = Number(P.amt);
    if (flagged && await balance(HACKER) < NEAR(amt + 0.3)) return res.status(503).json({ error: "The flagged demo wallet is out of test funds." });
    const from = flagged ? HACKER : await pickFunder(amt);
    const r = await depositFrom(P, from, commitment);
    await sync(P);
    const d = P.deposits.find(x => x.commitment === commitment);
    res.json({ tx: txHash(r), index: d?.index, from, flagged: FLAGGED.has(from) });
  } catch (e) { res.status(500).json({ error: friendly(e) }); }
});

app.post("/api/relay", async (req, res) => {
  if (!limit(req, res, "rel", 20, 3600e3)) return;
  try {
    const { proof, root, asp_root, nullifier_hash, recipient } = req.body, P = poolOf(req.body.pool);
    if (!P) return res.status(400).json({ error: "Unknown pool size" });
    if (!/^([0-9a-f]{64}|[a-z0-9._-]{2,64}\.testnet)$/.test(recipient || "")) return res.status(400).json({ error: "Recipient must be a testnet account or a fresh 64-character address" });
    const p = { pi_a: proof.pi_a.slice(0, 2), pi_b: proof.pi_b.slice(0, 2), pi_c: proof.pi_c.slice(0, 2) };
    const r = await account(ASP).callFunctionRaw({ contractId: P.contract, methodName: "withdraw", args: { proof: p, root, asp_root, nullifier_hash, recipient }, gas: 150n * TGAS, waitUntil: "FINAL" });
    sync(P).catch(() => {});
    res.json({ tx: txHash(r), recipient });
  } catch (e) { res.status(400).json({ error: friendly(e) }); }
});

app.post("/api/demo/ragequit", async (req, res) => {
  if (!limit(req, res, "rq", 10, 3600e3)) return;
  try {
    const { nullifier, secret } = req.body, P = poolOf(req.body.pool);
    if (!P) return res.status(400).json({ error: "Unknown pool size" });
    const r = await account(HACKER).callFunctionRaw({ contractId: P.contract, methodName: "ragequit", args: { nullifier, secret }, gas: 100n * TGAS, waitUntil: "FINAL" });
    sync(P).catch(() => {});
    res.json({ tx: txHash(r), to: HACKER });
  } catch (e) { res.status(400).json({ error: friendly(e) }); }
});

app.get("/api/attestation", async (req, res) => {
  if (!limit(req, res, "att", 30, 3600e3)) return;
  try { res.json(await attest(String(req.query.nonce || ""))); } catch (e) { res.status(502).json({ error: friendly(e) }); }
});

app.post("/api/agent", async (req, res) => {
  if (!limit(req, res, "ag", 40, 3600e3)) return;
  try { res.json(await agentReply(req.body.question || "Is it safe to withdraw now?", req.body.context || {})); }
  catch (e) { res.json({ text: localAdvice(req.body.context || {}), offline: true, error: friendly(e) }); }
});

app.get("/api/quote", async (req, res) => {
  try { res.json(await quote(String(req.query.to || "zec"), req.query.recipient && String(req.query.recipient), Number(poolOf(req.query.pool)?.amt || 1))); }
  catch (e) { res.status(502).json({ error: friendly(e) }); }
});

app.get("/healthz", (req, res) => res.json({ ok: true, pools: Object.fromEntries(Object.values(POOLS).map(P => [P.amt, P.deposits.length])) }));

app.listen(PORT, () => log(`ClearPool on :${PORT} contract ${CONTRACT}`));

// Keep the free Render instance awake: ping our own public URL every 10 min
// (Render sleeps after 15 min without inbound traffic). RENDER_EXTERNAL_URL is set by Render.
if (process.env.RENDER_EXTERNAL_URL) {
  const self = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/healthz";
  setInterval(() => fetch(self).catch(() => {}), 10 * 60 * 1000).unref();
}
seed().catch(e => log("seed error", e.message));
