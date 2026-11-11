// Creates a funded testnet account via NEAR's faucet helper. Key saved to .keys/<id>.json
import { KeyPair } from "near-api-js";
import fs from "fs";
const id = process.argv[2];
const kp = KeyPair.fromRandom("ed25519");
const r = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
console.log(id, r.status, (await r.text()).slice(0, 200));
if (r.ok) fs.writeFileSync(`.keys/${id}.json`, JSON.stringify({ account_id: id, private_key: kp.toString() }), { mode: 0o600 });
