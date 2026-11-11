// Shared ClearPool primitives (browser + node). Poseidon via circomlibjs; trees match the contract.
import { buildPoseidon } from "circomlibjs";

export const LEVELS = 12;
let P;
export async function init() { if (!P) P = await buildPoseidon(); return P; }
const F = () => P.F;
export const H = (...xs) => BigInt(F().toString(P(xs.map(BigInt))));

export function randomField() {
  const b = new Uint8Array(31); crypto.getRandomValues(b);
  return BigInt("0x" + [...b].map(x => x.toString(16).padStart(2, "0")).join(""));
}

export function makeNote() {
  const nullifier = randomField(), secret = randomField();
  return { nullifier, secret, commitment: H(nullifier, secret), nullifierHash: H(nullifier) };
}
export const noteToString = (n, pool) => `clearpool-${pool}-${n.nullifier.toString(16).padStart(62, "0")}${n.secret.toString(16).padStart(62, "0")}`;
export function parseNote(s) {
  const m = /^clearpool-(.+)-([0-9a-f]{124})$/.exec(s.trim());
  if (!m) throw new Error("That doesn't look like a ClearPool note");
  const nullifier = BigInt("0x" + m[2].slice(0, 62)), secret = BigInt("0x" + m[2].slice(62));
  return { pool: m[1], nullifier, secret, commitment: H(nullifier, secret), nullifierHash: H(nullifier) };
}

// Fixed-depth tree with zero leaves = 0 (same as contract).
export function buildTree(leaves) {
  const zeros = [0n];
  for (let i = 0; i < LEVELS; i++) zeros.push(H(zeros[i], zeros[i]));
  const layers = [leaves.map(BigInt)];
  for (let l = 0; l < LEVELS; l++) {
    const cur = layers[l], next = [];
    for (let i = 0; i < Math.ceil(cur.length / 2); i++) next.push(H(cur[2 * i], cur[2 * i + 1] ?? zeros[l]));
    layers.push(next);
  }
  const root = layers[LEVELS][0] ?? zeros[LEVELS];
  function path(index) {
    const els = [], idx = [];
    for (let l = 0; l < LEVELS; l++) {
      const sib = index ^ 1;
      els.push(layers[l][sib] ?? zeros[l]); idx.push(index & 1);
      index >>= 1;
    }
    return { pathElements: els, pathIndices: idx };
  }
  return { root, path, zeros };
}

export async function recipientField(acc) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(acc)));
  return BigInt("0x" + [...h.slice(0, 31)].map(x => x.toString(16).padStart(2, "0")).join(""));
}

// Build witness input for the circuit.
export async function witnessInput(note, poolLeaves, aspLeaves, recipient) {
  const c = note.commitment;
  const pi = poolLeaves.findIndex(x => BigInt(x) === c);
  if (pi < 0) throw new Error("Your deposit isn't in the pool yet");
  const ai = aspLeaves.findIndex(x => BigInt(x) === c);
  if (ai < 0) { const e = new Error("This deposit isn't in the approved set, so it can't be withdrawn privately. You can still take it back to the original account."); e.code = "NOT_APPROVED"; throw e; }
  const pool = buildTree(poolLeaves), asp = buildTree(aspLeaves);
  const p = pool.path(pi), a = asp.path(ai);
  const s = x => x.toString();
  return {
    root: s(pool.root), aspRoot: s(asp.root), nullifierHash: s(note.nullifierHash), recipient: s(await recipientField(recipient)),
    nullifier: s(note.nullifier), secret: s(note.secret),
    pathElements: p.pathElements.map(s), pathIndices: p.pathIndices.map(s),
    aspPathElements: a.pathElements.map(s), aspPathIndices: a.pathIndices.map(s),
  };
}
