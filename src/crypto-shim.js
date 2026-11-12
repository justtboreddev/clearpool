// Browser stand-in for node's crypto (some wallet deps require it at load time).
import { Buffer } from "buffer";
export const webcrypto = globalThis.crypto;
export const randomBytes = n => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export const getRandomValues = a => globalThis.crypto.getRandomValues(a);
export default { webcrypto, randomBytes, getRandomValues };
