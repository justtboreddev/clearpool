use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, Gas};
use near_sdk::serde_json::{self, Value};

fn fx() -> Value { serde_json::from_str(include_str!("fixture.json")).unwrap() }
fn ctx(pred: AccountId, dep: NearToken) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(pred).attached_deposit(dep).prepaid_gas(Gas::from_tgas(300)).account_balance(NearToken::from_near(100));
    testing_env!(b.build());
}
const ONE: NearToken = NearToken::from_near(1);

fn setup() -> (ClearPool, Value) {
    let f = fx();
    ctx(accounts(0), NearToken::from_yoctonear(0));
    let vk = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../build/vk.json")).unwrap();
    let mut c = ClearPool::new(ONE, accounts(0), vk);
    for (i, cm) in f["commitments"].as_array().unwrap().iter().enumerate() {
        ctx(accounts(i + 1), ONE);
        c.deposit(cm.as_str().unwrap().to_string());
    }
    ctx(accounts(0), NearToken::from_yoctonear(0));
    c.set_asp_root(f["aspRoot"].as_str().unwrap().into());
    (c, f)
}
fn s(v: &Value) -> String { v.as_str().unwrap().to_string() }
fn proof(f: &Value) -> Proof { serde_json::from_value(f["proof"].clone()).unwrap() }

#[test]
fn root_matches_js() {
    let (c, f) = setup();
    assert_eq!(c.get_stats().last_root, s(&f["poolRoot"]));
    assert_eq!(c.recipient_hash("bob.testnet".parse().unwrap()), s(&f["recipientField"]));
}
#[test]
fn withdraw_ok_then_double_spend_fails() {
    let (mut c, f) = setup();
    ctx(accounts(5), NearToken::from_yoctonear(0));
    let g0 = env::used_gas();
    c.withdraw(proof(&f), s(&f["poolRoot"]), s(&f["aspRoot"]), s(&f["nullifierHash"]), "bob.testnet".parse().unwrap());
    println!("withdraw gas used: {} Tgas", (env::used_gas().as_gas() - g0.as_gas()) / 1_000_000_000_000);
    assert!(c.is_spent(s(&f["nullifierHash"])));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.withdraw(proof(&f), s(&f["poolRoot"]), s(&f["aspRoot"]), s(&f["nullifierHash"]), "bob.testnet".parse().unwrap());
    }));
    assert!(r.is_err());
}
#[test]
#[should_panic(expected = "invalid proof")]
fn wrong_recipient_fails() {
    let (mut c, f) = setup();
    c.withdraw(proof(&f), s(&f["poolRoot"]), s(&f["aspRoot"]), s(&f["nullifierHash"]), "eve.testnet".parse().unwrap());
}
#[test]
#[should_panic(expected = "association set root not recognised")]
fn unknown_asp_root_fails() {
    let (mut c, f) = setup();
    c.withdraw(proof(&f), s(&f["poolRoot"]), s(&f["poolRoot"]), s(&f["nullifierHash"]), "bob.testnet".parse().unwrap());
}
#[test]
fn ragequit_only_depositor() {
    let (mut c, f) = setup();
    ctx(accounts(2), NearToken::from_yoctonear(0)); // deposit #1 was made by accounts(2)
    c.ragequit(s(&f["rq"]["nullifier"]), s(&f["rq"]["secret"]));
    assert_eq!(c.get_stats().ragequits, 1);
}
#[test]
#[should_panic(expected = "only the original depositor")]
fn ragequit_other_fails() {
    let (mut c, f) = setup();
    ctx(accounts(4), NearToken::from_yoctonear(0));
    c.ragequit(s(&f["rq"]["nullifier"]), s(&f["rq"]["secret"]));
}
