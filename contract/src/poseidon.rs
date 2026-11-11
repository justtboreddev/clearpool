//! Minimal circom-compatible Poseidon over BN254 for t=2 (1 input) and t=3 (2 inputs).
//! Mirrors circomlibjs poseidon_reference.js; constants in poseidon_consts.rs.
use crate::poseidon_consts::*;
use ark_bn254::Fr;
use ark_ff::{Field, PrimeField};

fn f(b: &[u8; 32]) -> Fr { Fr::from_le_bytes_mod_order(b) }
fn pow5(a: Fr) -> Fr { let a2 = a.square(); a2.square() * a }

fn permute<const T: usize>(inputs: [Fr; T], c: &[[u8; 32]], m: &[[[u8; 32]; T]; T], rp: usize) -> Fr {
    let rf = 8;
    let mut st = inputs;
    let mf: Vec<Vec<Fr>> = m.iter().map(|r| r.iter().map(f).collect()).collect();
    for r in 0..(rf + rp) {
        for i in 0..T { st[i] += f(&c[r * T + i]); }
        if r < rf / 2 || r >= rf / 2 + rp { for i in 0..T { st[i] = pow5(st[i]); } } else { st[0] = pow5(st[0]); }
        let mut n = [Fr::from(0u64); T];
        for i in 0..T { for j in 0..T { n[i] += mf[i][j] * st[j]; } }
        st = n;
    }
    st[0]
}
pub fn hash1(a: &Fr) -> Fr { permute::<2>([Fr::from(0u64), *a], &C2, &M2, 56) }
pub fn hash2(a: &Fr, b: &Fr) -> Fr { permute::<3>([Fr::from(0u64), *a, *b], &C3, &M3, 57) }
