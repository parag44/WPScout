// Radar icon at every size. 16 and 32px get thicker, brighter rings so they don't vanish.
const fs = require('fs'); const out = process.argv[2];
function radar({ tile, ring, sweep, ink, blip }, small) {
  const rw = small ? 8 : 5, ro = small ? 0.45 : 0.28;
  return `<rect width="128" height="128" rx="28" fill="${tile}"/>` +
    `<circle cx="64" cy="64" r="${small ? 42 : 40}" fill="none" stroke="${ring}" stroke-opacity="${ro}" stroke-width="${rw}"/>` +
    (small ? '' : `<circle cx="64" cy="64" r="22" fill="none" stroke="${ring}" stroke-opacity="${ro}" stroke-width="${rw}"/>`) +
    `<path d="M64 64 64 ${small ? 22 : 24}A${small ? 42 : 40} ${small ? 42 : 40} 0 0 1 ${small ? 100.4 : 98.6} ${small ? 43 : 44}Z" fill="${sweep}" opacity=".9"/>` +
    `<path d="M64 64 ${small ? 100.4 : 98.6} ${small ? 43 : 44}" stroke="${ink}" stroke-width="${small ? 7 : 5}" stroke-linecap="round"/>` +
    `<circle cx="64" cy="64" r="${small ? 9 : 6}" fill="${ink}"/><circle cx="${small ? 84 : 82}" cy="${small ? 84 : 80}" r="${small ? 9 : 6}" fill="${blip}"/>`;
}
const pal = {
  active: { tile: '#14171B', ring: '#FFFFFF', sweep: '#38BDF8', ink: '#FFFFFF', blip: '#38BDF8' },
  dim: { tile: '#8C94A6', ring: '#FFFFFF', sweep: '#D5D9E0', ink: '#FFFFFF', blip: '#D5D9E0' },
};
const wrap = (body, size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${pad} ${pad}) scale(${((size - 2 * pad) / 128).toFixed(5)})">${body}</g></svg>`;
for (const [k, p] of Object.entries(pal)) {
  fs.writeFileSync(`${out}/${k}-16.svg`, wrap(radar(p, true), 16, 0));
  fs.writeFileSync(`${out}/${k}-32.svg`, wrap(radar(p, true), 32, 0));
  fs.writeFileSync(`${out}/${k}-48.svg`, wrap(radar(p, false), 48, 4));
  fs.writeFileSync(`${out}/${k}-128.svg`, wrap(radar(p, false), 128, 16));
}
fs.writeFileSync(`${out}/logo.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${radar(pal.active, false)}</svg>`);
console.log('ok');
