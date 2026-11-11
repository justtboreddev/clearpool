//! ClearPool: a compliant privacy pool on NEAR.
//!
//! Fixed-size deposits go into a Poseidon Merkle tree. Withdrawals carry a Groth16 proof that
//! the withdrawer owns *some* deposit in the tree AND that the deposit is in the approved
//! "association set" (published by the ASP account), without revealing which deposit.
//! Deposits that are not approved can only `ragequit`: a public refund to the original depositor.

use ark_bn254::{Fq, Fr};
use ark_ff::{BigInteger, PrimeField};
mod poseidon;
mod poseidon_consts;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};
use std::str::FromStr;

pub const LEVELS: usize = 12;
const ROOT_HISTORY: usize = 30;
const ASP_HISTORY: usize = 10;

type B32 = [u8; 32];

fn fr_le(f: &Fr) -> B32 {
    let v = f.into_bigint().to_bytes_le();
    let mut o = [0u8; 32];
    o.copy_from_slice(&v[..32]);
    o
}
fn le_fr(b: &B32) -> Fr { Fr::from_le_bytes_mod_order(b) }
fn dec_fr(s: &str) -> Fr {
    // reject non-canonical values (>= field modulus)
    let f = Fr::from_str(s).unwrap_or_else(|_| env::panic_str("bad field element"));
    require!(f.into_bigint().to_string() == s.trim_start_matches('0').to_string() || s == "0", "non-canonical field element");
    f
}
fn dec_fq_le(s: &str) -> B32 {
    let f = Fq::from_str(s).unwrap_or_else(|_| env::panic_str("bad Fq element"));
    let v = f.into_bigint().to_bytes_le();
    let mut o = [0u8; 32];
    o.copy_from_slice(&v[..32]);
    o
}
fn hex32(b: &B32) -> String { b.iter().rev().map(|x| format!("{:02x}", x)).collect() }

fn poseidon2(a: &Fr, b: &Fr) -> Fr { poseidon::hash2(a, b) }
fn poseidon1(a: &Fr) -> Fr { poseidon::hash1(a) }

/// Binds a NEAR account id to a field element (first 31 bytes of sha256, big-endian).
pub fn recipient_field(acc: &str) -> Fr {
    let h = env::sha256(acc.as_bytes());
    Fr::from_be_bytes_mod_order(&h[..31])
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Proof {
    pub pi_a: Vec<String>,
    pub pi_b: Vec<Vec<String>>,
    pub pi_c: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct VerifyingKey {
    pub vk_alpha_1: Vec<String>,
    pub vk_beta_2: Vec<Vec<String>>,
    pub vk_gamma_2: Vec<Vec<String>>,
    pub vk_delta_2: Vec<Vec<String>>,
    #[serde(rename = "IC")]
    pub ic: Vec<Vec<String>>,
}

fn g1(p: &[String]) -> Vec<u8> {
    let mut v = dec_fq_le(&p[0]).to_vec();
    v.extend(dec_fq_le(&p[1]));
    v
}
/// snarkjs G2 = [[x.c0, x.c1], [y.c0, y.c1]]; NEAR expects x.c0 | x.c1 | y.c0 | y.c1, little-endian.
fn g2(p: &[Vec<String>]) -> Vec<u8> {
    let mut v = Vec::with_capacity(128);
    for c in [&p[0][0], &p[0][1], &p[1][0], &p[1][1]] {
        v.extend(dec_fq_le(c));
    }
    v
}

/// Groth16 check: e(-A,B) * e(alpha,beta) * e(vk_x,gamma) * e(C,delta) == 1
pub fn groth16_verify(vk: &VerifyingKey, proof: &Proof, inputs: &[Fr]) -> bool {
    require!(inputs.len() + 1 == vk.ic.len(), "wrong number of public inputs");
    // vk_x = IC0 + sum(input_i * IC_i)
    let mut me = Vec::new();
    for (i, x) in inputs.iter().enumerate() {
        me.extend(g1(&vk.ic[i + 1]));
        me.extend(fr_le(x));
    }
    let acc = env::alt_bn128_g1_multiexp(&me);
    let mut sum = vec![0u8];
    sum.extend(g1(&vk.ic[0]));
    sum.push(0u8);
    sum.extend(acc);
    let vk_x = env::alt_bn128_g1_sum(&sum);
    // -A via g1_sum with sign bit
    let mut neg = vec![1u8];
    neg.extend(g1(&proof.pi_a));
    let neg_a = env::alt_bn128_g1_sum(&neg);

    let mut pairs = Vec::with_capacity(4 * 192);
    pairs.extend(neg_a);
    pairs.extend(g2(&proof.pi_b));
    pairs.extend(g1(&vk.vk_alpha_1));
    pairs.extend(g2(&vk.vk_beta_2));
    pairs.extend(vk_x);
    pairs.extend(g2(&vk.vk_gamma_2));
    pairs.extend(g1(&proof.pi_c));
    pairs.extend(g2(&vk.vk_delta_2));
    env::alt_bn128_pairing_check(&pairs)
}

#[near(serializers = [borsh])]
pub struct DepositInfo {
    pub commitment: B32,
    pub depositor: AccountId,
    pub ts: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ClearPool {
    denomination: NearToken,
    asp_admin: AccountId,
    vk_json: String,
    zeros: Vec<B32>,
    filled: Vec<B32>,
    roots: Vec<B32>,
    root_idx: u32,
    next_index: u32,
    deposits: Vector<DepositInfo>,
    commitments: LookupMap<B32, u32>,
    nullifiers: LookupSet<B32>,
    asp_roots: Vec<B32>,
    asp_idx: u32,
    withdrawals: u32,
    ragequits: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Stats {
    pub denomination: String,
    pub deposits: u32,
    pub withdrawals: u32,
    pub ragequits: u32,
    pub last_root: String,
    pub asp_root: String,
    pub asp_admin: AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DepositView {
    pub index: u32,
    pub commitment: String,
    pub depositor: AccountId,
    pub ts: u64,
}

#[near]
impl ClearPool {
    #[init]
    pub fn new(denomination: NearToken, asp_admin: AccountId, vk_json: String) -> Self {
        let _: VerifyingKey = near_sdk::serde_json::from_str(&vk_json).expect("bad vk");
        let mut zeros = Vec::with_capacity(LEVELS + 1);
        let mut z = Fr::from(0u64);
        for _ in 0..=LEVELS {
            zeros.push(fr_le(&z));
            z = poseidon2(&z, &z);
        }
        let empty_root = zeros[LEVELS];
        Self {
            denomination,
            asp_admin,
            vk_json,
            filled: zeros[..LEVELS].to_vec(),
            zeros,
            roots: vec![empty_root],
            root_idx: 0,
            next_index: 0,
            deposits: Vector::new(b"d"),
            commitments: LookupMap::new(b"c"),
            nullifiers: LookupSet::new(b"n"),
            asp_roots: vec![],
            asp_idx: 0,
            withdrawals: 0,
            ragequits: 0,
        }
    }

    /// Deposit exactly `denomination` with a Poseidon commitment (decimal string).
    #[payable]
    pub fn deposit(&mut self, commitment: String) -> u32 {
        require!(env::attached_deposit() == self.denomination, "attach exactly the pool denomination");
        let c = dec_fr(&commitment);
        let cb = fr_le(&c);
        require!(!self.commitments.contains_key(&cb), "commitment already used");
        require!((self.next_index as usize) < (1 << LEVELS), "pool is full");
        let index = self.next_index;
        let mut cur = c;
        let mut idx = index as usize;
        for i in 0..LEVELS {
            let (l, r) = if idx % 2 == 0 {
                self.filled[i] = fr_le(&cur);
                (cur, le_fr(&self.zeros[i]))
            } else {
                (le_fr(&self.filled[i]), cur)
            };
            cur = poseidon2(&l, &r);
            idx /= 2;
        }
        let root = fr_le(&cur);
        if self.roots.len() < ROOT_HISTORY {
            self.roots.push(root);
            self.root_idx = (self.roots.len() - 1) as u32;
        } else {
            self.root_idx = (self.root_idx + 1) % ROOT_HISTORY as u32;
            self.roots[self.root_idx as usize] = root;
        }
        self.next_index += 1;
        self.commitments.insert(cb, index);
        self.deposits.push(DepositInfo { commitment: cb, depositor: env::predecessor_account_id(), ts: env::block_timestamp_ms() });
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"clearpool\",\"event\":\"deposit\",\"data\":{{\"index\":{},\"commitment\":\"{}\"}}}}", index, c.into_bigint()));
        index
    }

    /// Withdraw to `recipient`. Anyone (e.g. a relayer) may submit; funds only go to the recipient bound in the proof.
    pub fn withdraw(&mut self, proof: Proof, root: String, asp_root: String, nullifier_hash: String, recipient: AccountId) -> Promise {
        let root_f = dec_fr(&root);
        let asp_f = dec_fr(&asp_root);
        let nh_f = dec_fr(&nullifier_hash);
        let nh = fr_le(&nh_f);
        require!(!self.nullifiers.contains(&nh), "note already spent");
        require!(self.roots.contains(&fr_le(&root_f)), "unknown pool root");
        require!(self.asp_roots.contains(&fr_le(&asp_f)), "association set root not recognised");
        let rf = recipient_field(recipient.as_str());
        let vk: VerifyingKey = near_sdk::serde_json::from_str(&self.vk_json).unwrap();
        require!(groth16_verify(&vk, &proof, &[root_f, asp_f, nh_f, rf]), "invalid proof");
        self.nullifiers.insert(nh);
        self.withdrawals += 1;
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"clearpool\",\"event\":\"withdraw\",\"data\":{{\"nullifier_hash\":\"{}\"}}}}", nh_f.into_bigint()));
        Promise::new(recipient).transfer(self.denomination)
    }

    /// Exit for deposits that are not approved: reveal the note, refund ONLY to the original depositor.
    pub fn ragequit(&mut self, nullifier: String, secret: String) -> Promise {
        let n = dec_fr(&nullifier);
        let s = dec_fr(&secret);
        let c = fr_le(&poseidon2(&n, &s));
        let idx = self.commitments.get(&c).copied().unwrap_or_else(|| env::panic_str("no such deposit"));
        let nh = fr_le(&poseidon1(&n));
        require!(!self.nullifiers.contains(&nh), "note already spent");
        let d = self.deposits.get(idx).unwrap();
        require!(d.depositor == env::predecessor_account_id(), "only the original depositor can ragequit");
        let to = d.depositor.clone();
        self.nullifiers.insert(nh);
        self.ragequits += 1;
        Promise::new(to).transfer(self.denomination)
    }

    /// Association Set Provider publishes the root of approved deposits.
    pub fn set_asp_root(&mut self, root: String) {
        require!(env::predecessor_account_id() == self.asp_admin, "only the ASP can publish roots");
        let r = fr_le(&dec_fr(&root));
        if self.asp_roots.len() < ASP_HISTORY {
            self.asp_roots.push(r);
            self.asp_idx = (self.asp_roots.len() - 1) as u32;
        } else {
            self.asp_idx = (self.asp_idx + 1) % ASP_HISTORY as u32;
            self.asp_roots[self.asp_idx as usize] = r;
        }
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            denomination: self.denomination.as_yoctonear().to_string(),
            deposits: self.next_index,
            withdrawals: self.withdrawals,
            ragequits: self.ragequits,
            last_root: le_fr(&self.roots[self.root_idx as usize]).into_bigint().to_string(),
            asp_root: self.asp_roots.get(self.asp_idx as usize).map(|r| le_fr(r).into_bigint().to_string()).unwrap_or_default(),
            asp_admin: self.asp_admin.clone(),
        }
    }

    pub fn get_deposits(&self, from: u32, limit: u32) -> Vec<DepositView> {
        (from..std::cmp::min(from + limit, self.deposits.len()))
            .map(|i| {
                let d = self.deposits.get(i).unwrap();
                DepositView { index: i, commitment: le_fr(&d.commitment).into_bigint().to_string(), depositor: d.depositor.clone(), ts: d.ts }
            })
            .collect()
    }

    pub fn is_spent(&self, nullifier_hash: String) -> bool { self.nullifiers.contains(&fr_le(&dec_fr(&nullifier_hash))) }
    pub fn is_known_root(&self, root: String) -> bool { self.roots.contains(&fr_le(&dec_fr(&root))) }
    pub fn recipient_hash(&self, recipient: AccountId) -> String { recipient_field(recipient.as_str()).into_bigint().to_string() }
    pub fn root_hex(&self) -> String { hex32(&self.roots[self.root_idx as usize]) }
}

#[cfg(test)]
mod tests;
