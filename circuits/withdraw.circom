pragma circom 2.1.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// Merkle membership: proves leaf is in tree with given root.
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    component h[levels];
    component mux[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== cur[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== cur[i];
        mux[i].s <== pathIndices[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== mux[i].out[0];
        h[i].inputs[1] <== mux[i].out[1];
        cur[i + 1] <== h[i].out;
    }
    root <== cur[levels];
}

// ClearPool withdrawal:
//  - you know (nullifier, secret) of a deposit in the pool tree (root)
//  - that same deposit is in the approved "clean" set (aspRoot)
//  - nullifierHash prevents double spends; recipient is bound to the proof
template Withdraw(levels) {
    signal input root;
    signal input aspRoot;
    signal input nullifierHash;
    signal input recipient;

    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input aspPathElements[levels];
    signal input aspPathIndices[levels];

    component c = Poseidon(2);
    c.inputs[0] <== nullifier;
    c.inputs[1] <== secret;

    component n = Poseidon(1);
    n.inputs[0] <== nullifier;
    n.out === nullifierHash;

    component t = MerkleProof(levels);
    t.leaf <== c.out;
    for (var i = 0; i < levels; i++) { t.pathElements[i] <== pathElements[i]; t.pathIndices[i] <== pathIndices[i]; }
    t.root === root;

    component a = MerkleProof(levels);
    a.leaf <== c.out;
    for (var i = 0; i < levels; i++) { a.pathElements[i] <== aspPathElements[i]; a.pathIndices[i] <== aspPathIndices[i]; }
    a.root === aspRoot;

    signal r2;
    r2 <== recipient * recipient;
}

component main {public [root, aspRoot, nullifierHash, recipient]} = Withdraw(12);
