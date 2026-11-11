// End-to-end on testnet through the running server: deposit -> private withdraw to fresh address; flagged deposit blocked; ragequit; agent; quote.
import * as C from "../lib/core.js";
import * as snarkjs from "snarkjs";
import { KeyPair } from "near-api-js";
import { provider } from "../lib/near.js";
const B = process.argv[2] || "http://localhost:8091";
const j = async (p, b) => { const r = await fetch(B + p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : {}); const x = await r.json(); if (!r.ok) throw Object.assign(new Error(x.error), { body: x }); return x; };
await C.init();
const prove = async (note, pool, asp, to) => {
  const input = await C.witnessInput(note, pool, asp, to);
  const { proof } = await snarkjs.groth16.fullProve(input, "build/withdraw_js/withdraw.wasm", "build/withdraw.zkey");
  return { proof, root: input.root, asp_root: input.aspRoot, nullifier_hash: input.nullifierHash, recipient: to };
};
// 1. honest user
const note = C.makeNote();
const d = await j("/api/demo/deposit", { commitment: note.commitment.toString() });
console.log("1 deposit ok, index", d.index, "tx", d.tx);
let st = await j("/api/state");
for (let i = 0; i < 10 && !st.approvedLeaves.includes(note.commitment.toString()); i++) { await new Promise(r => setTimeout(r, 3000)); st = await j("/api/state"); }
const fresh = Buffer.from(KeyPair.fromRandom("ed25519").getPublicKey().data).toString("hex");
const t0 = Date.now();
const w = await j("/api/relay", await prove(note, st.poolLeaves, st.approvedLeaves, fresh));
const bal = BigInt((await provider.viewAccount({ accountId: fresh })).amount);
console.log("2 private withdraw ok in", Date.now() - t0, "ms; fresh address balance", Number(bal) / 1e24, "NEAR; tx", w.tx);
// 3. double spend
try { await j("/api/relay", await prove(note, st.poolLeaves, st.approvedLeaves, fresh)); console.log("3 FAIL double spend allowed"); } catch (e) { console.log("3 double spend blocked:", e.message); }
// 4. flagged deposit
const bad = C.makeNote();
await j("/api/demo/deposit", { commitment: bad.commitment.toString(), flagged: true });
st = await j("/api/state");
try { await C.witnessInput(bad, st.poolLeaves, st.approvedLeaves, fresh); console.log("4 FAIL"); } catch (e) { console.log("4 flagged can't build proof:", e.code); }
// 5. flagged tries forging an approved set containing itself
try { await j("/api/relay", await prove(bad, st.poolLeaves, [...st.approvedLeaves, bad.commitment.toString()], fresh)); console.log("5 FAIL forged set accepted"); } catch (e) { console.log("5 forged set rejected:", e.message); }
// 6. ragequit back to origin
const rq = await j("/api/demo/ragequit", { nullifier: bad.nullifier.toString(), secret: bad.secret.toString() });
console.log("6 ragequit refunded to", rq.to, "tx", rq.tx);
// 7. agent + attestation
const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
const at = await j("/api/attestation?nonce=" + nonce);
console.log("7 attestation verified:", at.verified, at.reports[0].checks.map(c => (c.ok ? "✓ " : "✗ ") + c.name).join(" | "));
const ag = await j("/api/agent", { question: "Is it safe to withdraw now?", context: { anonymitySet: st.approvedLeaves.length, depositsAfter: 1, minutesSinceDeposit: 2, freshRecipient: true, approved: true } });
console.log("8 agent:", ag.text, "| signed:", JSON.stringify(ag.signed), ag.offline ? "OFFLINE " + (ag.error || "") : "");
console.log("9 quote:", JSON.stringify(await j("/api/quote?to=zec")));
process.exit(0);
