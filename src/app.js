// ClearPool browser app. Notes are created and stored only in this browser; proofs are generated here.
import * as C from "../lib/core.js";
import * as snarkjs from "snarkjs";
import { KeyPair } from "near-api-js";
import { setupWalletSelector, actionCreators } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";

const $ = id => document.getElementById(id);
const EXPLORER = "https://testnet.nearblocks.io";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = null, myCommitments = new Set(JSON.parse(store.get("cp_mine") || "[]"));
const ready = C.init();

// ---------- pool panel ----------
async function refresh() {
  try {
    state = await api("/api/state");
    $("sDeposits").textContent = state.stats.deposits;
    $("sApproved").textContent = state.approvedLeaves.length;
    $("sWithdrawals").textContent = state.stats.withdrawals + state.stats.ragequits;
    $("contractLink").href = `${EXPLORER}/address/${state.contract}`;
    $("contractLink2").href = $("contractLink").href;
    const dots = $("dots"), have = dots.children.length;
    state.deposits.slice(have).forEach(d => {
      const i = document.createElement("i");
      const mine = myCommitments.has(state.poolLeaves[d.index]);
      i.className = "d" + (d.flagged ? " no" : "") + (mine ? (d.flagged ? " you-no" : " you") : "");
      i.title = `#${d.index} · ${d.flagged ? "flagged" : "approved"}${mine ? " · yours" : ""}`;
      dots.appendChild(i);
    });
  } catch (e) { console.warn(e); }
}
refresh(); setInterval(refresh, 8000);

// ---------- tabs ----------
function tab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === name));
  $("pane-deposit").classList.toggle("hidden", name !== "deposit");
  $("pane-withdraw").classList.toggle("hidden", name !== "withdraw");
  if (name === "withdraw") { advise(); loadQuote(); }
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => tab(t.dataset.tab));

// ---------- deposit ----------
const DEP_LABEL = 'Deposit 1 NEAR <span class="arr">→</span>';
function showDeposited(text, commitment, tx) {
  myCommitments.add(commitment); store.set("cp_mine", JSON.stringify([...myCommitments]));
  store.set("cp_last_note", text);
  const box = $("noteBox");
  if (!box.querySelector("#noteText")) location.reload(); // box was replaced by an error message
  $("noteText").textContent = text;
  box.classList.remove("hidden");
  $("noteIn").value = text;
  const btn = $("depositBtn");
  btn.disabled = true;
  btn.innerHTML = `Deposited · <a href="${EXPLORER}/txns/${esc(tx)}" target="_blank" rel="noopener" style="color:#fff">view tx ↗</a>`;
  setTimeout(() => { btn.disabled = false; btn.innerHTML = DEP_LABEL; }, 4000);
  refresh();
}
$("depositBtn").onclick = async () => {
  const btn = $("depositBtn");
  if (fromMode === "mine" && !wallet.account) return openWallets();
  btn.disabled = true; btn.textContent = "Creating note…";
  try {
    await ready;
    const note = C.makeNote();
    const text = C.noteToString(note, "1near"), commitment = note.commitment.toString();
    if (fromMode === "mine") {
      // saved before signing: redirect wallets leave this page and come back
      store.set("cp_pending", JSON.stringify({ text, commitment }));
      btn.textContent = "Confirm in your wallet…";
      const out = await walletDeposit(commitment);
      if (!out) return; // redirect wallet: finished on return
      store.set("cp_pending", "");
      showDeposited(text, commitment, out.transaction?.hash || out.transaction_outcome?.id);
    } else {
      btn.textContent = "Depositing on NEAR…";
      const r = await api("/api/demo/deposit", { commitment, flagged: $("flaggedToggle").checked });
      showDeposited(text, commitment, r.tx);
    }
  } catch (e) {
    btn.disabled = false; btn.innerHTML = DEP_LABEL;
    alertInline($("noteBox"), friendly(e));
  }
};
const friendly = e => {
  const m = String(e?.message || e);
  if (/reject|cancel|denied|closed/i.test(m)) return "You cancelled in the wallet. Nothing was sent.";
  if (/NotEnoughBalance|not enough balance|LackBalance/i.test(m)) return "Not enough testnet NEAR. Get some free at near-faucet.io.";
  return m;
};

// ---------- wallet ----------
let fromMode = store.get("cp_mode") === "mine" ? "mine" : "demo";
function setFrom(m) {
  fromMode = m; store.set("cp_mode", m);
  $("modeToggle").setAttribute("aria-checked", String(m === "mine"));
  document.querySelectorAll("[data-label]").forEach(x => x.classList.toggle("on", x.dataset.label === m));
  $("flaggedRow").classList.toggle("hidden", m !== "demo");
  if (m !== "demo") $("flaggedToggle").checked = false;
  $("fromHint").innerHTML = m === "demo" ? "Pays from a demo testnet wallet. No wallet needed."
    : wallet.account ? `From <b>${esc(wallet.account)}</b> · <a href="#" id="signOut" class="link">disconnect</a>` : "Connect a NEAR testnet wallet. Free test NEAR at <a class=\"link\" href=\"https://near-faucet.io\" target=\"_blank\" rel=\"noopener\">near-faucet.io</a>.";
  const so = $("signOut"); if (so) so.onclick = e => { e.preventDefault(); signOut(); };
}
const pickMode = m => { setFrom(m); if (m === "mine" && !wallet.account) openWallets(); };
$("modeToggle").onclick = () => pickMode(fromMode === "mine" ? "demo" : "mine");
document.querySelectorAll("[data-label]").forEach(x => x.onclick = () => pickMode(x.dataset.label));

const wallet = { selector: null, account: null };
const contractId = fetch("/api/state").then(r => r.json()).then(j => j.contract);
const selectorReady = contractId.then(id => setupWalletSelector({
  network: "testnet",
  modules: [setupMeteorWallet(), setupHereWallet(), setupIntearWallet()],
})).then(async sel => {
  wallet.selector = sel;
  const sync = st => { wallet.account = st.accounts.find(a => a.active)?.accountId || st.accounts[0]?.accountId || null; paintWallet(); };
  sync(sel.store.getState());
  sel.store.observable.subscribe(sync);
  return sel;
});
function paintWallet() {
  const chip = $("walletChip");
  chip.textContent = wallet.account ? (wallet.account.length > 22 ? wallet.account.slice(0, 8) + "…" + wallet.account.slice(-6) : wallet.account) : "Connect wallet";
  chip.classList.toggle("on", !!wallet.account);
  setFrom(fromMode);
}
async function openWallets() {
  const list = $("walletList"); $("walletErr").textContent = "";
  list.innerHTML = "<li class='muted small'>Loading wallets…</li>";
  $("walletDialog").showModal();
  const sel = await selectorReady;
  const mods = sel.store.getState().modules;
  list.innerHTML = "";
  for (const m of mods) {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<img alt="" src="${esc(m.metadata.iconUrl)}">${esc(m.metadata.name)}${m.metadata.available ? "" : "<small>not installed</small>"}`;
    b.onclick = async () => {
      try {
        const w = await sel.wallet(m.id);
        await w.signIn({ contractId: await contractId, methodNames: [] });
        $("walletDialog").close();
      } catch (e) { $("walletErr").textContent = friendly(e); }
    };
    li.appendChild(b); list.appendChild(li);
  }
}
async function signOut() { try { const w = await wallet.selector.wallet(); await w.signOut(); } catch {} wallet.account = null; paintWallet(); }
$("walletChip").onclick = () => { setFrom("mine"); wallet.account ? tab("deposit") : openWallets(); };
const NEAR1 = 10n ** 24n, TGAS = 10n ** 12n;
async function walletCall(methodName, args, deposit) {
  const sel = await selectorReady, w = await sel.wallet();
  return w.signAndSendTransaction({ receiverId: await contractId, actions: [actionCreators.functionCall(methodName, args, 100n * TGAS, deposit)] });
}
const walletDeposit = commitment => walletCall("deposit", { commitment }, NEAR1);
// back from a redirect wallet (MyNearWallet): finish or cancel the pending deposit
(() => {
  const q = new URLSearchParams(location.search), pending = JSON.parse(store.get("cp_pending") || "null");
  if (!pending || !(q.has("transactionHashes") || q.has("errorCode"))) return;
  store.set("cp_pending", "");
  history.replaceState(null, "", location.pathname);
  if (q.has("transactionHashes")) showDeposited(pending.text, pending.commitment, q.get("transactionHashes").split(",").pop());
  else alertInline($("noteBox"), "You cancelled in the wallet. Nothing was sent.");
})();
function alertInline(el, msg) { el.classList.remove("hidden"); el.innerHTML = `<strong>Something went wrong</strong><p class="muted small">${esc(msg)}</p>`; }
$("copyNote").onclick = async () => { try { await navigator.clipboard.writeText($("noteText").textContent); $("copyNote").textContent = "Copied"; } catch { } };
$("saveNote").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([$("noteText").textContent], { type: "text/plain" }));
  a.download = `clearpool-note-${Date.now()}.txt`; a.click();
};
$("goWithdraw").onclick = () => tab("withdraw");
if (store.get("cp_last_note")) $("noteIn").value = store.get("cp_last_note");

// ---------- recipient ----------
let toMode = "fresh";
document.querySelectorAll("[data-to]").forEach(b => b.onclick = () => {
  toMode = b.dataset.to;
  document.querySelectorAll("[data-to]").forEach(x => x.classList.toggle("on", x === b));
  $("toAccount").classList.toggle("hidden", toMode !== "account");
  advise();
});

// ---------- agent ----------
function noteContext() {
  let note; try { note = C.parseNote($("noteIn").value); } catch { return null; }
  if (!state) return null;
  const idx = state.poolLeaves.indexOf(note.commitment.toString());
  if (idx < 0) return { note, inPool: false };
  const d = state.deposits[idx];
  const after = state.deposits.filter(x => x.index > idx && x.approved).length;
  const mins = Math.round((Date.now() - d.ts) / 60000);
  return {
    note, inPool: true, approved: d.approved,
    // coarse values only: the agent never sees your note or deposit index
    ctx: { approved: d.approved, anonymitySet: state.approvedLeaves.length, depositsAfter: after > 10 ? "10+" : after, minutesSinceDeposit: mins > 60 ? "60+" : mins, freshRecipient: toMode === "fresh" },
  };
}
let adviseTimer;
async function advise(question) {
  clearTimeout(adviseTimer);
  adviseTimer = setTimeout(async () => {
    const nc = noteContext(), t = $("agentText"), tag = $("agentTag"), meta = $("agentMeta");
    $("badBox").classList.add("hidden");
    if (!nc) { t.textContent = "Paste a note and I'll check if now is a good time."; tag.className = "tag"; tag.textContent = ""; meta.textContent = ""; return; }
    if (!nc.inPool) { t.textContent = "I can't find this deposit in the pool yet. If you just deposited, give it a few seconds."; return; }
    if (!nc.approved) $("badBox").classList.remove("hidden");
    t.textContent = "Thinking…"; meta.textContent = "";
    try {
      const r = await api("/api/agent", { question: question || "Is it safe to withdraw now?", context: nc.ctx });
      t.textContent = r.text;
      if (r.offline) { tag.className = "tag warn"; tag.textContent = "Offline rules"; meta.textContent = "Enclave model unavailable; using built-in rules."; }
      else if (r.signed?.ok) { tag.className = "tag ok"; tag.textContent = "Signed in enclave ✓"; meta.textContent = `${r.model} · signer ${r.signed.signer.slice(0, 10)}…`; }
      else { tag.className = "tag warn"; tag.textContent = "Unsigned"; meta.textContent = r.signed?.detail || ""; }
    } catch (e) { t.textContent = e.message; }
  }, 350);
}
$("noteIn").addEventListener("input", () => advise());

// ---------- withdraw ----------
function steps(list) {
  const ol = $("steps"); ol.classList.remove("hidden");
  ol.innerHTML = list.map(s => `<li>${esc(s)}</li>`).join("");
  return (i, cls) => { ol.children[i].className = cls; };
}
$("withdrawBtn").onclick = async () => {
  const btn = $("withdrawBtn");
  $("result").classList.add("hidden");
  let note;
  try { note = C.parseNote($("noteIn").value); } catch (e) { $("agentText").textContent = e.message; return; }
  let recipient, freshKey;
  if (toMode === "fresh") {
    const kp = KeyPair.fromRandom("ed25519");
    recipient = [...kp.getPublicKey().data].map(b => b.toString(16).padStart(2, "0")).join("");
    freshKey = kp.toString();
  } else {
    recipient = $("toAccount").value.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,64}\.testnet$/.test(recipient)) { $("agentText").textContent = "Enter a testnet account like name.testnet"; return; }
  }
  btn.disabled = true;
  const set = steps(["Loading pool", "Building proof in your browser", "Relaying to NEAR", "Done"]);
  try {
    set(0, "doing"); await ready; await refresh(); set(0, "done");
    set(1, "doing");
    let input;
    try { input = await C.witnessInput(note, state.poolLeaves, state.approvedLeaves, recipient); }
    catch (e) { if (e.code === "NOT_APPROVED") $("badBox").classList.remove("hidden"); throw e; }
    const t0 = performance.now();
    const { proof } = await snarkjs.groth16.fullProve(input, "/zk/withdraw_js/withdraw.wasm", "/zk/withdraw.zkey");
    set(1, "done"); $("steps").children[1].textContent = `Proof built in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    set(2, "doing");
    const r = await api("/api/relay", { proof, root: input.root, asp_root: input.aspRoot, nullifier_hash: input.nullifierHash, recipient });
    set(2, "done"); set(3, "done");
    const res = $("result"); res.classList.remove("hidden");
    res.innerHTML = `<h4>1 NEAR sent privately</h4>
      <div>To <a href="${EXPLORER}/address/${esc(recipient)}" target="_blank" rel="noopener">${esc(recipient.length > 30 ? recipient.slice(0, 10) + "…" + recipient.slice(-6) : recipient)} ↗</a> · <a href="${EXPLORER}/txns/${esc(r.tx)}" target="_blank" rel="noopener">tx ↗</a></div>
      ${freshKey ? `<p class="small muted" style="margin:10px 0 0">Private key for the new address. Save it to use the funds.</p><code>${esc(freshKey)}</code><button class="btn ghost sm" id="copyKey" type="button">Copy key</button>` : ""}`;
    if (freshKey) $("copyKey").onclick = async () => { try { await navigator.clipboard.writeText(freshKey); $("copyKey").textContent = "Copied"; } catch {} };
    store.set("cp_last_note", "");
    refresh();
  } catch (e) {
    const li = [...$("steps").children].find(x => x.className === "doing");
    if (li) { li.className = "fail"; li.textContent = e.code === "NOT_APPROVED" ? "Not in the approved set" : `${li.textContent} · ${e.message}`; }
  } finally { btn.disabled = false; }
};

// ---------- ragequit: public refund to the wallet that deposited ----------
$("ragequitBtn").onclick = async () => {
  const b = $("ragequitBtn"); b.disabled = true; b.textContent = "Returning…";
  try {
    const n = C.parseNote($("noteIn").value);
    const d = state?.deposits[state.poolLeaves.indexOf(n.commitment.toString())];
    const args = { nullifier: n.nullifier.toString(), secret: n.secret.toString() };
    let r;
    if (d && wallet.account && d.depositor === wallet.account) {
      const out = await walletCall("ragequit", args, 0n);
      r = { tx: out?.transaction?.hash || out?.transaction_outcome?.id };
    } else if (d && !d.flagged) {
      throw new Error(`Connect ${d.depositor}, the wallet that made this deposit.`);
    } else r = await api("/api/demo/ragequit", args);
    $("rqResult").innerHTML = `Returned to the original wallet · <a href="${EXPLORER}/txns/${esc(r.tx)}" target="_blank" rel="noopener">tx ↗</a>`;
    b.textContent = "Returned";
    refresh();
  } catch (e) { $("rqResult").textContent = e.message; b.disabled = false; b.textContent = "Return to sender"; }
};

// ---------- cross-chain quote ----------
let chain = "zec";
document.querySelectorAll("[data-chain]").forEach(b => b.onclick = () => {
  chain = b.dataset.chain;
  document.querySelectorAll("[data-chain]").forEach(x => x.classList.toggle("on", x === b));
  loadQuote();
});
async function loadQuote() {
  $("quoteText").textContent = "…";
  try { const q = await api(`/api/quote?to=${chain}`); $("quoteText").textContent = `≈ ${q.out} ${q.to.split(" ")[0]} · ~${Math.round(q.seconds / 60) || 1} min`; }
  catch { $("quoteText").textContent = "Quote unavailable right now"; }
}

// ---------- enclave check ----------
async function attest(open) {
  const nonce = hex(32), led = $("teeLed"), txt = $("teeChipText");
  try {
    const a = await api(`/api/attestation?nonce=${nonce}`);
    const rep = a.reports[0];
    led.className = "led " + (a.verified ? "ok" : "bad");
    txt.textContent = a.verified ? "Enclave verified" : "Enclave unverified";
    $("teeChecks").innerHTML = rep.checks.map(c => `<li class="${c.ok ? "" : "no"}"><span class="ic">${c.ok ? "✓" : "✗"}</span>${esc(c.name)}${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</li>`).join("");
    $("teeMeta").textContent = `model ${a.model} · nonce ${nonce.slice(0, 16)}… · signer ${rep.signing_address}`;
  } catch (e) {
    led.className = "led bad"; txt.textContent = "Enclave check failed";
    $("teeChecks").innerHTML = `<li class="no"><span class="ic">✗</span>${esc(e.message)}</li>`;
  }
  if (open) $("teeDialog").showModal();
}
$("teeChip").onclick = () => { $("teeDialog").showModal(); attest(false); };
attest(false);

// ---------- network speed (status strip) ----------
const RPC = "https://test.rpc.fastnear.com";
const rpc = async (method, params) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
let netPrev = null;
async function netTick() {
  try {
    const t0 = performance.now();
    const b = (await rpc("block", { finality: "final" })).header;
    const ping = Math.round(performance.now() - t0);
    if (!netPrev) { const old = (await rpc("block", { block_id: b.height - 20 }))?.header; netPrev = old || b; }
    const dh = b.height - netPrev.height, dt = (Number(b.timestamp) - Number(netPrev.timestamp)) / 1e9;
    const bt = dh > 0 ? dt / dh : null;
    $("netText").textContent = `#${b.height.toLocaleString("en-US")}${bt ? ` · ${bt.toFixed(2)}s blocks` : ""} · ${ping}ms`;
    if (dh > 0) netPrev = b;
  } catch { $("netText").textContent = "RPC unreachable"; }
}
netTick(); setInterval(netTick, 6000);
