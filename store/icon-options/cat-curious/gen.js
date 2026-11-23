// Curious WPScout cat: original drawing. Curiosity comes from a head tilt, big dilated
// pupils and a gaze aimed off to one side (pupils offset in the same direction).
const C = { ink: '#111316', gold: '#FFC64A', blue: '#38BDF8', brand: '#0284C7', white: '#FFFFFF', whisker: '#A7AEB8', nose: '#F3A6B8' };
let uid = 0;
const HEAD = 'M17 170V89C17 71 27 59 40 53.5L31.5 31C30.3 27.6 33.6 25 36.6 27L58.5 46.7C60.3 46.5 62.1 46.4 64 46.4s3.7.1 5.5.3L91.4 27c3-2 6.3.6 5.1 4L88 53.5c13 5.5 23 17.5 23 35.5v81Z';
function eye(cx, cy, r, iris, gx, gy, pupil = 0.62) {
  const px = cx + gx * r * 0.28, py = cy + gy * r * 0.28, pr = r * pupil;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${iris}"/>` +
    `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${pr.toFixed(1)}" fill="${C.ink}"/>` +
    `<circle cx="${(px - pr * 0.38).toFixed(1)}" cy="${(py - pr * 0.42).toFixed(1)}" r="${(pr * 0.3).toFixed(1)}" fill="#fff"/>` +
    `<circle cx="${(px + pr * 0.3).toFixed(1)}" cy="${(py + pr * 0.25).toFixed(1)}" r="${(pr * 0.12).toFixed(1)}" fill="#fff"/>`;
}
function cat(o = {}) {
  const { iris = C.gold, tilt = -16, gx = 0.7, gy = -0.7, paws = false, lens = false, whiskers = true, nose = true, eyeR = 13.5, pupil = 0.62, bg = C.white, border = '#E3E6EC', rx = 12, shift = 0 } = o;
  const id = 'k' + (uid++);
  let s = `<defs><clipPath id="${id}"><rect width="128" height="128" rx="${rx}"/></clipPath></defs>` +
    `<rect x="0.75" y="0.75" width="126.5" height="126.5" rx="${rx}" fill="${bg}" stroke="${border}" stroke-width="1.5"/>` +
    `<g clip-path="url(#${id})"><g transform="translate(${shift} 0) rotate(${tilt} 64 104)">`;
  s += `<ellipse cx="64" cy="150" rx="78" ry="42" fill="${C.ink}"/><path d="${HEAD}" fill="${C.ink}"/>`;  // shoulders fill the corners when the head tilts
  if (whiskers) s += ['M22 93 3 88', 'M22 100 3 101', 'M106 93 125 88', 'M106 100 125 101'].map((d) => `<path d="${d}" stroke="${C.whisker}" stroke-width="1.8" stroke-linecap="round"/>`).join('');
  const L = [46, 83], R = [82, 83];
  if (!lens) {
    s += eye(L[0], L[1], eyeR, iris, gx, gy, pupil) + eye(R[0], R[1], eyeR, iris, gx, gy, pupil);
  } else {
    // left eye normal; right eye seen through a magnifier, enlarged
    s += eye(L[0], L[1], eyeR * 0.92, iris, gx, gy, pupil);
    const lr = 23, lid = id + 'l';
    s += `<path d="M${R[0] + lr * 0.72} ${R[1] + lr * 0.72} ${R[0] + lr * 1.55} ${R[1] + lr * 1.55}" stroke="${C.brand}" stroke-width="8" stroke-linecap="round"/>`;
    s += `<defs><clipPath id="${lid}"><circle cx="${R[0]}" cy="${R[1]}" r="${lr}"/></clipPath></defs>`;
    s += `<circle cx="${R[0]}" cy="${R[1]}" r="${lr}" fill="${C.ink}"/><g clip-path="url(#${lid})">${eye(R[0], R[1] + 1, eyeR * 1.45, iris, gx, gy, pupil)}</g>`;
    s += `<circle cx="${R[0]}" cy="${R[1]}" r="${lr}" fill="#fff" fill-opacity=".08" stroke="${C.brand}" stroke-width="4.5"/>`;
  }
  if (nose) s += `<path d="M60.5 98h7l-3.5 4.2z" fill="${C.nose}" stroke="${C.nose}" stroke-width="1.5" stroke-linejoin="round"/>`;
  s += `</g>`;
  if (paws) s += `<rect x="-10" y="112" width="148" height="30" fill="${bg}"/><path d="M0 112h128" stroke="#C9CFD8" stroke-width="2.5"/>` +
    [44, 88].map((x) => `<path d="M${x - 14} 112.5a14 11 0 0 1 28 0z" fill="${C.ink}" stroke="${bg}" stroke-width="2"/><path d="M${x - 5} 105.5v3.5M${x + 5} 105.5v3.5" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/>`).join('');
  return s + `</g>`;
}
const V = [
  ['A', 'Head tilt, gold eyes looking up', () => cat()],
  ['B', 'Head tilt, blue eyes looking up', () => cat({ iris: C.blue })],
  ['C', 'Peeking over a ledge, head tilt', () => cat({ paws: true, tilt: -14 })],
  ['D', 'Looking through a magnifier', () => cat({ lens: true, tilt: -12, gx: 0.5, gy: -0.6 })],
  ['E', 'Tilt the other way, wide pupils', () => cat({ tilt: 16, gx: -0.75, gy: -0.6, pupil: 0.74 })],
  ['F', 'Big eyes, glancing sideways', () => cat({ tilt: -10, gx: 1, gy: -0.15, eyeR: 15, whiskers: false })],
];
if (require.main === module) {
  const fs = require('fs');
  for (const [k, , f] of V) fs.writeFileSync(`cat-${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${f()}</svg>`);
  console.log(V.length + ' written');
}
module.exports = { cat, eye, C, V };
