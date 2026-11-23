const fs = require('fs'); const out = process.argv[2];
const W = (fill, k) => { const p = [[30,40],[45,40],[53,70],[60,48],[68,48],[75,70],[83,40],[98,40],[83,88],[70,88],[64,69],[58,88],[45,88]];
  return `<path d="M${p.map(([x, y]) => `${(64 + (x - 64) * k).toFixed(2)} ${(64 + (y - 64) * k).toFixed(2)}`).join('L')}Z" fill="${fill}" stroke="${fill}" stroke-width="2.5" stroke-linejoin="round"/>`; };
const hex = (r, fill, round) => `<polygon points="${Array.from({ length: 6 }, (_, i) => { const a = (-90 + i * 60) * Math.PI / 180; return `${(64 + r * Math.cos(a)).toFixed(2)} ${(64 + r * Math.sin(a)).toFixed(2)}`; }).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="${round}" stroke-linejoin="round"/>`;
// small sizes: slightly larger hexagon and W so the black ring and letter stay crisp
const badge = (ring, plate, letter, small) => `<circle cx="64" cy="64" r="64" fill="${ring}"/>` + hex(small ? 47 : 44, plate, 8) + W(letter, small ? 0.8 : 0.75);
const wrap = (body, size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${pad} ${pad}) scale(${((size - 2 * pad) / 128).toFixed(5)})">${body}</g></svg>`;
const pal = { active: ['#14171B', '#FFFFFF', '#14171B'], dim: ['#8C94A6', '#FFFFFF', '#8C94A6'] };
for (const [k, [r, p, l]] of Object.entries(pal)) {
  fs.writeFileSync(`${out}/${k}-16.svg`, wrap(badge(r, p, l, true), 16, 0));
  fs.writeFileSync(`${out}/${k}-32.svg`, wrap(badge(r, p, l, true), 32, 0));
  fs.writeFileSync(`${out}/${k}-48.svg`, wrap(badge(r, p, l, false), 48, 2));
  fs.writeFileSync(`${out}/${k}-128.svg`, wrap(badge(r, p, l, false), 128, 16));
}
fs.writeFileSync(`${out}/logo.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${badge(...pal.active, false)}</svg>`);
console.log('ok');
