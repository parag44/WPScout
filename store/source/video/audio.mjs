// Synthesizes the promo soundtrack: an original music bed plus UI sound effects
// timed to promo.html. No samples or third-party audio, so it is free to use anywhere.
//
//   node store/source/video/audio.mjs [out.wav]
//
// Event times below mirror the timeline constants in promo.html; keep them in sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'soundtrack.wav'));

const SR = 48000, DUR = 32, N = SR * DUR;
const music = [new Float32Array(N), new Float32Array(N)];
const sfx = [new Float32Array(N), new Float32Array(N)];
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

// add a mono signal fn(localTime) -> sample, at time t0 for len seconds, with pan -1..1
function add(bus, t0, len, gain, pan, fn) {
  const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + len) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s0; i < s1; i++) { const v = fn((i - s0) / SR, i); bus[0][i] += v * gl; bus[1][i] += v * gr; }
}
const env = (t, a, len, r) => Math.min(1, t / a) * Math.min(1, Math.max(0, (len - t) / r));

// ---- music: 120 bpm, I–V–vi–IV in D, beat grid aligned so a beat lands as the popup opens (7.35s)
const BEAT = .5, BAR = 2, OFF = .35;
const CHORDS = [[50, 54, 57], [45, 49, 52], [47, 50, 54], [43, 47, 50]]; // D, A, Bm, G
const END = 27.0;
const DRUMS = [7.35, 26.85];

// pad: detuned band-limited saws, one-pole low-passed per note
function pad(t0, len, notes, gain) {
  for (const [ch, det] of [[0, -.06], [1, .06]]) for (const m of notes) for (const d of [det, -det * .5]) {
    const f = mtof(m + 12) * Math.pow(2, d / 12); let lp = 0;
    const s0 = Math.round(t0 * SR), s1 = Math.min(N, Math.round((t0 + len) * SR)), ph = (rnd() + 1) * Math.PI;
    for (let i = Math.max(0, s0); i < s1; i++) {
      const t = (i - s0) / SR; let v = 0;
      for (let h = 1; h <= 7; h++) v += Math.sin(TAU * f * h * t + ph * h) / h;
      lp += (v - lp) * .09;
      music[ch][i] += lp * env(t, .5, len, .9) * gain;
    }
  }
}
const nBars = Math.ceil((END - OFF) / BAR);
pad(0, OFF + .6, CHORDS[0], .016);
for (let b = 0; b < nBars; b++) {
  const t0 = OFF + b * BAR, len = Math.min(BAR + .6, END + .5 - t0);
  pad(t0, len, CHORDS[b % 4], .016);
}
pad(END, DUR - END, [50, 54, 57, 62], .022); // resolve on D for the end card

// arpeggio plucks from when the browser enters until the end card
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
for (let b = 0; b < nBars; b++) for (let k = 0; k < 8; k++) {
  const t0 = OFF + b * BAR + k * BEAT / 2; if (t0 < 3.35 || t0 >= END) continue;
  const c = CHORDS[b % 4], tones = [c[0] + 24, c[1] + 24, c[2] + 24, c[0] + 36];
  const f = mtof(tones[ARP[k]]), accent = k % 2 === 0 ? 1 : .7;
  add(music, t0, .6, .07 * accent, k % 2 ? .35 : -.35, (t) =>
    (Math.sin(TAU * f * t) + .3 * Math.sin(TAU * f * 2 * t) * Math.exp(-t * 18)) * Math.exp(-t * 7) * Math.min(1, t / .003));
}
// bass on every beat while the drums play
for (let t0 = DRUMS[0]; t0 < END; t0 += BEAT) {
  const b = Math.floor((t0 - OFF + 1e-6) / BAR), f = mtof(CHORDS[b % 4][0] - 12);
  add(music, t0, .45, .10, 0, (t) => (Math.sin(TAU * f * t) + .25 * Math.sin(TAU * f * 2 * t)) * env(t, .01, .45, .2));
}
// kick on 1 and 3, closed hat on the off-beats
for (let t0 = DRUMS[0]; t0 <= DRUMS[1]; t0 += BEAT) {
  const beat = Math.round((t0 - DRUMS[0]) / BEAT);
  if (beat % 2 === 0) add(music, t0, .35, .30, 0, (t) => { const f = 45 + 90 * Math.exp(-t * 30); return Math.sin(TAU * f * t) * Math.exp(-t * 9); });
  let hp = 0, prev = 0;
  add(music, t0 + BEAT / 2, .06, .05, .2, (t) => { const n = rnd(); hp = .9 * (hp + n - prev); prev = n; return hp * Math.exp(-t * 70); });
}
// side-chain style duck on the pad/arps after each kick
for (let t0 = DRUMS[0]; t0 <= DRUMS[1]; t0 += BEAT * 2) {
  const s0 = Math.round(t0 * SR);
  for (let i = s0; i < Math.min(N, s0 + SR * .3); i++) { const g = 1 - .35 * Math.exp(-((i - s0) / SR) * 12); music[0][i] *= g; music[1][i] *= g; }
}

// ---- sound effects
function whoosh(t0, len, gain, up = true) {
  let lp = 0, lp2 = 0;
  add(sfx, t0, len, gain, 0, (t) => { const p = t / len, fc = up ? .02 + .25 * p : .27 - .25 * p;
    lp += (rnd() - lp) * fc; lp2 += (lp - lp2) * fc; return lp2 * Math.sin(Math.PI * p) ** 2; });
}
const blip = (t0, f0, f1, len, gain, pan = 0) => { let ph = 0;
  add(sfx, t0, len, gain, pan, (t) => { const f = f0 + (f1 - f0) * Math.min(1, t / len); ph += TAU * f / SR; return Math.sin(ph) * Math.exp(-t * 6 / len) * Math.min(1, t / .002); }); };
const click = (t0, gain = .35) => { let bp = 0;
  add(sfx, t0, .05, gain, .5, (t) => { bp += (rnd() - bp) * .5; return bp * Math.exp(-t * 400) + .5 * Math.sin(TAU * 2400 * t) * Math.exp(-t * 160); }); };
const tick = (t0, gain) => { let hp = 0, prev = 0;
  add(sfx, t0, .03, gain, rnd() * .1, (t) => { const n = rnd(); hp = .7 * (hp + n - prev); prev = n; return (hp + .4 * Math.sin(TAU * 1700 * t)) * Math.exp(-t * 220); }); };
const bell = (t0, m, gain, pan) => { const f = mtof(m);
  add(sfx, t0, 3.5, gain, pan, (t) => (Math.sin(TAU * f * t) + .45 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 3) + .2 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.6) * Math.min(1, t / .004)); };

whoosh(2.95, 1.4, .55);                                            // browser slides in
for (let i = 1; i <= 18; i++) tick(4.4 + (i - .5) * (1.2 / 18), .22); // typing the URL
blip(6.25, 880, 1320, .09, .12, .4); blip(6.33, 1320, 1760, .08, .08, .4); // icon lights up, badge pops
for (const ct of [7.15, 11.7, 15.95, 19.95]) click(ct + .12);         // cursor clicks
blip(7.4, 520, 780, .16, .10, .3); whoosh(7.3, .5, .2);              // popup opens
whoosh(23.55, 1.2, .35, false);                                       // light to dark
whoosh(26.8, 1.0, .3, false);                                         // to end card
bell(27.55, 86, .10, -.2); bell(27.7, 93, .07, .2);                   // logo chime

// ---- reverb (Schroeder: 4 combs + 2 allpasses per channel) on music + sfx sends
function reverb(inp, sizes) {
  const o = new Float32Array(N);
  for (const L of sizes.combs) { const buf = new Float32Array(L); let j = 0, lp = 0;
    for (let i = 0; i < N; i++) { const y = buf[j]; lp = y * .6 + lp * .4; buf[j] = inp[i] + lp * .8; o[i] += y; j = (j + 1) % L; } }
  for (const L of sizes.aps) { const buf = new Float32Array(L); let j = 0;
    for (let i = 0; i < N; i++) { const b = buf[j], y = -o[i] + b; buf[j] = o[i] + b * .5; o[i] = y; j = (j + 1) % L; } }
  return o;
}
const SZ = [{ combs: [1557, 1617, 1491, 1422].map((x) => x * 2), aps: [225, 556] }, { combs: [1580, 1640, 1514, 1445].map((x) => x * 2), aps: [248, 579] }];
const mix = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) {
  const send = new Float32Array(N); for (let i = 0; i < N; i++) send[i] = music[c][i] * .5 + sfx[c][i] * .4;
  const wet = reverb(send, SZ[c]);
  for (let i = 0; i < N; i++) mix[c][i] = music[c][i] + sfx[c][i] + wet[i] * .09;
}
// fades and soft limiting
let peak = 0;
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) {
  const t = i / SR; let v = mix[c][i] * Math.min(1, t / .4) * Math.min(1, (DUR - t) / 1.8);
  v = Math.tanh(v * 1.4) / 1.4; mix[c][i] = v; peak = Math.max(peak, Math.abs(v));
}
const norm = .89 / peak;

// 16-bit stereo WAV
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) for (let c = 0; c < 2; c++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[c][i] * norm)) * 32767), i * 4 + c * 2);
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.writeFileSync(out, Buffer.concat([h, data]));
console.log(`wrote ${out}`);
