#!/usr/bin/env node
/*
 * Generates card/kayla.pkpass — a signed Apple Wallet business card whose QR
 * points at kaylacarabes.com/card. Local tooling only, like optimize-images /
 * sync-products; the runtime site never imports this. Uses `sharp` (already a
 * dependency) for images and the system `openssl` + `zip` for signing — no new
 * npm packages, no third-party pass service.
 *
 * ONE-TIME SETUP (see the chat walkthrough for the click-by-click version):
 *   1. Apple Developer → Certificates, IDs & Profiles → Identifiers → new
 *      "Pass Type ID" (e.g. pass.com.kaylacarabes.card).
 *   2. Create a certificate for it, download, double-click into Keychain, then
 *      export the cert+key together as a .p12.
 *   3. Convert into ./certs/ (git-ignored). Add `-legacy` if openssl complains:
 *        openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out certs/signerCert.pem
 *        openssl pkcs12 -in Certificates.p12 -nocerts -out certs/signerKey.pem   (set a key password)
 *      Download Apple's WWDR G4 cert and convert:
 *        openssl x509 -inform DER -in AppleWWDRCAG4.cer -out certs/wwdr.pem
 *   4. Copy .env.example to .env and fill in PASS_TYPE_ID + TEAM_ID (Team ID is
 *      top-right in the Apple Developer portal). Set PASS_CERT_PASSWORD only if
 *      your signing key is password-protected.
 *   5. Run:  npm run generate-pass
 *   6. AirDrop / email card/kayla.pkpass to the iPhone → tap → Add to Wallet.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CERTS = path.join(ROOT, 'certs');
const BUILD = path.join(ROOT, '.pass-build');
const OUT = path.join(ROOT, 'card', 'kayla.pkpass');

// Read config from .env (git-ignored) with no dependency, without clobbering
// variables already set in the real environment (an explicit CLI value wins).
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();

// Your Apple identifiers, from .env (see .env.example). Not secrets — they're
// embedded in every pass you hand out — but kept out of git for tidiness.
const PASS_TYPE_ID = process.env.PASS_TYPE_ID || '';
const TEAM_ID = process.env.TEAM_ID || '';

// The pass. Dark card, name up top, her photo as the thumbnail, contact on the
// back, QR to /card at the bottom. Tweak freely — it's just JSON.
const passJson = {
  formatVersion: 1,
  passTypeIdentifier: PASS_TYPE_ID,
  teamIdentifier: TEAM_ID,
  serialNumber: 'kayla-carabes-card-1', // required; stable so re-runs update the same pass
  organizationName: 'Kayla Carabes',
  description: 'Kayla Carabes — Artist business card',
  logoText: 'Kayla Carabes',
  foregroundColor: 'rgb(250, 250, 250)',
  backgroundColor: 'rgb(26, 26, 26)',
  labelColor: 'rgb(160, 160, 160)',
  generic: {
    primaryFields: [
      { key: 'role', label: '', value: 'Painter' },
    ],
    secondaryFields: [
      { key: 'loc', label: 'BASED IN', value: 'Seattle, WA' },
      { key: 'site', label: 'WEBSITE', value: 'kaylacarabes.com' },
    ],
    backFields: [
      { key: 'website', label: 'Website', value: 'https://www.kaylacarabes.com',
        attributedValue: "<a href='https://www.kaylacarabes.com'>kaylacarabes.com</a>" },
      { key: 'email', label: 'Email', value: 'kjcarabes@gmail.com',
        attributedValue: "<a href='mailto:kjcarabes@gmail.com'>kjcarabes@gmail.com</a>" },
      { key: 'instagram', label: 'Instagram', value: '@kayla_carabes',
        attributedValue: "<a href='https://instagram.com/kayla_carabes'>@kayla_carabes</a>" },
      { key: 'linkedin', label: 'LinkedIn', value: 'kayla-carabes',
        attributedValue: "<a href='https://linkedin.com/in/kayla-carabes'>linkedin.com/in/kayla-carabes</a>" },
    ],
  },
  barcodes: [
    { format: 'PKBarcodeFormatQR', message: 'https://www.kaylacarabes.com/card',
      messageEncoding: 'iso-8859-1' },
  ],
};

// Wallet needs @1x/2x/3x PNGs. icon+logo from the "color theory" mark, the
// thumbnail from her portrait — all cover-cropped to squares.
async function makeImages(dir) {
  const mark = path.join(ROOT, 'assets/images/color-theory.jpeg');
  const photo = path.join(ROOT, 'assets/images/kayla.jpeg');
  const sq = (src, size, out) =>
    sharp(src).resize(size, size, { fit: 'cover' }).png().toFile(path.join(dir, out));
  await Promise.all([
    sq(mark, 29, 'icon.png'), sq(mark, 58, 'icon@2x.png'), sq(mark, 87, 'icon@3x.png'),
    sq(mark, 50, 'logo.png'), sq(mark, 100, 'logo@2x.png'), sq(mark, 150, 'logo@3x.png'),
    sq(photo, 90, 'thumbnail.png'), sq(photo, 180, 'thumbnail@2x.png'), sq(photo, 270, 'thumbnail@3x.png'),
  ]);
}

const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function main() {
  if (!PASS_TYPE_ID || !TEAM_ID) {
    console.error('✗ Set PASS_TYPE_ID and TEAM_ID in .env (copy .env.example to .env).');
    process.exit(1);
  }
  for (const f of ['signerCert.pem', 'signerKey.pem', 'wwdr.pem']) {
    if (!fs.existsSync(path.join(CERTS, f))) {
      console.error(`✗ Missing certs/${f} — complete the one-time setup at the top of this file.`);
      process.exit(1);
    }
  }

  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  fs.writeFileSync(path.join(BUILD, 'pass.json'), JSON.stringify(passJson, null, 2));
  await makeImages(BUILD);

  // manifest.json: sha1 of every file in the bundle (before manifest/signature exist)
  const manifest = {};
  for (const f of fs.readdirSync(BUILD)) manifest[f] = sha1(path.join(BUILD, f));
  fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(manifest));

  // signature: detached PKCS#7 over manifest.json, chained to Apple's WWDR cert
  execFileSync('openssl', [
    'smime', '-binary', '-sign',
    '-certfile', path.join(CERTS, 'wwdr.pem'),
    '-signer', path.join(CERTS, 'signerCert.pem'),
    '-inkey', path.join(CERTS, 'signerKey.pem'),
    '-in', path.join(BUILD, 'manifest.json'),
    '-out', path.join(BUILD, 'signature'),
    '-outform', 'DER',
    '-passin', `pass:${process.env.PASS_CERT_PASSWORD || ''}`,
  ]);

  // zip the bundle CONTENTS (files at archive root) into the .pkpass
  fs.rmSync(OUT, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', OUT, '.'], { cwd: BUILD });
  fs.rmSync(BUILD, { recursive: true, force: true });
  console.log(`✓ Wrote ${path.relative(ROOT, OUT)} — AirDrop it to the iPhone to add to Wallet.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
