#!/usr/bin/env node
/*
 * Image optimization pipeline.
 *
 * For every image referenced by content/works.json (work.image and work.detail_images),
 * generate WebP variants at the widths in WIDTHS, scaled down from the source.
 * Variants are written under assets/images/optimized/ mirroring the source path.
 * The script also computes each work's natural aspect ratio and the list of
 * generated widths and writes them back into content/works.json so the runtime
 * can build a <picture srcset> without ever loading the original to measure it.
 *
 * Idempotent: skips re-encoding when the variant exists and is newer than the source.
 *
 * Run:   npm run optimize-images
 */

const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const WORKS_PATH = path.join(ROOT, 'content/works.json');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SOURCE_BASE = path.join(ROOT, 'assets/images');
const OUTPUT_BASE = path.join(ROOT, 'assets/images/optimized');

const WIDTHS = [400, 800, 1200, 1600];
const WEBP_QUALITY = 82; // visually indistinguishable from JPEG q90 at ~1/3 the bytes

function variantOutputPath(srcRelFromImagesBase, width) {
    const dir = path.dirname(srcRelFromImagesBase);
    const base = path.basename(srcRelFromImagesBase, path.extname(srcRelFromImagesBase));
    const sub = dir === '.' ? '' : dir + '/';
    return path.join(OUTPUT_BASE, sub + `${base}-${width}.webp`);
}

async function isUpToDate(srcPath, outPath) {
    try {
        const [s, o] = await Promise.all([fs.stat(srcPath), fs.stat(outPath)]);
        return o.mtimeMs >= s.mtimeMs;
    } catch {
        return false;
    }
}

// Resolve a "assets/images/..."-style path (or a path with no prefix) to an absolute path.
function resolveSourcePath(imageField) {
    if (!imageField) return null;
    const trimmed = imageField.replace(/^\.?\//, '');
    if (trimmed.startsWith('assets/images/')) {
        return path.join(ROOT, trimmed);
    }
    // Some entries may be relative to assets/images/ already
    return path.join(SOURCE_BASE, trimmed);
}

async function optimizeOne(srcAbsPath) {
    const meta = await sharp(srcAbsPath).metadata();
    if (!meta.width || !meta.height) {
        throw new Error(`Could not read dimensions for ${srcAbsPath}`);
    }
    const srcRel = path.relative(SOURCE_BASE, srcAbsPath);
    const aspectRatio = meta.width / meta.height;
    const generated = [];

    for (const w of WIDTHS) {
        if (w > meta.width) continue; // never upscale — pointless bytes
        const outPath = variantOutputPath(srcRel, w);
        generated.push(w);
        if (await isUpToDate(srcAbsPath, outPath)) continue;
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await sharp(srcAbsPath)
            .rotate() // honor EXIF orientation so portrait phones don't end up sideways
            .resize({ width: w, withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toFile(outPath);
        process.stdout.write(`  · ${path.relative(ROOT, outPath)}\n`);
    }

    // Always include a near-original-size variant so high-DPI displays still get
    // something sharper than the largest WIDTHS bucket if the source is huge.
    if (meta.width > WIDTHS[WIDTHS.length - 1]) {
        const fullOutPath = variantOutputPath(srcRel, meta.width);
        generated.push(meta.width);
        if (!(await isUpToDate(srcAbsPath, fullOutPath))) {
            await fs.mkdir(path.dirname(fullOutPath), { recursive: true });
            await sharp(srcAbsPath)
                .rotate()
                .webp({ quality: WEBP_QUALITY })
                .toFile(fullOutPath);
            process.stdout.write(`  · ${path.relative(ROOT, fullOutPath)}\n`);
        }
    }

    return { aspectRatio: Number(aspectRatio.toFixed(4)), widths: generated };
}

async function main() {
    const raw = await fs.readFile(WORKS_PATH, 'utf8');
    const data = JSON.parse(raw);
    const works = data.works || [];

    // Collect every referenced image path; dedupe so we don't re-encode shared assets.
    const refs = new Set();
    for (const w of works) {
        if (w.image) refs.add(w.image);
        if (Array.isArray(w.detail_images)) {
            for (const di of w.detail_images) refs.add(di);
        }
    }

    process.stdout.write(`Optimizing ${refs.size} unique images...\n`);
    const meta = new Map();
    for (const ref of refs) {
        const abs = resolveSourcePath(ref);
        try {
            const info = await optimizeOne(abs);
            meta.set(ref, info);
        } catch (e) {
            process.stderr.write(`! Skipped ${ref}: ${e.message}\n`);
        }
    }

    // Write aspectRatio + widths for the *main* image of each work back into works.json.
    let updated = 0;
    for (const w of works) {
        const info = meta.get(w.image);
        if (!info) continue;
        if (w.aspectRatio !== info.aspectRatio || JSON.stringify(w.widths) !== JSON.stringify(info.widths)) {
            w.aspectRatio = info.aspectRatio;
            w.widths = info.widths;
            updated++;
        }
    }

    await fs.writeFile(WORKS_PATH, JSON.stringify(data, null, 2) + '\n');
    process.stdout.write(`\nDone. ${meta.size} images processed, ${updated} works updated in works.json.\n`);

    await updateHeroPreload(works);
}

// Write a <link rel="preload"> into index.html for the first heroFeature work so the
// browser can start fetching the LCP image before main.js runs. Matches the runtime
// `sizes="100vw"` so DPR picks the right variant.
async function updateHeroPreload(works) {
    const hero = works.find(w => w.heroFeature);
    if (!hero || !hero.image) return;

    const m = hero.image.match(/^(?:\.\/)?assets\/images\/(.+)\.[^.]+$/);
    let tag;
    if (m && Array.isArray(hero.widths) && hero.widths.length > 0) {
        const base = m[1];
        const srcset = hero.widths
            .map(w => `assets/images/optimized/${base}-${w}.webp ${w}w`)
            .join(', ');
        tag = `<link rel="preload" as="image" type="image/webp" imagesrcset="${srcset}" imagesizes="100vw" fetchpriority="high">`;
    } else {
        tag = `<link rel="preload" as="image" href="${hero.image}" fetchpriority="high">`;
    }

    const html = await fs.readFile(INDEX_PATH, 'utf8');
    const replaced = html.replace(
        /<!-- HERO-PRELOAD:START -->[\s\S]*?<!-- HERO-PRELOAD:END -->/,
        `<!-- HERO-PRELOAD:START -->\n    ${tag}\n    <!-- HERO-PRELOAD:END -->`
    );
    if (replaced === html) {
        process.stdout.write('! index.html has no HERO-PRELOAD markers; skipping preload injection.\n');
        return;
    }
    if (replaced !== html) {
        await fs.writeFile(INDEX_PATH, replaced);
        process.stdout.write(`Hero preload updated for ${hero.image}.\n`);
    }
}

main().catch(e => {
    process.stderr.write(`\nFAILED: ${e.stack || e.message}\n`);
    process.exit(1);
});
