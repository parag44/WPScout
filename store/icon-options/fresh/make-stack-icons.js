// Stack icon: three layers (the site's tech stack) on a charcoal rounded square. No scan line.
const fs = require('fs'); const out = process.argv[2];
function stack({ tile, top, mid, low }, dy = 4) {
  return `<rect width="128" height="128" rx="28" fill="${tile}"/><g transform="translate(0 ${dy})">` +
    `<path d="M64 24 100 42 64 60 28 42Z" fill="${top}" stroke="${top}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M30 60 64 77 98 60" fill="none" stroke="${mid}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M30 78 64 95 98 78" fill="none" stroke="${low}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
const pal = {
  active: { tile: '#14171B', top: '#FFFFFF', mid: '#FFFFFF', low: 'rgba(255,255,255,.55)' },
  dim: { tile: '#8C94A6', top: '#FFFFFF', mid: '#FFFFFF', low: 'rgba(255,255,255,.55)' },
};
const wrap = (body, size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${pad} ${pad}) scale(${((size - 2 * pad) / 128).toFixed(5)})">${body}</g></svg>`;
// 16px drawn on the pixel grid: solid top plate and two chevrons, slightly thicker.
const s16 = ({ tile, top, mid, low }) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3.5" fill="${tile}"/>` +
  `<path d="M8 2.6 12.9 5.1 8 7.6 3.1 5.1Z" fill="${top}" stroke="${top}" stroke-width=".6" stroke-linejoin="round"/>` +
  `<path d="M3.4 8 8 10.3 12.6 8" fill="none" stroke="${mid}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M3.4 10.8 8 13.1 12.6 10.8" fill="none" stroke="${low}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
for (const [k, p] of Object.entries(pal)) {
  fs.writeFileSync(`${out}/${k}-16.svg`, s16(p));
  fs.writeFileSync(`${out}/${k}-32.svg`, wrap(stack(p), 32, 0));
  fs.writeFileSync(`${out}/${k}-48.svg`, wrap(stack(p), 48, 4));
  fs.writeFileSync(`${out}/${k}-128.svg`, wrap(stack(p), 128, 16));
}
fs.writeFileSync(`${out}/logo.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${stack(pal.active)}</svg>`);
console.log('ok');
