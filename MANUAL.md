# ClearPool usage manual

ClearPool lets you move 1 NEAR to a brand-new address without anyone being able to link the two, as long as your money is clean.

Live app: https://clearpool.onrender.com · Network: **NEAR testnet** (no real money)

---

## Before you start

- Any modern browser (Chrome, Safari, Firefox, Edge), desktop or phone.
- **Your own wallet (normal use):** a NEAR testnet wallet: Meteor, HERE or Intear. Get free test NEAR at https://near-faucet.io.
- **No wallet?** Switch the card to **Demo** and the app deposits from a demo testnet wallet so you can try it straight away.
- First visit can take up to a minute while the free server wakes up.

---

## 1. Deposit

1. Open the **Deposit** tab.
2. Use the **Demo / Testnet** toggle at the top of the card. **Testnet** uses your own wallet; **Demo** pays from a demo wallet so you can try it without one.
3. On **Testnet**, click **Connect wallet** and choose Meteor, HERE or Intear. Your account shows in the header.
4. Click **Deposit 1 NEAR**. With your own wallet, approve the transaction (1 NEAR + a little gas) in the wallet.
5. Wait a few seconds. The button changes to **Deposited · view tx ↗** (opens the transaction on NearBlocks).
6. A green box appears with **Your note**.

**Save your note.** It's the only key to your deposit. Use **Copy** or **Download**. Lose it and the 1 NEAR is gone for good. Anyone who has it can take the money.

In **Live pool** on the right, your deposit shows as a black dot.

> The note is created in your browser. Only a scrambled fingerprint of it (the "commitment") goes on-chain.

---

## 2. Check with the privacy agent

1. Click **Withdraw →** in the note box, or open the **Withdraw** tab. Your last note is filled in for you.
2. Read the **Privacy agent** box. It tells you whether now is a good time, for example:
   - *Wait*: too few deposits have landed after yours, so the timing could give you away.
   - *Go ahead*: your deposit is hidden among enough others.
3. The tag on the right of the agent box shows what it is running on:
   - **Signed in enclave ✓**: the answer came from an AI model running inside sealed hardware, and its signature was checked.
   - **Offline rules**: the AI service is unavailable, so built-in rules answered instead.

The agent never sees your note. It only gets rough numbers: pool size, roughly how many deposits came after yours, roughly how long ago you deposited, and whether you're sending to a new address.

---

## 3. Withdraw privately

1. Under **Send to**, pick:
   - **New address** (recommended). The app creates a fresh address just for this withdrawal.
   - **Testnet account**. Type an existing account such as `name.testnet`. Sending to an account you've used before weakens your privacy.
2. Click **Withdraw privately**.
3. Watch the steps:
   - **Loading pool**
   - **Proof built in X s**: your browser proves you own a clean deposit without revealing which one. Usually 1–4 seconds.
   - **Relaying to NEAR**: a relayer submits the transaction and pays the gas, so your new address needs nothing.
   - **Done**
4. You'll see **1 NEAR sent privately**, links to the new address and the transaction, and, for a new address, its **private key**.

**Save that private key.** It's the only way to use the 1 NEAR at the new address.

### Using the funds at the new address
Import the private key into a NEAR wallet that supports testnet and private-key import (for example Meteor Wallet: *Add wallet → Import with private key*, network set to testnet). The 64-character address is a NEAR "implicit account", so it works like any other account once imported.

---

## 4. If your deposit is flagged

To see this, set the card to **Demo** and switch on **Send from a flagged wallet (demo)** on the Deposit tab before depositing.

When you try to withdraw a flagged deposit:
- The step shows **Not in the approved set**.
- A red box explains it can't leave privately.
- **Return to sender** sends the 1 NEAR back to the wallet it came from, and only that wallet. This refund is public.
- If you deposited from your own wallet, connect that same wallet first: it signs the refund.

This is the point of ClearPool: honest money gets privacy, flagged money can only go back where it came from.

---

## 5. Check the enclave yourself

Click **Enclave verified** in the status bar at the bottom of the page. Your browser makes a random number (a nonce), and the AI model's hardware report has to include it. You'll see four checks:

| Check | Meaning |
|---|---|
| Intel TDX quote signature | The report is signed by genuine Intel hardware and its security level is current |
| Your nonce is inside the quote | The report was made just now, for you, not replayed |
| Model signing key is inside the quote | The key that signs the agent's answers lives inside that hardware |
| NVIDIA GPU evidence present | The model runs on a GPU that is also inside the sealed environment |

---

## 6. Another chain (preview)

On the Withdraw tab, open **Want it on another chain?** and pick **ZEC**, **USDC · Base** or **SOL**. You'll see a live NEAR Intents quote for 1 NEAR and the expected time.

This is a **preview only**. NEAR Intents runs on mainnet, and ClearPool is on testnet, so no swap happens.

---

## 7. The Live pool panel

| Item | Meaning |
|---|---|
| deposits | All deposits ever made |
| approved | Deposits in the approved set, which is your crowd to hide in |
| withdrawn | Private withdrawals plus refunds |
| Green dot | Approved deposit |
| Red dot | Flagged deposit |
| Black dot | Your deposit (remembered in this browser only) |
| View contract ↗ | The ClearPool contract on NearBlocks |
| Bottom status bar | Live status, enclave check, latest NEAR block, average block time and RPC response time |

---

## Troubleshooting

| You see | What to do |
|---|---|
| Page slow to load the first time | The free server is waking up. Wait up to a minute |
| "I can't find this deposit in the pool yet" | You just deposited. Wait a few seconds and it appears |
| "That doesn't look like a ClearPool note" | Paste the whole note, starting `clearpool-1near-` |
| "note already spent" | That note has already been withdrawn. Each note works once |
| "Not in the approved set" | The deposit came from a flagged wallet. Use **Return to sender** |
| "Slow down a little" | You hit the demo limit (12 deposits an hour). Try again later |
| "The flagged demo wallet is out of test funds" | The demo flagged wallet is empty. Try again later |
| "Not enough testnet NEAR" | Get free test NEAR at https://near-faucet.io |
| "You cancelled in the wallet" | Nothing was sent. Click **Deposit 1 NEAR** again |
| "Connect …, the wallet that made this deposit" | Refunds go only to the depositor; connect that wallet |
| Proof step is slow on a phone | Older phones take longer. Leave the page open until it finishes |

---

## FAQ

**Is this real money?** No. Everything runs on NEAR testnet. The hackathon allows testnet-only projects (rules Q-010).

**What does the server know?** It relays your withdrawal, so it sees the address you're sending to. It never sees your note and can't tell which deposit you're spending; the proof hides that.

**Who decides what is "flagged"?** An Association Set Provider (ASP) publishes the list of approved deposits on-chain. In this demo, it blocks one known demo wallet. A real one would use chain-analysis signals and publish its policy.

**Can the ASP steal funds?** No. It can only publish the approved list. Funds move only with a valid proof (to the bound recipient) or by refund to the original depositor.

**What if I lose my note?** The deposit can't be recovered. That's the price of nobody else being able to touch it.

**Can I clear my browser?** Yes, but you'll lose the remembered note and the black "yours" dot. Keep your downloaded note.

---

## For developers: HTTP API

All endpoints are on `https://clearpool.onrender.com`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/state` | none | Contract stats, pool leaves, approved leaves, deposit list (approved/flagged), agent status |
| POST | `/api/demo/deposit` | `{ commitment, flagged? }` | `{ tx, index, from }` (deposit from a demo wallet) |
| POST | `/api/relay` | `{ proof, root, asp_root, nullifier_hash, recipient }` | `{ tx, recipient }` |
| POST | `/api/demo/ragequit` | `{ nullifier, secret }` | `{ tx, to }` (flagged demo wallet only) |
| GET | `/api/attestation` | `?nonce=<64 hex>` | Verified enclave checks and signing address |
| POST | `/api/agent` | `{ question, context }` | `{ text, signed: { ok, signer, kind } }` |
| GET | `/api/quote` | `?to=zec\|usdc-base\|sol` | Dry NEAR Intents quote for 1 NEAR |
| GET | `/healthz` | none | `{ ok, contract, deposits }` |

Proof inputs and the note format are in `lib/core.js`. The full scripted flow is in `scripts/e2e.js`:

```bash
npm ci
node scripts/e2e.js https://clearpool.onrender.com
```
