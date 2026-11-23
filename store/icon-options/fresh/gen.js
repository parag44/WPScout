// Fresh WPScout icon concepts, each tied to what the extension does. All original.
const C = { blue: '#0284C7', sky: '#38BDF8', ink: '#14171B', navy: '#0B3A5B', white: '#FFFFFF' };
const tile = (fill) => `<rect width="128" height="128" rx="28" fill="${fill}"/>`;
const V = {
  // 1. Binoculars: the literal "scout". Bold two-lens silhouette, clear at 16px.
  binoculars: tile(C.blue) +
    `<rect x="27" y="30" width="30" height="44" rx="12" fill="${C.white}"/><rect x="71" y="30" width="30" height="44" rx="12" fill="${C.white}"/>` +
    `<rect x="52" y="50" width="24" height="16" rx="5" fill="${C.white}"/>` +
    `<circle cx="42" cy="78" r="23" fill="${C.white}"/><circle cx="86" cy="78" r="23" fill="${C.white}"/>` +
    `<circle cx="42" cy="78" r="13" fill="${C.navy}"/><circle cx="86" cy="78" r="13" fill="${C.navy}"/>` +
    `<circle cx="37.5" cy="73.5" r="4" fill="${C.sky}"/><circle cx="81.5" cy="73.5" r="4" fill="${C.sky}"/>`,
  // 2. Stack scan: three layers (the tech stack) with a scan beam passing through.
  stackscan: tile(C.ink) +
    `<path d="M64 26 100 44 64 62 28 44Z" fill="${C.white}"/>` +
    `<path d="M30 60 64 77 98 60" fill="none" stroke="${C.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M30 78 64 95 98 78" fill="none" stroke="${C.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>` +
    `<rect x="14" y="66" width="100" height="7" rx="3.5" fill="${C.sky}"/>`,
  // 3. Radar: scouting a site, with a sweep and a blip.
  radar: tile(C.ink) +
    `<circle cx="64" cy="64" r="40" fill="none" stroke="${C.white}" stroke-opacity=".28" stroke-width="5"/>` +
    `<circle cx="64" cy="64" r="22" fill="none" stroke="${C.white}" stroke-opacity=".28" stroke-width="5"/>` +
    `<path d="M64 64 64 24A40 40 0 0 1 98.6 44Z" fill="${C.sky}" opacity=".9"/>` +
    `<path d="M64 64 98.6 44" stroke="${C.white}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="64" cy="64" r="6" fill="${C.white}"/><circle cx="82" cy="80" r="6" fill="${C.sky}"/>`,
  // 4. Inspect: an eye between code brackets, "looking into the code".
  inspect: tile(C.blue) +
    `<path d="M33 42 15 64 33 86M95 42 113 64 95 86" fill="none" stroke="${C.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M38 64C45 52 54 46 64 46s19 6 26 18c-7 12-16 18-26 18s-19-6-26-18Z" fill="${C.white}"/>` +
    `<circle cx="64" cy="64" r="10" fill="${C.navy}"/><circle cx="60.5" cy="60.5" r="3.2" fill="${C.white}"/>`,
  // 5. Layers + lens: the stack under a magnifier.
  layerlens: tile(C.white) + `<rect x="0.75" y="0.75" width="126.5" height="126.5" rx="27.5" fill="none" stroke="#E3E6EC" stroke-width="1.5"/>` +
    `<rect x="20" y="28" width="62" height="14" rx="7" fill="${C.ink}"/><rect x="20" y="50" width="50" height="14" rx="7" fill="${C.ink}" opacity=".7"/><rect x="20" y="72" width="38" height="14" rx="7" fill="${C.ink}" opacity=".45"/>` +
    `<circle cx="80" cy="78" r="21" fill="${C.white}" stroke="${C.blue}" stroke-width="9"/><path d="M95 93 108 106" stroke="${C.blue}" stroke-width="11" stroke-linecap="round"/>`,
  // 6. Health pulse: a lens with a heartbeat line, for the new Checks/Health features.
  pulse: tile(C.ink) +
    `<circle cx="56" cy="56" r="34" fill="none" stroke="${C.white}" stroke-width="9"/><path d="M81 81 104 104" stroke="${C.white}" stroke-width="12" stroke-linecap="round"/>` +
    `<path d="M30 58h11l6-13 9 25 7-17 4 5h13" fill="none" stroke="${C.sky}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
};
if (require.main === module) {
  const fs = require('fs');
  for (const [k, b] of Object.entries(V)) fs.writeFileSync(`${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${b}</svg>`);
  console.log(Object.keys(V).length + ' written');
}
module.exports = { V, C };
