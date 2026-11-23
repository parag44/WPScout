// Original "idea + search" mark for WPScout: bulb with a magnifier lens, base bars, optional rays.
const C = { navy: '#1F3550', blue: '#0284C7', sky: '#38BDF8', white: '#FFFFFF', dark: '#23272B', light: '#F4F6F8' };
function bulb(o) {
  const { tile, body, lens, rays, base, gap = C.white, rx = 10, w = false, outline = false, lensW = 6, handleW = 8 } = o;
  const cx = 64, cy = 54, r = 29;
  let s = tile ? `<rect width="128" height="128" rx="${rx}" fill="${tile}"/>` : '';
  if (rays) {
    s += [-150, -120, -90, -60, -30].map((a) => {
      const t = a * Math.PI / 180, r1 = r + 8, r2 = r + 15;
      return `<path d="M${(cx + r1 * Math.cos(t)).toFixed(1)} ${(cy + r1 * Math.sin(t)).toFixed(1)} ${(cx + r2 * Math.cos(t)).toFixed(1)} ${(cy + r2 * Math.sin(t)).toFixed(1)}" stroke="${rays}" stroke-width="5" stroke-linecap="round"/>`;
    }).join('');
  }
  // glass + neck as one shape
  const glass = `M${cx - 20} ${cy + 21}C${cx - 27} ${cy + 15} ${cx - r} ${cy + 7} ${cx - r} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0c0 ${7} -2 ${15} -9 ${21}c-4 4 -5 8 -5 12v4h-22v-4c0-4-1-8-5-12z`;
  s += outline
    ? `<path d="${glass}" fill="none" stroke="${body}" stroke-width="6" stroke-linejoin="round"/>`
    : `<path d="${glass}" fill="${body}"/>`;
  // base bars
  s += `<rect x="${cx - 16}" y="${cy + 41}" width="32" height="6" rx="3" fill="${base}"/><rect x="${cx - 12}" y="${cy + 50}" width="24" height="6" rx="3" fill="${base}"/><rect x="${cx - 7}" y="${cy + 59}" width="14" height="5" rx="2.5" fill="${base}"/>`;
  // lens: gap ring, lens ring, handle (with a gap stroke so it separates from the bulb)
  const lx = cx - 2, ly = cy - 2, lr = 15;
  // The handle stays inside the glass (no background-coloured outline), so the bulb's
  // silhouette is never notched where the handle meets its edge.
  s += `<circle cx="${lx}" cy="${ly}" r="${lr + 5}" fill="${gap}"/>`;
  s += `<circle cx="${lx}" cy="${ly}" r="${lr}" fill="${gap}" stroke="${lens}" stroke-width="${lensW}"/>`;
  s += `<path d="M${lx + 12} ${ly + 12} ${lx + 18.5} ${ly + 18.5}" stroke="${lens}" stroke-width="${handleW}" stroke-linecap="round"/>`;
  if (w) s += `<path d="M${lx - 7.5} ${ly - 4.5} ${lx - 3.8} ${ly + 6} ${lx} ${ly} ${lx + 3.8} ${ly + 6} ${lx + 7.5} ${ly - 4.5}" fill="none" stroke="${lens}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
const V = [
  ['1', 'Light tile, with rays', bulb({ tile: C.light, body: C.navy, lens: C.blue, rays: C.blue, base: C.blue, gap: C.light })],
  ['2', 'Light tile, no rays',   bulb({ tile: C.light, body: C.navy, lens: C.blue, base: C.blue, gap: C.light })],
  ['3', 'Brand blue tile',       bulb({ tile: C.blue, body: C.white, lens: C.navy, rays: C.white, base: C.white, gap: C.blue })],
  ['4', 'Dark tile',             bulb({ tile: C.dark, body: C.white, lens: C.sky, rays: C.sky, base: C.sky, gap: C.dark })],
  ['5', 'Lens with a W',         bulb({ tile: C.light, body: C.navy, lens: C.blue, rays: C.blue, base: C.blue, gap: C.light, w: true })],
  ['6', 'Outline bulb',          bulb({ tile: C.light, body: C.navy, lens: C.blue, rays: C.blue, base: C.navy, gap: C.light, outline: true })],
];
if (typeof module !== 'undefined') {
  const fs = require('fs');
  for (const [k, n, b] of V) fs.writeFileSync(`bulb-${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${b}</svg>`);
  console.log(V.length + ' written');
}
