# WPScout 🔍

> **Scout Any WordPress Website in Seconds.**
> A modern, developer-first Chrome extension (Manifest V3) for deep WordPress stack inspection, plugin discovery, server diagnostics, real-time caching analysis, and DNS resolution.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-v1.5.1-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/pnfcaepdbhbioeplilbgliegcnclpake?utm_source=parag.xyz)
[![Live Website](https://img.shields.io/badge/Website-parag.xyz%2FWPScout-0284c7?logo=safari&logoColor=white)](https://parag.xyz/WPScout/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![WPScout Preview](screenshot-1280x800.png)

---

## 🌐 Official Links

- **Chrome Web Store:** [Install WPScout Extension](https://chromewebstore.google.com/detail/pnfcaepdbhbioeplilbgliegcnclpake?utm_source=parag.xyz)
- **Official Landing Page:** [https://parag.xyz/WPScout/](https://parag.xyz/WPScout/)
- **Support Developer:** [Wise Support Link](https://wise.com/pay/r/dY07p1CL5kn91qw)

---

## 🚀 Overview

**WPScout** is a lightweight, non-intrusive, and comprehensive WordPress stack inspection and diagnostics extension designed for developers, site auditors, designers, agencies, and curious web enthusiasts.

With a single click, instantly uncover the entire technology stack powering any WordPress website—including core version, active theme and child-theme inheritance, detected plugins, hosting infrastructure, server software, live caching headers, and DNS details.

---

## ✨ Key Features

### 🔍 1. WordPress Core & Theme Intelligence
- Accurately detects whether any page is powered by WordPress.
- **Dynamic Toolbar Icon:** Automatically lights up in vibrant blue with a **live plugin count badge** on WordPress sites, and dims on non-WordPress sites.
- **Core Version Verification:** Compares the active site's version against the official WordPress.org release matrix.
- **Theme & Hierarchy:** Displays active theme name, version, author, child-theme parent relationships, and 4:3 screenshot previews.

### 🧩 2. Deep Plugin Discovery (Assets + REST API)
- **REST API Namespace Probing:** Queries `/wp-json` and `?rest_route=/` to discover active background plugins that don't load frontend scripts or CSS.
- **Confirmed Plugins First:** Plugins with confirmed version numbers are automatically sorted to the top.
- **High-Resolution Icons:** Fetches official WordPress.org CDN icons across PNG, SVG, WebP, and JPG formats, with smart fallbacks for premium plugins.
- **Live Search & Filter:** Instant search filter across detected plugins with direct links to official documentation.

### ⚡ 3. Real-Time HTTP Cache Inspection
- Inspects HTTP response headers (`cf-cache-status`, `x-litespeed-cache`, `x-cache`, `server-timing`, `cache-control`).
- Displays live status indicators: **`HIT`**, **`MISS`**, **`BYPASS`**, or **`DYNAMIC`**.
- Detects caching layers: Cloudflare, LiteSpeed Cache, WP Rocket, Varnish, Fastly, FastCGI.

### 🌐 4. Server, Hosting & Datacenter Resolution
- **Server Software:** Identifies Nginx, Apache, LiteSpeed, OpenLiteSpeed, Caddy, etc.
- **Managed Hosting Platforms:** Detects WP Engine, Kinsta, Cloudflare, Pantheon, Sucuri, and more.
- **PHP Runtime:** Displays exposed PHP version numbers.
- **Google DNS-over-HTTPS (DoH):** Resolves IPv4 Host IP (A record) and Authoritative Nameservers (NS records) securely without tracking.

### 🛡️ 5. 7-Signal Diagnostic Verification
Multi-vector verification checklist guarantees zero false positives:
1. `wp-json` REST API endpoint detected
2. `wp-json` in HTTP response `Link` header
3. WordPress generator meta tag
4. `/wp-content/` frontend script & style asset paths
5. `/wp-includes/` core scripts & block libraries
6. `link rel="https://api.w.org/"` DOM tags
7. Verified admin login & session indicators (`wp-login.php`, `#wpadminbar`)

### 📋 6. Developer Export Tools
- **One-Click Markdown:** Formatted diagnostic report ready to paste into bug trackers or GitHub issues.
- **Export JSON:** Full structured diagnostic JSON payload for client audits.
- **Download TXT:** Plain-text formatted report file.

### 🌓 7. UI/UX Polish & Dark/Light Mode
- Compact 420px non-wide layout fitting standard extension viewports.
- Automatic light/dark mode adaptation matching operating system settings.
- 100% client-side execution—no telemetry, no tracking, and no account required.

---

## 📁 Repository Structure

```text
WPScout/
├── extension/                       # Chrome Extension (Manifest V3 - v1.5.1)
│   ├── manifest.json                # Extension manifest configuration
│   ├── background.js                # Service worker for badges, tab awareness & session caching
│   ├── content.js                   # Fast passive inspection content script
│   ├── icons/                       # Extension action icons (16, 32, 48, 128)
│   ├── popup/                       # Popup dashboard (HTML, CSS, JS)
│   └── README.md                    # Extension documentation
│
├── website/                         # Official Landing Page (Live at parag.xyz/WPScout/)
│   ├── index.html                   # Responsive landing page with light/dark mode
│   ├── style.css                    # Modern developer-grade CSS design system
│   ├── script.js                    # Interactive demo simulator & gallery scripts
│   └── images/                      # Optimized screenshots, icons & banners
│
├── store-assets/                    # Chrome Web Store graphics & promotional assets
│   ├── promo-marquee-1400x560.png   # Store marquee banner
│   ├── promo-small-440x280.png      # Promo thumbnail
│   ├── screenshot-1-overview.png    # High-resolution store screenshots
│   └── store-icon-512x512.png       # 512x512 store icon
│
├── CHROMEWEBSTORE.md                # Chrome Web Store listing metadata & justifications
├── PRIVACY_POLICY.md                # Compliance privacy policy
└── README.md                        # Master repository documentation
```

---

## 🛠️ Installation & Development

### Method A: Install from Chrome Web Store (Recommended)
Install the official verified extension with automatic updates:
👉 **[Add WPScout to Chrome](https://chromewebstore.google.com/detail/pnfcaepdbhbioeplilbgliegcnclpake?utm_source=parag.xyz)**

### Method B: Load Unpacked in Developer Mode
1. Clone this repository:
   ```bash
   git clone https://github.com/parag44/WPScout.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension/` directory.
6. Pin **WPScout** to your Chrome toolbar!

---

## 🔒 Permissions & Privacy

WPScout is strictly committed to privacy and developer transparency:
- `activeTab` & `scripting`: Runs inspection scripts only on the currently active tab when the popup is accessed.
- `storage`: Caches pre-fetched results in browser session storage (`chrome.storage.session`) for instant rendering.
- `https://api.wordpress.org/*`: Verifies core version status against the official WordPress API.
- `https://dns.google/*`: Resolves domain A and NS records securely via Google DNS-over-HTTPS.

**100% Client-Side:** No browsing history is tracked, no personal data is collected, and no analytics or telemetry scripts are included.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Feel free to use, modify, and contribute!
