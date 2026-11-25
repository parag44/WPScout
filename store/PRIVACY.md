# WPScout Privacy Policy

**Effective date:** November 18, 2026
**Applies to:** WPScout – Scout Any WordPress Website (Chrome extension), version 2.1.0 and later

WPScout shows which WordPress version, theme, plugins and hosting a website uses. This policy explains what the extension reads, what it sends over the network to do that, and what it stores.

## The short version

- WPScout doesn't collect, sell or share your personal data, and doesn't send any of it to the developer.
- There are no accounts, analytics, ads or tracking.
- To build a report, WPScout looks up public information about the website you're viewing using a few public services, listed below.

## What WPScout reads

When you load a web page, WPScout's content script reads the page's source in your browser (stylesheets, scripts, meta tags and links) to tell whether the site runs WordPress. Pages that aren't WordPress are never sent anywhere.

WPScout doesn't read or store form inputs, passwords, cookies, your browsing history, or the text content of the pages you visit.

## What WPScout sends, and to whom

WPScout makes these requests only for sites it detects as WordPress, or when you open the popup:

| Sent to | What is sent | Why |
|---|---|---|
| **The website you're viewing** | Requests for the page itself (only the response headers are read), `/wp-json`, and the theme's `style.css`. These are sent **without your cookies** and skipped on login, password-reset and other one-time links. | To detect the WordPress version, REST API, server, cache and theme details. |
| **The website you're viewing, when you open the popup** | Requests for a few public paths: `/xmlrpc.php`, `/wp-json/wp/v2/users`, `/readme.html`, `/wp-content/uploads/`, `/wp-content/debug.log`, `/robots.txt`, the sitemap (`/wp-sitemap.xml`, `/sitemap_index.xml` or `/sitemap.xml`), `/wp-login.php`, `/llms.txt`, `/ads.txt`, `/.well-known/security.txt`, and the REST API's post, page and product counts and lowest and highest product prices. Sent **without your cookies**, and never on ordinary page views. | For the security and SEO checks on the Checks tab. |
| **Wordfence** (`www.wordfence.com`), **only if you add a Wordfence API key** | Your API key, to download Wordfence's list of known vulnerabilities at most once a day. Nothing about you or the sites you visit is sent; versions are matched on your computer. | For the optional known-vulnerability checks. |
| **WPScan** (`wpscan.com`), **only if you add a WPScan API token** | Your token, the slugs of the plugins and theme found on the site, and the WordPress version. Sent when you open the popup. Plugin and theme versions aren't sent; they're matched on your computer. Results aren't stored. | For the optional known-vulnerability checks. |
| **Google Public DNS** (`dns.google`) | The website's hostname, for example `www.example.com` | To find the site's IP address and nameservers. |
| **ipwho.is** | The website's IP address | To show the network or hosting provider and its approximate location. |
| **WordPress.org** (`api.wordpress.org`, `ps.w.org`) | Names (slugs) of the plugins and theme found on the site, and a request for the latest WordPress version | To show official names and icons, and whether updates are available. |

These services receive the request from your browser, so, as with any web request, they can also see your IP address. Their own privacy policies apply:

- Google Public DNS: https://developers.google.com/speed/public-dns/privacy
- ipwho.is: https://ipwho.is/
- WordPress.org: https://wordpress.org/about/privacy/

WPScout doesn't send anything about you, your account or your other tabs to any of these services.

## What WPScout stores

- **Scan results** for each open tab, kept in Chrome's session storage so the popup opens instantly. Chrome deletes them when you close the tab or the browser.
- **Cached lookups** (IP address and nameservers per site for up to 1 hour, and the site's REST API route list for up to 30 minutes), kept only in the extension's memory and cleared when the browser stops the extension's background worker.
- **Your theme choice** (light or dark), saved in the extension's local storage.
- **Welcome and review prompt state**: whether you've seen the welcome screen, how many times you've opened WPScout on a WordPress site, and your answer to the review prompt. Only the count is kept, not which sites, and it never leaves your browser.
- **Your vulnerability API keys** (Wordfence, WPScan), only the ones you add, saved in the extension's local storage, plus Wordfence's downloaded vulnerability list. Remove either key from **Vulnerability checks** in the menu.

Nothing is synced to your Google account, and nothing is stored on any server.

## Actions you take

- **Copy report**, **Copy plugin list** and **Copy** buttons write text to your clipboard only when you click them. WPScout never reads your clipboard.
- **Export JSON** saves a file to your computer. It isn't uploaded anywhere.
- **Support WPScout** opens an external payment page (wise.com) in a new tab. WPScout doesn't see or handle any payment details.

## Permissions

| Permission | Used for |
|---|---|
| `tabs` | Reading the current tab's address so the toolbar badge and report match the page you're on |
| `activeTab`, `scripting` | Scanning the current tab when you click the toolbar icon |
| `storage` | The session cache of scan results, your theme choice, and the welcome and review prompt state |
| Optional access to `www.wordfence.com` and `wpscan.com` | Asked for only when you add that provider's key, and removed when you remove it |
| Access to `api.wordpress.org`, `ps.w.org`, `dns.google` and `ipwho.is` | The lookups described above |
| Content script on all `http` and `https` pages | Detecting WordPress so the toolbar badge can show the plugin count |

## Children

WPScout isn't directed at children and doesn't knowingly process children's personal information.

## Changes

If WPScout's data practices change, this policy will be updated and the effective date above will change.

## Contact

Questions about this policy: **[your contact email or GitHub profile]**
