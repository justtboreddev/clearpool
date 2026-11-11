// Server-side NEAR helpers (testnet). Keys come from env vars or local .keys/ (never committed).
import { Account, JsonRpcProvider } from "near-api-js";
import fs from "fs";

export const RPC = process.env.NEAR_RPC || "https://test.rpc.fastnear.com";
export const provider = new JsonRpcProvider({ url: RPC });

export function keyFor(id) {
  const envName = "KEY_" + id.split(".")[0].replace(/[^a-z0-9]/gi, "_").toUpperCase();
  if (process.env[envName]) return process.env[envName];
  const f = `.keys/${id}.json`;
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).private_key;
  throw new Error("no key for " + id);
}
export const account = id => new Account(id, provider, keyFor(id));
export const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
export const NEAR = n => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
