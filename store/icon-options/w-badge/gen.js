// Original W-badge icons for WPScout: a bold geometric W inside a badge shape.
const C = { ink: '#14171B', brand: '#0284C7', sky: '#38BDF8', white: '#FFFFFF' };
// Bold W with flat tops and a raised middle peak (128-unit grid), scaled about the centre.
function W(fill, k = 1, dy = 0) {
  const p = [[30,40],[45,40],[53,70],[60,48],[68,48],[75,70],[83,40],[98,40],[83,88],[70,88],[64,69],[58,88],[45,88]];
  return `<path d="M${p.map(([x, y]) => `${(64 + (x - 64) * k).toFixed(1)} ${(64 + (y - 64) * k + dy).toFixed(1)}`).join('L')}Z" fill="${fill}" stroke="${fill}" stroke-width="2.5" stroke-linejoin="round"/>`;
}
const poly = (n, r, rot, cx = 64, cy = 64) => Array.from({ length: n }, (_, i) => { const a = (rot + i * 360 / n) * Math.PI / 180; return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const roundPoly = (n, r, rot, fill, round = 10) => `<polygon points="${poly(n, r, rot)}" fill="${fill}" stroke="${fill}" stroke-width="${round}" stroke-linejoin="round"/>`;
const V = [
  ['1', 'Hexagon, black on white', `<circle cx="64" cy="64" r="62" fill="${C.ink}"/>` + roundPoly(6, 44, -90, C.white, 8) + W(C.ink, 0.62)],
  ['2', 'Hexagon, brand blue', roundPoly(6, 58, -90, C.brand, 12) + W(C.white, 0.8)],
  ['3', 'Circle badge', `<circle cx="64" cy="64" r="62" fill="${C.brand}"/><circle cx="64" cy="64" r="50" fill="none" stroke="${C.white}" stroke-width="5"/>` + W(C.white, 0.68)],
  ['4', 'Shield', `<path d="M64 8 108 22V60c0 30-19 50-44 60C39 110 20 90 20 60V22Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>` + W(C.sky, 0.72, -4)],
  ['5', 'Rounded square', `<rect x="6" y="6" width="116" height="116" rx="28" fill="${C.ink}"/>` + W(C.sky, 0.86)],
  ['6', 'W in a magnifier', `<rect x="6" y="6" width="116" height="116" rx="28" fill="${C.brand}"/><path d="M86 86 106 106" stroke="${C.white}" stroke-width="13" stroke-linecap="round"/><circle cx="58" cy="58" r="38" fill="${C.white}"/>` + `<g transform="translate(-6 -6)">${W(C.brand, 0.6)}</g>`],
];
if (require.main === module) {
  const fs = require('fs');
  for (const [k, , b] of V) fs.writeFileSync(`w-${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${b}</svg>`);
  console.log(V.length + ' written');
}
module.exports = { V };
