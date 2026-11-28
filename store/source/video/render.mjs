// Renders promo.html to an H.264 MP4, frame by frame.
//
//   npm i playwright-core ffmpeg-static   (anywhere; point DEPS at that folder's package.json)
//   DEPS=/path/to/deps/package.json node store/source/video/render.mjs [out.mp4] [fps]
//
// Uses the installed Google Chrome. Each frame calls window.seek(t), so the output
// is deterministic and never drops frames.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(process.env.DEPS || import.meta.url);
const { chromium } = require('playwright-core');
const ffmpeg = require('ffmpeg-static');

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, '../../wpscout-promo-1080p.mp4'));
const fps = Number(process.argv[3] || 30);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, 'promo.html')).href + '?t=0');
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState('networkidle');
const duration = await page.evaluate(() => window.DURATION);
const frames = Math.round(duration * fps);

// soundtrack: synthesized by audio.mjs, loudness-normalized to -14 LUFS for social platforms
const wav = path.join(here, 'soundtrack.wav');
execFileSync(process.execPath, [path.join(here, 'audio.mjs'), wav], { stdio: 'inherit' });

const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-i', wav,
  '-map', '0:v', '-map', '1:a', '-af', 'loudnorm=I=-14:TP=-2.5:LRA=11,alimiter=limit=0.79:level=false',
  '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });

for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.seek(t), f / fps);
  const buf = await page.screenshot({ type: 'png' });
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
  if (f % fps === 0) process.stdout.write(`\r${Math.round((f / frames) * 100)}%`);
}
enc.stdin.end();
await new Promise((r, j) => enc.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
await browser.close();
fs.rmSync(wav);
console.log(`\nwrote ${out} (${frames} frames @ ${fps}fps)`);
