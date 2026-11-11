// Generates contract test fixture: 3 deposits, ASP approves #0 and #2, proof for #2 -> bob.testnet
import * as C from "../lib/core.js";
import * as snarkjs from "snarkjs";
import fs from "fs";
await C.init();
const notes = [C.makeNote(), C.makeNote(), C.makeNote()];
const pool = notes.map(n => n.commitment), asp = [notes[0].commitment, notes[2].commitment];
const input = await C.witnessInput(notes[2], pool, asp, "bob.testnet");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, "build/withdraw_js/withdraw.wasm", "build/withdraw.zkey");
const vk = JSON.parse(fs.readFileSync("build/vk.json"));
console.log("js verify:", await snarkjs.groth16.verify(vk, publicSignals, proof));
fs.writeFileSync("contract/src/fixture.json", JSON.stringify({
  commitments: pool.map(String), poolRoot: input.root, aspRoot: input.aspRoot, nullifierHash: input.nullifierHash,
  recipientField: input.recipient, proof: { pi_a: proof.pi_a.slice(0, 2), pi_b: proof.pi_b.slice(0, 2), pi_c: proof.pi_c.slice(0, 2) },
  rq: { nullifier: notes[1].nullifier.toString(), secret: notes[1].secret.toString() },
}, null, 1));
process.exit(0);
