# ClearPool

**A privacy pool on NEAR that only lets clean money out privately.**

Built at NEAR HACKATHON 2026 · Tracks: Privacy & Private AI, Agent Economy, Unstoppable DeFi

- Live app: https://clearpool.onrender.com
- Contract (testnet): [`clearpool-bdb0ab.testnet`](https://testnet.nearblocks.io/address/clearpool-bdb0ab.testnet)

## The problem

On a public chain anyone you pay can see your whole history, and anyone who pays you can see your balance. Mixers fixed that but also hid stolen funds, so they got sanctioned. Honest users are left with no privacy.

## What ClearPool does

1. You deposit a fixed 1 NEAR. Your browser creates a secret **note**. Only a hash of it goes on-chain.
2. To withdraw, your browser builds a **zero-knowledge proof** that you own *some* deposit in the pool **and** that the deposit is in the **approved set**, without revealing which one.
3. The contract verifies the proof on-chain and pays a **fresh address**. A relayer submits the transaction, so the new address needs no gas.
4. Deposits that aren't approved (e.g. from a flagged wallet) **can't** withdraw privately. They can only `ragequit`: a public refund to the wallet that sent them.

A **privacy agent** tells you when withdrawing is safe: whether enough deposits have landed after yours, and whether you're withdrawing to a fresh address. It runs on **NEAR AI Cloud inside a TEE**. The app checks the enclave's Intel TDX quote against a nonce your browser generates, and checks that each answer is signed by the attested key.

Optional: a live **NEAR Intents** quote shows what your 1 NEAR becomes on Zcash, Base or Solana.

## Try it (do X, see Y)

Open the live app.

| Do | See |
|---|---|
| Click **Deposit 1 NEAR** | A tx link, your note, and a new black dot ("yours") in *Live pool* |
| Click **Withdraw →**, then **Withdraw privately** | "Proof built in ~1s", then "1 NEAR sent privately" to a brand-new 64-hex address with its private key. The explorer shows the payout came from the contract, not from your deposit wallet |
| Click **Withdraw privately** again with the same note | Fails with `note already spent` |
| On **Deposit**, switch on **Send from a flagged wallet**, deposit, then try to withdraw | "Not in the approved set". **Return to sender** refunds only the original wallet |
| Click **Enclave verified** in the header | 4 checks: Intel TDX quote signature, your nonce inside the quote, model signing key inside the quote, NVIDIA GPU evidence |
| Open **Want it on another chain?** | A live NEAR Intents dry quote for 1 NEAR → ZEC / USDC on Base / SOL |

Scripted end-to-end check against the live deployment (no keys needed, only Node 20+):

```bash
npm ci
node scripts/e2e.js https://clearpool.onrender.com
```

It runs a deposit, a private withdrawal to a fresh address (and checks its balance), a double-spend attempt, a flagged deposit, a forged approved-set attack, a ragequit, attestation, the agent and a quote. Each line prints ✓ results or the on-chain error.

## How it works

```
browser                         server (relayer + ASP + agent proxy)          NEAR testnet contract
──────────                      ──────────────────────────────────            ─────────────────────
note = (nullifier, secret)
commitment = Poseidon(n, s) ──► demo wallet deposits 1 NEAR ───────────────► insert into Poseidon Merkle tree (on-chain)
                                ASP screens depositor, publishes root ──────► set_asp_root (approved-set root)
Groth16 proof in browser:
 · commitment ∈ pool tree
 · commitment ∈ approved tree
 · nullifierHash = Poseidon(n)
 · bound to recipient      ───► relay withdraw (pays gas) ─────────────────► verify proof with alt_bn128 host fns,
                                                                               check roots + nullifier, pay recipient
```

- `circuits/withdraw.circom`: 2 Merkle proofs (depth 12) + nullifier + recipient binding, ~13k constraints.
- `contract/src/lib.rs`: Rust near-sdk contract. On-chain Poseidon tree (`poseidon.rs`, circom-compatible, constants generated from circomlibjs), Groth16 verification via NEAR's `alt_bn128_*` host functions, nullifier set, ASP root history, `ragequit`.
- `lib/core.js`: shared note/tree/witness code (browser + Node).
- `server.js`: static app, relayer, Association Set Provider, NEAR AI Cloud proxy with attestation + response-signature checks, NEAR Intents 1Click dry quotes.
- `src/app.js`: browser app. Notes stay in the browser; proofs are generated in the browser with snarkjs.

### What the server can and can't see
- It never sees your note. It sees your recipient (it has to submit the tx), but not which deposit you're spending.
- The agent gets coarse context only: approved-set size, deposits after yours (bucketed), minutes since deposit (bucketed), fresh-address yes/no.

## Run locally

```bash
npm ci && npm run build
# contract tests (real proof fixture; checks Poseidon parity, Groth16 on NEAR host fns, double spend, wrong recipient, ragequit)
cd contract && cargo test && cd ..
# rebuild circuit + keys (optional; committed artifacts are in build/)
npx circom2 circuits/withdraw.circom --r1cs --wasm --sym -o build
# server: needs testnet account keys in .keys/ or KEY_* env vars, and optionally NEARAI_API_KEY
PORT=8080 node server.js
```

Scripts: `scripts/create-account.js` (faucet-funded testnet accounts), `scripts/deploy.js`, `scripts/fixture.js` (proof fixture for contract tests), `scripts/e2e.js`.

## Honest limitations

- **Testnet only.** NEAR Intents has no testnet, so the cross-chain step is a live *quote* (dry run), not an executed swap.
- **Trusted setup** was a single-party ceremony made for this hackathon. Production needs a multi-party ceremony.
- **The ASP rule is a demo blocklist** (one flagged wallet). A real ASP would use chain-analysis signals and publish its policy.
- **Deposits use demo wallets** so judges can try it without a testnet wallet. A wallet-selector deposit is the obvious next step.
- **Quote verification runs on the server** with a nonce from your browser. The browser can't call the verifier's collateral service directly yet.
- If the NEAR AI Cloud key is missing or invalid, the agent falls back to built-in rules and the UI says so ("Offline rules").

## Disclosures

- Libraries: near-sdk (Rust), ark-bn254/ark-ff, circom2, circomlib, circomlibjs, snarkjs, near-api-js, @phala/dcap-qvl, ethers, express, esbuild.
- Design tokens (colours, type, pill controls) borrowed from monica.cash.
- Code was written with AI assistance (Claude Code) during the hackathon window. No pre-existing project code.

## License

MIT
