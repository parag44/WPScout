# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (Chrome extension, Manifest V3; 420 × 600 toolbar popup)

## Users
- **WordPress developers and agencies** who look at a competitor's or client's site and want its stack: theme, plugins with versions, hosting, cache, PHP and server.
- **SEO specialists and marketers** who want plugin and theme names quickly and need fewer header-level details.

## Product Purpose
WPScout tells you in one click whether a site runs WordPress and what it's built with, and shows the evidence for each finding. It's working when you can name the site's theme, main plugins and host within a few seconds of opening the popup.

## Capabilities and Constraints
- Detection runs in a content script (DOM, inline scripts and styles, response headers, `/wp-json` namespaces). The background worker caches each tab's report, so the popup opens instantly.
- Enrichment: Google DNS-over-HTTPS (IP and nameservers), ipwho.is (ISP and location), and api.wordpress.org (plugin and theme metadata and icons).
- Output: copy a Markdown report or export JSON. Light and dark themes.
- Popup size is fixed by Chrome at a maximum of 800 × 600. The current design uses 420 × 600.

## Brand Commitments
- Brand colour **#0284C7**, the 1.5.2 blue (owner's choice, 2026-11-18). Buttons and links use #0369A1 so white text and link text pass AA. Dark mode uses #38BDF8 for links and indicators.
- Logo: a stack of three layers (white, the bottom one at 55% opacity) on a charcoal #14171B rounded square, drawn for WPScout (`store/source/logo.svg`; generator `store/icon-options/fresh/make-stack-icons.js`). The 16px version is hand-tuned.
- The name "WPScout" stays.

## Evidence on Hand
- Sample report data in `popup/popup.js` (`getSampleMockData`, nasa.gov).
- Chrome Web Store listing: 13 users, one 5★ rating. There are no testimonials and none should be invented.

## Product Principles
1. Answer "what is this built with" before showing how it was detected.
2. Every finding can show its evidence, but evidence stays one tap away.
3. Mark uncertainty only where it exists, and keep confirmed results quiet.
4. Never block on the network. Show cached results first and fill in the rest as it arrives.
