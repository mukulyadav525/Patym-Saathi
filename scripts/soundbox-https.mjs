#!/usr/bin/env node
// HTTPS for the Soundbox on the shop Wi-Fi. iPad Safari only allows the microphone on https, so this serves the
// dashboard (running on http://localhost:3000) at https://<laptop-ip>:3443 with a certificate from a small
// local certificate authority. Install that authority on the iPad once and the page is trusted.
//
//   npm run web:prod      (one terminal)
//   npm run soundbox      (another)
//
// The certificate is re-issued automatically when the laptop's Wi-Fi address changes.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, "certs");
const PORT = Number(process.env.SOUNDBOX_PORT ?? 3443);
const TARGET = Number(process.env.WEB_PORT ?? 3000);
const CA_KEY = path.join(DIR, "saathi-local-ca.key");
const CA_CERT = path.join(DIR, "saathi-local-ca.pem");
const KEY = path.join(DIR, "soundbox.key");
const CERT = path.join(DIR, "soundbox.pem");
const NAMES = path.join(DIR, "soundbox.names");

// Wi-Fi / Ethernet adapters first (en0 on a Mac); virtual ones (VPN, containers) only if nothing else exists.
function lanAddresses() {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? [])
    .filter((a) => a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
    .map((a) => ({ name, address: a.address })));
  const real = all.filter((a) => /^(en|eth|wlan|wl)/.test(a.name)).sort((x, y) => x.name.localeCompare(y.name));
  return (real.length ? real : all).map((a) => a.address);
}

function openssl(...args) {
  execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
}

function ensureCerts(ips) {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(CA_CERT)) {
    const conf = path.join(DIR, "ca.cnf");
    writeFileSync(conf, [
      "[req]", "distinguished_name=dn", "x509_extensions=ext", "prompt=no",
      "[dn]", "CN=Paytm Saathi local demo CA", "O=TeamAIR01 hackathon",
      "[ext]", "basicConstraints=critical,CA:TRUE", "keyUsage=critical,keyCertSign,cRLSign", "subjectKeyIdentifier=hash",
    ].join("\n"));
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825", "-keyout", CA_KEY, "-out", CA_CERT, "-config", conf);
  }
  const names = ["localhost", ...ips].join(",");
  if (existsSync(CERT) && existsSync(NAMES) && readFileSync(NAMES, "utf8") === names) return;
  const csr = path.join(DIR, "soundbox.csr");
  const ext = path.join(DIR, "soundbox.ext");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", KEY, "-out", csr, "-subj", "/CN=Paytm Saathi Soundbox");
  // iOS trusts a server certificate only with a SAN, serverAuth and at most 825 days of validity.
  writeFileSync(ext, [
    "basicConstraints=CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment", "extendedKeyUsage=serverAuth",
    `subjectAltName=DNS:localhost,IP:127.0.0.1${ips.map((ip) => `,IP:${ip}`).join("")}`,
  ].join("\n"));
  openssl("x509", "-req", "-in", csr, "-CA", CA_CERT, "-CAkey", CA_KEY, "-CAcreateserial", "-out", CERT, "-days", "800", "-sha256", "-extfile", ext);
  writeFileSync(NAMES, names);
}

const ips = lanAddresses();
ensureCerts(ips);

const server = https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (req, res) => {
  const upstream = http.request(
    { host: "127.0.0.1", port: TARGET, method: req.method, path: req.url,
      headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-for": req.socket.remoteAddress ?? "" } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`The website isn't running on port ${TARGET}. Start it with: npm run web:prod`);
  });
  req.pipe(upstream);
});
server.requestTimeout = 0; // the live feed long-polls
server.listen(PORT, "0.0.0.0", () => {
  const main = ips[0] ?? "localhost";
  console.log(`\nSoundbox (https) is up.\n`);
  for (const ip of ips) console.log(`  iPad:   https://${ip}:${PORT}/soundbox`);
  console.log(`  Laptop: https://localhost:${PORT}/soundbox\n`);
  console.log("First time on the iPad (once):");
  console.log(`  1. Send ${path.relative(ROOT, CA_CERT)} to the iPad (AirDrop) and open it -> "Profile Downloaded".`);
  console.log("  2. Settings -> General -> VPN & Device Management -> install the profile.");
  console.log("  3. Settings -> General -> About -> Certificate Trust Settings -> turn on \"Paytm Saathi local demo CA\".");
  console.log(`  4. Open https://${main}:${PORT}/soundbox in Safari, sign in, tap Start, allow the microphone.\n`);
});
