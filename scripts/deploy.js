// Deploy a pool: node scripts/deploy.js [amountNEAR=1]  (1 -> clearpool-<suf>.testnet, others -> clearpool-p<amount>-<suf>.testnet)
import { account, view, NEAR } from "../lib/near.js";
import fs from "fs";
const S = fs.readFileSync(".keys/suffix", "utf8").trim();
const amt = process.argv[2] || "1";
const C = amt === "1" ? `clearpool-${S}.testnet` : `clearpool-p${amt.replace(".", "")}-${S}.testnet`, ASP = `cp-asp-${S}.testnet`;
const acc = account(C);
const code = fs.readFileSync("build/clearpool.wasm");
const r = await acc.deployContract(new Uint8Array(code));
console.log(C, "deploy:", r.final_execution_status ?? JSON.stringify(r.status).slice(0, 80));
await acc.callFunction({ contractId: C, methodName: "new", args: { denomination: NEAR(Number(amt)).toString(), asp_admin: ASP, vk_json: fs.readFileSync("build/vk.json", "utf8") }, gas: 300n * 10n ** 12n });
console.log(await view(C, "get_stats"));
