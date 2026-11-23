// Original WPScout cat: a black cat peeking up from the bottom edge of a white square.
// One eye is a magnifier lens (ring + handle) in brand blue. Drawn from scratch.
const C = { ink: '#111316', blue: '#0284C7', sky: '#38BDF8', white: '#FFFFFF', bg: '#FFFFFF', whisker: '#A7AEB8', nose: '#F3A6B8' };
function cat(o = {}) {
  const { lensEye = true, eye = C.sky, ring = C.white, paws = false, bg = C.bg, border = '#E3E6EC', rx = 12, tilt = 0, whiskers = true, nose = true } = o;
  const id = 'c' + Math.random().toString(36).slice(2, 7);
  let s = `<defs><clipPath id="${id}"><rect width="128" height="128" rx="${rx}"/></clipPath></defs>`;
  s += `<rect x="0.75" y="0.75" width="126.5" height="126.5" rx="${rx}" fill="${bg}" stroke="${border}" stroke-width="1.5"/>`;
  s += `<g clip-path="url(#${id})"><g transform="rotate(${tilt} 64 96)">`;
  // head + body rising from the bottom edge, with two ears
  s += `<path d="M17 160V89C17 71 27 59 40 53.5L31.5 31C30.3 27.6 33.6 25 36.6 27L58.5 46.7C60.3 46.5 62.1 46.4 64 46.4s3.7.1 5.5.3L91.4 27c3-2 6.3.6 5.1 4L88 53.5c13 5.5 23 17.5 23 35.5v71Z" fill="${C.ink}"/>`;
  if (whiskers) s += ['M22 92 4 87', 'M22 99 4 100', 'M106 92 124 87', 'M106 99 124 100'].map((d) => `<path d="${d}" stroke="${C.whisker}" stroke-width="1.8" stroke-linecap="round"/>`).join('');
  // left eye
  s += `<circle cx="47" cy="84" r="10.5" fill="${eye}"/><circle cx="47" cy="85" r="5" fill="${C.ink}"/><circle cx="44.5" cy="81" r="2.2" fill="#fff"/>`;
  if (lensEye) {
    // right eye = magnifier: white ring + handle
    s += `<path d="M88.5 93.5 98 103" stroke="${ring}" stroke-width="5.5" stroke-linecap="round"/>`;
    s += `<circle cx="81" cy="84" r="12" fill="${eye}" stroke="${ring}" stroke-width="3.5"/><circle cx="81" cy="85" r="5" fill="${C.ink}"/><circle cx="78.5" cy="81" r="2.2" fill="#fff"/>`;
  } else {
    s += `<circle cx="81" cy="84" r="10.5" fill="${eye}"/><circle cx="81" cy="85" r="5" fill="${C.ink}"/><circle cx="78.5" cy="81" r="2.2" fill="#fff"/>`;
  }
  if (nose) s += `<path d="M60.5 97h7l-3.5 4.2z" fill="${C.nose}" stroke="${C.nose}" stroke-width="1.5" stroke-linejoin="round"/>`;
  // ledge in front of the cat, with two paws resting on it
  if (paws) s += `<rect x="-10" y="111" width="148" height="30" fill="${bg}"/><path d="M0 111h128" stroke="#C9CFD8" stroke-width="2.5"/>` +
    [42, 86].map((x) => `<path d="M${x - 14} 111.5a14 11 0 0 1 28 0z" fill="${C.ink}" stroke="${bg}" stroke-width="3"/><path d="M${x - 5} 103.5v4.5M${x + 5} 103.5v4.5" stroke="${bg}" stroke-width="2" stroke-linecap="round"/>`).join('');
  s += `</g></g>`;
  return s;
}
const V = [
  ['A', 'Lens eye, light blue', cat()],
  ['B', 'Lens eye, brand blue', cat({ eye: C.blue })],
  ['C', 'Lens eye, paws on the edge', cat({ paws: true })],
  ['D', 'Lens eye, slight tilt', cat({ tilt: -8 })],
  ['E', 'Plain eyes, light blue', cat({ lensEye: false })],
  ['F', 'Lens eye, no whiskers or nose', cat({ whiskers: false, nose: false })],
];
if (typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  for (const [k, n, b] of V) fs.writeFileSync(`cat-${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${b}</svg>`);
  console.log(V.length + ' written');
}
module.exports = { cat, C, V };
