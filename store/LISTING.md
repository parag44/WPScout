# WPScout 2.2.0: Chrome Web Store update kit

Upload `dist/wpscout-2.2.0.zip` (build it with `./scripts/build.sh`).

## Assets in this folder

| File | Size | Store field |
|---|---|---|
| `store-icon-128.png` | 128 × 128, 96 px artwork, transparent padding | Store icon |
| `screenshot-1-overview.png` | 1280 × 800, 24-bit PNG | Screenshot 1 |
| `screenshot-2-plugins.png` | 1280 × 800 | Screenshot 2 |
| `screenshot-3-stack.png` | 1280 × 800 | Screenshot 3 |
| `screenshot-4-checks.png` | 1280 × 800 | Screenshot 4 |
| `screenshot-5-dark.png` | 1280 × 800 | Screenshot 5 |
| `promo-small-440x280.png` | 440 × 280 | Small promo tile |
| `promo-marquee-1400x560.png` | 1400 × 560 | Marquee promo tile |
| `source/*.svg` | | Icon sources: the logo, and active and greyed-out versions per size |
| `source/store-template/` | | Source for the screenshots and promo tiles (`store.html?v=s1` … `s5`, `small`, `marquee`) and the popup captures in `pop/` |

Social media images (not uploaded to the store):

| File | Size | Use |
|---|---|---|
| `social-showcase-1200x630.png` | 1200 × 630 (and `@2x`) | Link posts on X, LinkedIn, Facebook |
| `social-showcase-1080x1080.png` | 1080 × 1080 (and `@2x`) | Square feed posts |
| `social-banner-1200x630.png`, `social-banner-1080x1080.png` | (and `@2x`) | Text-only versions |

Sources are in `source/social/`.

The screenshots show a real scan of wordpress.org/news with version 2.1.0, taken on 2026-11-20. The usernames on the Checks screenshot are blurred on purpose. No vulnerability key was set, so the screenshots don't show vulnerability results.

## Summary (132 characters max)

This comes from `description` in `manifest.json`, so it ships inside the zip:

See how any WordPress site is built: version, theme, plugins and updates, hosting, tech stack, and security and SEO checks.

## Description

Paste this into the **Description** field on the Store listing tab. It avoids lists of product and brand names: the Web Store rejected an earlier version for keyword spam (violation "Yellow Argon").

WPScout shows how any WordPress site is built, in one click. Open it on a site to see the WordPress version, theme, plugins, hosting, tech stack, and a health check covering updates, plugin health, known vulnerabilities, security, performance and SEO.

It's built for WordPress developers and agencies reviewing a client or competitor site, and for SEO and marketing teams who want the theme and plugins fast.

━━━━━━━━━━━━━━━━━━━━

WHAT IT SHOWS

WordPress and theme
• Whether the site runs WordPress, with a confidence score backed by seven independent signals
• The WordPress version, with a note when a newer release is available
• The active theme, its version and author, and the parent theme for child themes
• The page builder and online store, when the site uses one

Plugins
• Plugins found in the page's files and in the site's REST API
• Version numbers where the page exposes them
• Plugins with an update available on WordPress.org, with a filter to list them
• Official plugin names and icons, search, category filters, and the evidence behind each find

Hosting and tech stack
• Hosting platform, web server, PHP version and CDN, when the site exposes them
• Live page-cache status and the cache that produced it
• Public IP address, network, location and nameservers
• Analytics and tag managers, with their tracking IDs
• Web fonts and JavaScript libraries
• Payment, chat, captcha and cookie-consent widgets
• Content: number of posts and pages, the latest post date, products, and multisite

Health checks
• Updates: WordPress, the theme and plugins compared with the latest releases
• Plugin health: plugins closed on WordPress.org, not updated in years, or not tested with recent WordPress versions
• Known vulnerabilities in the detected versions (optional, with your own API key from a supported vulnerability database). Each one shows its severity, CVE, the version that fixes it and a link to the full advisory
• Performance for your visit: server response, load time, page weight, requests, image formats, compression, cache policy and more
• Security: common exposures, such as publicly listed usernames or a public debug log, whether the login page is hidden, a security.txt contact, missing security headers, and PHP versions that no longer get security fixes
• SEO: title and description, indexing, social sharing tags, structured data, sitemap, robots.txt, llms.txt and ads.txt

━━━━━━━━━━━━━━━━━━━━

FAST AND LIGHT

• The toolbar icon shows how many plugins it found
• Results are cached per tab, so the popup opens instantly
• Health checks run only when you open the popup
• Rescan any time with one click

SHARE WHAT YOU FIND

• Copy a Markdown report
• Copy the plugin list
• Export the full report as JSON

DESIGN

• A compact popup with five tabs: Overview, Plugins, Stack, Checks and Evidence
• Light and dark themes that follow your system, or pick one from the menu

━━━━━━━━━━━━━━━━━━━━

PRIVACY

• No account, no sign-in, no analytics and no tracking. WPScout doesn't collect or sell any data.
• Requests to the site you're viewing are sent without your cookies, and login or one-time links are never requested again.
• To build a report, WPScout looks up the site's address with Google Public DNS, its IP location with ipwho.is, and plugin and theme details with WordPress.org. Nothing about you is sent.
• Vulnerability checks are off until you add a key. With a Wordfence key, the list is downloaded once a day and matched on your computer. With a WPScan key, plugin and theme names are sent to WPScan when you open the popup. Your keys stay in your browser.

━━━━━━━━━━━━━━━━━━━━

HOW TO USE

1. Open any website.
2. On WordPress sites, the WPScout icon shows the number of plugins it found.
3. Click the icon to see the stack, plugins and health checks.
4. Optional: add a vulnerability API key from the menu to check for known issues.
5. Copy or export the report when you need it.

## What's new in 2.2.0

• Site build: shows whether the site uses a block or classic theme, which translation plugin it uses (WPML, Polylang, TranslatePress, Weglot or GTranslate) and its languages
• WooCommerce stores: product count, currency and price range
• Login page: whether /wp-login.php is the default, hidden, moved or blocked
• llms.txt, ads.txt (with the ad networks listed) and security.txt
• Compression, cache policy, cached copy age and server timing in the Performance checks

## What's new in 2.1.0

• Plugin health: flags plugins closed on WordPress.org, not updated in two years, or not tested with the last three major WordPress releases. Each plugin also shows its last update, tested version, installs and rating
• Known vulnerabilities: optional checks with your own API key for Wordfence or WPScan. Results from both are combined, the same issue counts once, and each one opens to show its severity, CVE, fixed version and a link to the source
• PHP and WordPress support: flags PHP versions that no longer get security fixes, and WordPress installs several major versions behind
• Performance snapshot for your visit: server response, load time, page weight, requests, protocol, image formats, lazy loading and more
• Content stats: posts, pages, latest post and products, plus multisite detection
• Sites where WordPress lives in a subfolder are now checked at the right address

## Privacy practices (dashboard answers)

**Single purpose:** WPScout shows how the WordPress website you're viewing is built: its WordPress version, theme, plugins, hosting and tech stack, with health checks for that site's updates, known vulnerabilities, security, performance and SEO. Every feature serves this one purpose: inspecting the WordPress site in the current tab and reporting what it finds.

**Permission justifications** (paste each into its field on the Privacy practices tab)

activeTab:
Lets WPScout scan the current page when the user clicks the toolbar icon, on tabs that were already open before WPScout was installed or updated, where the content script isn't running yet. Access is limited to that tab and that click.

scripting:
Injects WPScout's own bundled detector into the active tab when its content script isn't running (for example, tabs opened before install). The detector reads the page's stylesheet and script URLs, meta tags and REST API link to identify WordPress, the theme and plugins. No remote code is run.

tabs:
Reads the URL of each tab so the toolbar badge (the number of plugins found) and the popup's report match the page the user is on, and update as they switch tabs or navigate.

storage:
Keeps each tab's scan result in session storage so the popup opens instantly (cleared when the browser closes), and saves the user's light or dark theme choice. If the user adds an optional vulnerability API key, it is saved in local storage on their computer.

Host permission:
Required hosts, used only to look up public information about the site being viewed:
1. api.wordpress.org: turns detected plugin and theme slugs into official names, latest versions and update status, and reads the latest WordPress version.
2. ps.w.org: loads plugin icons shown next to each detected plugin.
3. dns.google: resolves the site's hostname to its IP address and nameservers.
4. ipwho.is: looks up the network (hosting provider) and approximate location of that IP.

Optional hosts, requested only if the user adds their own API key in Settings, and removed when they remove it:
5. www.wordfence.com: downloads the known-vulnerability list at most once a day; matching happens locally.
6. wpscan.com: looks up known vulnerabilities for the detected plugins, theme and WordPress version.

No personal data, cookies or browsing history is sent to any of these hosts.

**Data use.** No user data is collected, and there is no analytics, account or tracking. To build a report, WPScout sends these requests:
- The **hostname** of a WordPress site you visit goes to Google Public DNS (`dns.google`) to resolve its IP address and nameservers.
- That **IP address** goes to `ipwho.is` to look up its network and location.
- **Plugin and theme slugs** go to `api.wordpress.org` for official names and icons.
- **Requests to the site you're viewing**, sent without cookies: the page itself (only its headers are read), `/wp-json`, and the theme's `style.css`.
- **Extra checks on the site you're viewing**, only when you open the popup, sent without cookies: `/xmlrpc.php`, `/wp-json/wp/v2/users`, `/readme.html`, `/wp-content/uploads/`, `/wp-content/debug.log`, `/robots.txt`, the sitemap paths, `/wp-login.php`, `/llms.txt`, `/ads.txt`, `/.well-known/security.txt`, and the REST API post, page and product counts and lowest and highest product prices.
- **The latest WordPress version** is read from `api.wordpress.org` (no site data is sent).
- **Only if the user adds a Wordfence key:** the known-vulnerability list is downloaded from `wordfence.com` at most once a day using that key. Matching happens locally; no site or browsing data is sent to Wordfence.
- **Only if the user adds a WPScan token:** plugin and theme slugs and the WordPress version are sent to `wpscan.com` when the popup opens. Plugin and theme versions are matched locally and results aren't stored.

The privacy policy on GitHub Gist should list these four. If it currently says that all inspection happens locally and nothing leaves the browser, update it before you submit.

## Notes for the update

- No new required permissions compared with 1.5.2, so Chrome won't disable WPScout or ask existing users to approve anything. The Wordfence and WPScan permissions are optional and requested only when a user adds that provider's key.
- The current listing says the icon "turns orange on WordPress sites". It's blue and shows the plugin count. Use the description above.

## Icon

The icon is an original stack: three layers, for the site's tech stack, in white on a charcoal rounded square. It was drawn for WPScout, so there's nothing to credit. Sources are in `store/source/`, and the generator is `store/icon-options/fresh/make-stack-icons.js`.
