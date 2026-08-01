// One shot VAPID keypair generator. Run once, then set the two secrets.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

console.log("VAPID_PUBLIC_KEY:");
console.log(b64url);
console.log("\nVAPID_PRIVATE_KEY (paste the whole line, it is JSON):");
console.log(JSON.stringify(privateJwk));
