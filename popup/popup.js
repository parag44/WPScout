// ==========================================================================
// WPScout popup controller
// Reads the cached report for the active tab (or asks the content script to
// rescan), enriches it with DNS / ISP / WordPress.org data, and renders the
// four-tab popup: Overview, Plugins, Hosting, Evidence.
// The fallback detector `detectWordPress` lives in detect.js.
// ==========================================================================

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const hasChrome = typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query;
  const APP_VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return ''; } })();

  let report = null;          // current WordPress report
  let currentTab = null;      // chrome tab object
  let activeCat = 'All';
  let fromCache = false;

  // ------------------------------------------------------------------ icons
  const ICON = {
    chev: '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    check: '<svg class="ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-width="1.6"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
    miss: '<svg class="ck no" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
    ext: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };

  // ------------------------------------------------------------------ utils
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const decode = (s) => String(s || '').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  const known = (v) => v && v !== 'Unknown' && v !== 'None Detected' && v !== 'None';
  const stripFlag = (s) => String(s || '').replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '');
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; } };
  const monogram = (name) => {
    const words = String(name || '?').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(Boolean);
    return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
  };

  function fetchWithTimeout(resource, options = {}, timeout = 3000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  function openUrl(url) {
    // Only open web pages: URLs built from scanned page data must never become javascript: or chrome: links.
    try { if (!/^https?:$/.test(new URL(url).protocol)) return; } catch (e) { return; }
    if (hasChrome && chrome.tabs.create) chrome.tabs.create({ url });
    else window.open(url, '_blank', 'noopener');
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch (e) {
      toast('Couldn’t copy. Your browser blocked clipboard access.');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------------ theme
  const THEME_KEY = 'wpscout_theme';
  function storedTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark') return v;
      const legacy = localStorage.getItem('wp_detector_theme');
      if (legacy === 'theme-light' || legacy === 'theme-dark') return legacy.replace('theme-', '');
    } catch (e) {}
    return null;
  }
  function effectiveDark() {
    const a = document.documentElement.getAttribute('data-theme');
    return a ? a === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeLabel() { $('theme-label').textContent = effectiveDark() ? 'Light theme' : 'Dark theme'; }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    syncThemeLabel();
  }
  function toggleTheme() {
    const next = effectiveDark() ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  }

  // ------------------------------------------------------------------ network enrichment
  async function getHostIP(hostname) {
    try {
      const res = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {}, 3000);
      const data = await res.json();
      if (data.Answer && data.Answer.length) return data.Answer.map((a) => a.data).find((ip) => /^[0-9.]+$/.test(ip)) || 'Unknown';
    } catch (e) {}
    return 'Unknown';
  }

  async function getNameservers(hostname) {
    try {
      const parts = hostname.split('.');
      const apex = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
      const res = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(apex)}&type=NS`, {}, 3000);
      const data = await res.json();
      if (data.Answer && data.Answer.length) return data.Answer.map((a) => a.data.replace(/\.$/, '')).slice(0, 2).join(', ');
    } catch (e) {}
    return 'Unknown';
  }

  async function getISPAndLocation(ip) {
    if (!ip || ip === 'Unknown' || ip.startsWith('127.') || ip === 'localhost') return { isp: 'Localhost / private', location: 'Internal network' };
    try {
      const res = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, {}, 3000);
      const data = await res.json();
      if (data && data.success) {
        return {
          isp: (data.connection && data.connection.isp) || 'Unknown',
          location: [data.city, data.region, data.country_code].filter(Boolean).join(', ') || 'Unknown'
        };
      }
    } catch (e) {}
    return { isp: 'Unknown', location: 'Unknown' };
  }

  async function enrichNetwork(data) {
    const host = new URL(data.url).hostname;
    data.hostname = host;
    const [ip, ns] = await Promise.all([getHostIP(host), getNameservers(host)]);
    data.ip = ip;
    data.dns = ns;
    const geo = await getISPAndLocation(ip);
    data.isp = geo.isp;
    data.location = geo.location;
    return data;
  }

  // ------------------------------------------------------------------ WordPress.org metadata
  function deriveProPluginTitle(rawBaseName, proSlug) {
    let name = decode(rawBaseName).trim();
    const m = name.match(/^(.+?)\s*(?:[–—]| - | : |: | \| )\s*(.+)$/);
    if (m && m[1].trim().length >= 2) name = m[1].trim();
    name = name.replace(/\s*\((?:acf|free|lite)\)/i, '')
      .replace(/\s+(?:website builder|page builder|builder|customizer framework|wordpress plugin|plugin for wordpress|framework)$/i, '')
      .trim();
    const p = proSlug.toLowerCase();
    const edition = p.endsWith('-premium') ? 'Premium'
      : /-addons?$/.test(p) ? 'Addons'
      : /-extensions?$/.test(p) ? 'Extensions'
      : p.endsWith('-plus') ? 'Plus'
      : p.endsWith('-unlimited') ? 'Unlimited'
      : p.endsWith('-core') ? 'Core' : 'Pro';
    return name.toLowerCase().endsWith(edition.toLowerCase()) ? name : `${name} ${edition}`;
  }

  // Plugin names are often "Brand – long marketing tagline". Keep the brand.
  function shortName(name) {
    const n = decode(name).trim();
    const m = n.match(/^(.{3,40}?)\s+(?:[–—]|-|:|\|)\s+.{8,}$/);
    return m ? m[1].trim() : n;
  }

  const pluginMetaCache = new Map();
  function fetchPluginMeta(slug) {
    const clean = (slug || '').toLowerCase().trim();
    if (!clean) return Promise.resolve(null);
    if (pluginMetaCache.has(clean)) return pluginMetaCache.get(clean);
    const job = (async () => {
      const base = clean.replace(/-(?:pro|premium|addon|addons|extension|extensions|plugin|core|config|lite|master|plus|unlimited)$/i, '');
      const tries = base && base !== clean ? [clean, base] : [clean];
      for (const s of tries) {
        try {
          const res = await fetch(`https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(s)}&request[fields][icons]=1&request[fields][active_installs]=1&request[fields][sections]=0`, { cache: 'force-cache' });
          const data = await res.json().catch(() => null);
          // Closed plugins answer with an error but still carry name, date and reason.
          if (data && data.error === 'closed' && s === clean) {
            return { name: decode(data.name || ''), iconUrl: null, wpOrgSlug: s, isPro: false, latest: '',
              health: { closed: true, closedDate: data.closed_date || '', closedReason: data.reason_text || data.reason || '' } };
          }
          if (!res.ok || !data || !(data.name || data.icons)) continue;
          const isPro = s !== clean;
          const icon = data.icons ? (data.icons['2x'] || data.icons['1x'] || data.icons.svg || data.icons.default) : null;
          return {
            name: data.name ? (isPro ? deriveProPluginTitle(data.name, clean) : decode(data.name)) : '',
            iconUrl: icon ? icon.replace(/^http:\/\//i, 'https://') : null,
            wpOrgSlug: s,
            isPro,
            latest: isPro ? '' : String(data.version || ''),
            // Plugin health from the same response (no extra requests). Only for the exact slug.
            health: isPro ? null : {
              closed: false,
              lastUpdated: String(data.last_updated || '').replace(/\s.*$/, ''),
              tested: String(data.tested || ''),
              requiresPhp: String(data.requires_php || ''),
              activeInstalls: Number(data.active_installs || 0),
              rating: Number(data.rating || 0),
              numRatings: Number(data.num_ratings || 0)
            }
          };
        } catch (e) {}
      }
      return null;
    })();
    pluginMetaCache.set(clean, job);
    return job;
  }

  // Chrome shows the popup only after its load event, and every <img> request
  // started before then holds that event back. So icons (and the favicon) wait
  // for load, and come from the WordPress.org API instead of guessing CDN URLs.
  const popupLoaded = new Promise((resolve) => {
    const done = () => requestAnimationFrame(() => resolve());
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
  });

  const iconCache = new Map();
  function resolvePluginIcon(slug) {
    const clean = (slug || '').toLowerCase().trim();
    if (!iconCache.has(clean)) {
      iconCache.set(clean, fetchPluginMeta(clean).then((meta) => (meta && meta.iconUrl) || null).catch(() => null));
    }
    return iconCache.get(clean).then((url) => popupLoaded.then(() => url));
  }

  function formatThemeName(slug) {
    if (!known(slug)) return 'Unknown';
    const clean = slug.toLowerCase().trim();
    const names = {
      twentytwentyfive: 'Twenty Twenty-Five', twentytwentyfour: 'Twenty Twenty-Four', twentytwentythree: 'Twenty Twenty-Three',
      twentytwentytwo: 'Twenty Twenty-Two', twentytwentyone: 'Twenty Twenty-One', twentytwenty: 'Twenty Twenty',
      twentynineteen: 'Twenty Nineteen', twentyseventeen: 'Twenty Seventeen', twentysixteen: 'Twenty Sixteen',
      astra: 'Astra', generatepress: 'GeneratePress', 'hello-elementor': 'Hello Elementor', kadence: 'Kadence',
      oceanwp: 'OceanWP', neve: 'Neve', blocksy: 'Blocksy', flatsome: 'Flatsome', divi: 'Divi'
    };
    return names[clean] || clean.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const themeMetaCache = new Map();
  function fetchThemeMeta(slug) {
    const clean = (slug || '').toLowerCase().trim();
    if (!known(clean)) return Promise.resolve(null);
    if (themeMetaCache.has(clean)) return themeMetaCache.get(clean);
    const job = (async () => {
      try {
        const res = await fetch(`https://api.wordpress.org/themes/info/1.2/?action=theme_information&request[slug]=${encodeURIComponent(clean)}`, { cache: 'force-cache' });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.name) return null;
        let author = '';
        if (data.author && typeof data.author === 'object') author = data.author.display_name || data.author.author || data.author.user_nicename || '';
        else if (typeof data.author === 'string') author = data.author.replace(/<[^>]+>/g, '').trim();
        return { name: decode(data.name), version: data.version || '', author };
      } catch (e) { return null; }
    })();
    themeMetaCache.set(clean, job);
    return job;
  }

  // ------------------------------------------------------------------ plugin helpers
  const SOURCE_LABEL = { API: 'REST API', URL: 'Asset URL', HEADER: 'HTTP header', DOM: 'Page source' };
  function hasVersion(p) {
    const v = String((p && p.version) || '').trim();
    // Real versions start with a digit and are short ("5.9.5", "6.2.0.1", "2.0-beta").
    // Cache-busting hashes passed as ?ver= ("ecf94842061bea03d54b") are not versions.
    return /^\d[\w.+-]{0,19}$/.test(v) && !/^\d{9,}$/.test(v) && !/^[0-9a-f]{12,}$/i.test(v);
  }
  const pluginName = (p) => shortName(p.displayName || p.name || p.slug);
  function sortedPlugins(list) {
    return [...list].sort((a, b) => (hasVersion(b) - hasVersion(a)) || pluginName(a).localeCompare(pluginName(b)));
  }

  const METHOD_LABEL = {
    'Frontend Asset': 'a plugin file the page loads',
    'Inline Script Data (wp_localize_script)': 'inline script data (wp_localize_script)',
    'Inlined CSS Asset': 'inline CSS',
    'Block Asset Handle': 'a block stylesheet handle',
    'Integration Signature': 'an integration script on the page',
    'HTTP Cache Header': 'an HTTP cache header',
    'HTML Comment Signature': 'an HTML comment',
    'REST API Namespace': 'the REST API namespace list',
    'REST API Sub-route': 'a REST API route'
  };
  const methodLabel = (m) => METHOD_LABEL[m] || m;

  function pluginRowHTML(p) {
    const ver = p.latest ? verArrow(p.version, p.latest) : hasVersion(p) ? `<span class="pver">${esc(p.version)}</span>` : '<span class="pver unk">Version unknown</span>';
    const wpSlug = p.wpOrgSlug || p.slug;
    return `<li class="pl" data-slug="${esc(p.slug)}">
      <button class="pl-main" type="button" aria-expanded="false">
        <span class="pico" aria-hidden="true">${esc(monogram(pluginName(p)))}</span>
        <span class="ptext"><span class="pname">${esc(pluginName(p))}</span><span class="pmeta">${esc(p.category || 'Plugin')} · ${esc(SOURCE_LABEL[p.sourceTag] || p.sourceTag || 'Detected')}${(() => { const i = report && pluginIssue(p); return i ? ` · <span class="pflag ${i.cls}">${esc(i.short)}</span>` : ''; })()}</span></span>
        ${ver}
      </button>
      <div class="reveal"><div><div class="pdetail">
        ${p.evidence ? `<div class="evid">${esc(p.evidence)}</div>` : ''}
        ${p.method ? `<div class="method">Found in ${esc(methodLabel(p.method))}</div>` : ''}
        ${p.health && healthTrusted(p) ? `<div class="method phealth">${esc(healthLine(p))}</div>` : ''}
        <div class="inline-actions">
          <button class="btn sm" type="button" data-open="https://wordpress.org/plugins/${encodeURIComponent(wpSlug)}/">${ICON.ext}WordPress.org</button>
          <button class="btn sm" type="button" data-copy="${esc(p.slug)}" data-copy-msg="Slug copied: ${esc(p.slug)}">${ICON.copy}Copy slug</button>
        </div>
      </div></div></div>
    </li>`;
  }

  // Swap in real icons and official names once they resolve.
  function hydratePlugins(container) {
    container.querySelectorAll('.pl[data-slug]').forEach((li) => {
      const slug = li.dataset.slug;
      const p = report && report.plugins.find((x) => x.slug === slug);
      resolvePluginIcon(slug).then((url) => {
        if (!url || !li.isConnected) return;
        const box = li.querySelector('.pico');
        if (box.querySelector('img')) return;
        const img = new Image();
        img.alt = '';
        img.onload = () => box.appendChild(img);
        img.src = url;
      });
      fetchPluginMeta(slug).then((meta) => {
        if (!meta || !p) return;
        if (meta.name && !p.displayName) p.displayName = meta.name;
        if (meta.wpOrgSlug) p.wpOrgSlug = meta.wpOrgSlug;
        if (!li.isConnected) return;
        const nameEl = li.querySelector('.pname');
        if (nameEl) nameEl.textContent = pluginName(p);
        const link = li.querySelector('[data-open*="wordpress.org/plugins/"]');
        if (link && meta.wpOrgSlug) link.dataset.open = `https://wordpress.org/plugins/${encodeURIComponent(meta.wpOrgSlug)}/`;
      });
    });
  }

  // ------------------------------------------------------------------ view switching
  const PANES = ['overview', 'plugins', 'hosting', 'checks', 'evidence'];

  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden = name !== 'empty';
    $('pane-settings').hidden = true;
    $('tabs').hidden = name !== 'report';
    PANES.forEach((k) => { $('pane-' + k).hidden = true; });
    const ready = name === 'report';
    $('copy-btn').disabled = !ready;
    document.querySelectorAll('#menu [data-action="copy-plugins"], #menu [data-action="export-json"]').forEach((b) => { b.disabled = !ready; });
    $('rescan-btn').classList.toggle('spinning', name === 'loading');
    $('rescan-btn').disabled = name === 'loading';
  }

  function selectTab(key, focus) {
    if (!PANES.includes(key)) key = 'overview';
    document.querySelectorAll('.pp-tab').forEach((t) => {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    PANES.forEach((k) => { $('pane-' + k).hidden = k !== key; });
    $('pane-settings').hidden = true;
    $('body').scrollTop = 0;
    placeInk();
    if (key === 'plugins' && focus === 'search') setTimeout(() => $('plugin-search').focus(), 30);
  }

  function placeInk() {
    const t = document.querySelector('.pp-tab[aria-selected="true"]');
    const ink = $('tab-ink');
    if (!t || $('tabs').hidden) return;
    ink.style.width = `${t.offsetWidth - 16}px`;
    ink.style.transform = `translateX(${t.offsetLeft + 8}px)`;
  }

  function setSiteIcon(src, label, muted) {
    const box = $('site-ico'), img = $('site-favicon');
    $('site-mono').textContent = (String(label || '?').replace(/^www\./, '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    box.classList.toggle('muted', !!muted);
    box.classList.remove('has-img');
    img.hidden = true;
    if (!src) return;
    const token = (setSiteIcon.token = (setSiteIcon.token || 0) + 1);
    popupLoaded.then(() => { if (token === setSiteIcon.token) img.src = src; });
    img.onload = () => { if (img.naturalWidth > 1) { img.hidden = false; box.classList.add('has-img'); } };
    img.onerror = () => { img.hidden = true; box.classList.remove('has-img'); };
  }

  function faviconFor(tab, data) {
    if (tab && tab.favIconUrl && !tab.favIconUrl.startsWith('chrome')) return tab.favIconUrl;
    if (data && data.faviconUrl) return data.faviconUrl;
    return null;
  }

  // ------------------------------------------------------------------ render: loading / empty
  function renderLoading(tab) {
    const host = tab ? hostOf(tab.url) : '';
    $('site-name').textContent = host || 'Scanning…';
    $('site-sub').innerHTML = '<span class="sk" style="width:150px;height:9px"></span>';
    setSiteIcon(faviconFor(tab), host || 'W', true);
    $('foot-when').textContent = 'Reading page signals and REST API…';
    showState('loading');
  }

  function renderEmpty(kind, tab, message) {
    const host = tab ? hostOf(tab.url) : '';
    const internal = kind === 'internal';
    $('site-name').textContent = internal ? (tab && tab.title) || 'Browser page' : host || 'This page';
    $('site-sub').innerHTML = `<span class="dot off"></span>${internal ? 'Browser page' : kind === 'error' ? 'Scan incomplete' : 'Not WordPress'}`;
    setSiteIcon(internal ? null : faviconFor(tab), internal ? 'C' : host || '?', true);

    const copy = {
      nowp: ['This site doesn’t look like WordPress', 'None of the seven signals matched. Sites with a headless front end or a strict firewall can hide WordPress, so try rescanning once the page has fully loaded.'],
      internal: ['Browser pages can’t be scanned', 'Chrome doesn’t let extensions read chrome:// pages, the Web Store, or other built-in pages. Open a website and click WPScout again.'],
      error: ['The scan didn’t finish', message || 'The page didn’t answer in time. Reload it, then rescan.'],
      reload: ['Reload this tab to scan it', 'This tab was open before WPScout was installed or updated, so Chrome hasn’t given WPScout access to it yet. Reloading the page fixes that.']
    }[kind];
    $('empty-title').textContent = copy[0];
    $('empty-desc').textContent = copy[1];
    $('empty-checked').hidden = kind !== 'nowp';
    $('empty-rescan').hidden = internal || kind === 'reload';
    $('empty-reload').hidden = kind !== 'reload';
    $('rescan-btn').disabled = internal;
    $('foot-when').textContent = internal ? 'Nothing to scan on this page' : 'Last scan found no WordPress signals';
    if (kind === 'error' || kind === 'reload') $('foot-when').textContent = 'Scan incomplete';
    showState('empty');
    if (internal) $('rescan-btn').disabled = true;
  }

  // ------------------------------------------------------------------ render: report
  function renderReport(data, opts = {}) {
    report = data;
    const host = hostOf(data.url);
    $('site-name').textContent = host;
    $('site-name').title = data.url;
    renderSiteSub();
    setSiteIcon(faviconFor(currentTab, data), host, false);

    $('tab-plugins-count').textContent = data.plugins.length || '';
    $('tab-evidence-count').textContent = `${data.signalScore || 0}/7`;

    updatesPending = true;
    renderOverview();
    renderPlugins();
    renderHosting();
    renderChecks();
    renderEvidence();
    vuln = { loaded: false, status: null, results: {} };
    checkUpdates().then(runVulnLookup);

    const pending = !known(data.ip) && data.ip !== 'Unknown';
    $('foot-when').textContent = pending ? 'Looking up DNS and host…' : fromCache ? 'Cached result for this tab' : 'Scanned just now';
    showState('report');
    selectTab(opts.tab || 'overview');
  }

  function themeInfo() {
    const d = report;
    return {
      slug: d.theme,
      name: d.themeName || d._wpTheme?.name || formatThemeName(d.theme),
      version: d.themeVersion || d._wpTheme?.version || '',
      author: d.themeAuthor || d._wpTheme?.author || '',
      listed: d._wpTheme === undefined ? null : !!d._wpTheme,
      child: !!d.isChildTheme,
      parent: d.parentTheme || ''
    };
  }

  // The theme's own header file. (themeStylesheet from the scan is just the first theme
  // asset the page loaded, which can be an image or a bundled CSS file.)
  function styleCssUrl() {
    const origin = report.origin || new URL(report.url).origin;
    return `${origin}/wp-content/themes/${encodeURIComponent(report.theme)}/style.css`;
  }

  function renderOverview() {
    const d = report;
    const rows = [];
    const t = themeInfo();

    if (known(d.theme)) {
      const tag = t.child ? `<span class="tag">Parent theme: ${esc(formatThemeName(t.parent))}</span>`
        : t.listed === true ? '<span class="tag">WordPress.org</span>'
        : t.listed === false ? '<span class="tag">Custom</span>' : '';
      rows.push(`<div class="row clickable" role="button" tabindex="0" aria-expanded="false" data-reveal>
        <dt>Theme</dt><dd><span class="v">${esc(t.name)}</span>${themeLatest() ? verArrow(t.version, themeLatest()) : t.version ? `<span class="num">${esc(t.version)}</span>` : ''}${tag}</dd>${ICON.chev}
      </div>
      <div class="reveal"><div><div class="theme-card">
        <div class="kv">
          <span>Slug</span><span class="mono">${esc(t.slug)}</span>
          ${t.author ? `<span>Author</span><span>${esc(t.author)}</span>` : ''}
          ${t.child ? `<span>Parent</span><span class="mono">${esc(t.parent)}</span>` : ''}
          <span>Stylesheet</span><span class="mono">/wp-content/themes/${esc(t.slug)}/style.css</span>
          <span>Directory</span><span>${t.listed === true ? 'Listed on WordPress.org' : t.listed === false ? 'Not listed on WordPress.org' : 'Checking…'}</span>
        </div>
        <div class="inline-actions">
          <button class="btn sm" type="button" data-action="copy-theme">${ICON.copy}Copy</button>
          ${t.listed === true ? `<button class="btn sm" type="button" data-open="https://wordpress.org/themes/${encodeURIComponent(t.slug)}/">${ICON.ext}WordPress.org</button>` : ''}
          <button class="btn sm" type="button" data-open="${esc(styleCssUrl())}">${ICON.ext}style.css</button>
        </div>
      </div></div></div>`);
    } else {
      rows.push('<div class="row"><dt>Theme</dt><dd><span class="aux">Not detected</span></dd><span></span></div>');
    }

    const pb = String(d.pageBuilder || '');
    const pbMatch = pb.match(/^(.+?)\s*\((.+)\)$/);
    rows.push(`<div class="row"><dt>Builder</dt><dd>${known(pb) && pb !== 'None Detected'
      ? `<span class="v">${esc(pbMatch ? pbMatch[1] : pb)}</span>${pbMatch ? `<span class="aux">${esc(pbMatch[2].charAt(0) + pbMatch[2].slice(1).toLowerCase())}</span>` : ''}`
      : '<span class="aux">None detected</span>'}</dd><span></span></div>`);

    rows.push(`<div class="row clickable" role="button" tabindex="0" data-goto="hosting"><dt>Hosting</dt><dd>${hostingSummaryHTML()}</dd>${ICON.chev}</div>`);
    rows.push(`<div class="row"><dt>Cache</dt><dd>${cacheHTML(false)}</dd><span></span></div>`);
    rows.push(`<div class="row"><dt>PHP</dt><dd>${phpHTML()}</dd><span></span></div>`);
    rows.push(`<div class="row"><dt>Server</dt><dd>${serverHTML()}</dd><span></span></div>`);
    if (known(d.ecommerce)) rows.push(`<div class="row"><dt>Store</dt><dd><span class="v">${esc(d.ecommerce)}</span></dd><span></span></div>`);

    rows.unshift(healthRowHTML());
    $('stack-rows').innerHTML = rows.join('');

    const list = sortedPlugins(d.plugins);
    $('ov-plugins-h').textContent = list.length ? `Plugins · ${list.length}` : 'Plugins';
    const ov = $('ov-plugins');
    ov.innerHTML = list.length
      ? list.slice(0, 5).map(pluginRowHTML).join('')
      : '<li class="empty-list">No plugins exposed their assets on this page.</li>';
    ov.parentElement.querySelector('[data-goto="plugins"]').hidden = list.length <= 5;
    hydratePlugins(ov);
  }

  function hostingSummaryHTML() {
    const d = report;
    if (known(d.hostingPlatform)) return `<span class="v">${esc(d.hostingPlatform)}</span>`;
    if (known(d.proxyCDN)) return `<span class="v">${esc(d.proxyCDN)}</span>`;
    if (known(d.isp)) return `<span class="v">${esc(d.isp)}</span>`;
    if (d.isp === undefined) return '<span class="sk" style="width:120px"></span>';
    return '<span class="aux">Not identified</span>';
  }
  function cacheHTML(full) {
    const d = report;
    const status = d.cacheHeaderStatus, system = d.cacheSystem;
    if (!known(status) && !known(system)) return '<span class="aux">Not detected</span>';
    const cls = status === 'HIT' ? 'ok' : (status === 'BYPASS' || status === 'MISS' || status === 'EXPIRED') ? 'warn' : '';
    const label = known(status) ? status : 'Active';
    const aux = full && d.cacheDetail ? `<span class="num">${esc(d.cacheDetail)}</span>` : known(system) ? `<span class="aux">${esc(system)}</span>` : '';
    return `<span class="tag ${cls}">${esc(label)}</span>${aux}`;
  }
  function phpHTML() {
    const v = report.phpVersion;
    return known(v) ? `<span class="num strong">${esc(v.replace(/^PHP\//i, ''))}</span>` : '<span class="aux">Not exposed</span>';
  }
  function serverHTML() {
    const s = report.serverSoftware;
    if (!known(s)) return '<span class="aux">Not exposed</span>';
    const m = s.match(/^([^/\s]+)\/(\S+)$/);
    return m ? `<span class="v">${esc(m[1])}</span><span class="num">${esc(m[2])}</span>` : `<span class="v">${esc(s)}</span>`;
  }

  function renderPlugins() {
    const d = report;
    const cats = {};
    d.plugins.forEach((p) => { const c = p.category || 'Plugin'; cats[c] = (cats[c] || 0) + 1; });
    const outdated = d.plugins.filter((p) => p.latest).length;
    const catList = [['All', d.plugins.length], ...(outdated ? [['Outdated', outdated]] : []), ...Object.entries(cats).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))];
    if (!catList.some(([c]) => c === activeCat)) activeCat = 'All';
    $('chips').innerHTML = catList.length > 2 || outdated
      ? catList.map(([c, n]) => `<button class="chip${c === 'Outdated' ? ' chip-warn' : ''}" type="button" data-cat="${esc(c)}" aria-pressed="${c === activeCat}">${esc(c)}<span class="c">${n}</span></button>`).join('')
      : '';
    $('plugin-search').placeholder = `Search ${d.plugins.length} plugin${d.plugins.length === 1 ? '' : 's'}`;
    renderPluginList();
  }

  function renderPluginList() {
    const d = report;
    const term = $('plugin-search').value.trim().toLowerCase();
    const match = (p) => (activeCat === 'All' || (activeCat === 'Outdated' ? !!p.latest : (p.category || 'Plugin') === activeCat))
      && (!term || pluginName(p).toLowerCase().includes(term) || p.slug.toLowerCase().includes(term) || (p.category || '').toLowerCase().includes(term));
    const all = sortedPlugins(d.plugins).filter(match);
    const withVer = all.filter(hasVersion), noVer = all.filter((p) => !hasVersion(p));
    const el = $('plugins-list');

    if (!d.plugins.length) {
      el.innerHTML = '<div class="empty-list">No plugins exposed their assets on this page.<br>Some sites bundle or hide plugin files.</div>';
      return;
    }
    if (!all.length) {
      el.innerHTML = `<div class="empty-list">No plugins match “${esc($('plugin-search').value)}”.<button class="link" type="button" data-action="clear-search">Clear search</button></div>`;
      return;
    }
    el.innerHTML =
      (withVer.length ? `<ul class="plist">${withVer.map(pluginRowHTML).join('')}</ul>` : '') +
      (noVer.length ? `<div class="subh"><span>Version unknown</span><span>${noVer.length}</span></div><ul class="plist">${noVer.map(pluginRowHTML).join('')}</ul>` : '');
    hydratePlugins(el);
  }

  function renderHosting() {
    const d = report;
    const pending = d.ip === undefined || d.isp === undefined;
    const sk = (w) => `<span class="sk" style="width:${w}px"></span>`;
    const val = (v, fallback = 'Unknown') => known(v) ? `<span class="v">${esc(v)}</span>` : `<span class="aux">${fallback}</span>`;
    const https = (d.protocol || (d.url || '').slice(0, 6)).startsWith('https');
    const ns = known(d.dns) ? d.dns.split(/,\s*/) : [];

    $('pane-hosting').innerHTML = `
      <div class="grp">
        <div class="grp-h"><h2>Host</h2></div>
        <dl class="rows">
          <div class="row"><dt>Platform</dt><dd>${known(d.hostingPlatform) ? val(d.hostingPlatform) : '<span class="aux">Not identified</span>'}</dd><span></span></div>
          <div class="row"><dt>Network</dt><dd>${pending ? sk(110) : val(d.isp)}</dd><span></span></div>
          <div class="row"><dt>Location</dt><dd>${pending ? sk(150) : val(stripFlag(d.location))}</dd><span></span></div>
        </dl>
      </div>
      <div class="grp">
        <div class="grp-h"><h2>Server</h2></div>
        <dl class="rows">
          <div class="row"><dt>Web server</dt><dd>${serverHTML()}</dd><span></span></div>
          <div class="row"><dt>PHP</dt><dd>${phpHTML()}</dd><span></span></div>
          <div class="row"><dt>CDN / edge</dt><dd>${val(d.proxyCDN, 'None detected')}</dd><span></span></div>
          <div class="row"><dt>Page cache</dt><dd>${cacheHTML(true)}</dd><span></span></div>
          <div class="row"><dt>HTTPS</dt><dd>${https ? `<span class="tag ok">${ICON.lock}Secure</span>` : '<span class="tag warn">Not secure</span>'}</dd><span></span></div>
        </dl>
      </div>
      <div class="grp">
        <div class="grp-h"><h2>DNS</h2></div>
        <dl class="rows">
          <div class="row"><dt>IPv4</dt><dd>${pending ? sk(100) : known(d.ip) ? `<span class="num strong">${esc(d.ip)}</span>` : '<span class="aux">Unknown</span>'}</dd>${known(d.ip) ? `<button class="copy" type="button" aria-label="Copy IP address" data-copy="${esc(d.ip)}" data-copy-msg="IP address copied">${ICON.copy}</button>` : '<span></span>'}</div>
          <div class="row"><dt>Nameservers</dt><dd>${pending ? sk(130) : ns.length ? `<span class="stack">${ns.map((n) => `<span class="num strong">${esc(n)}</span>`).join('')}</span>` : '<span class="aux">Unknown</span>'}</dd>${ns.length ? `<button class="copy" type="button" aria-label="Copy nameservers" data-copy="${esc(ns.join('\n'))}" data-copy-msg="Nameservers copied">${ICON.copy}</button>` : '<span></span>'}</div>
        </dl>
      </div>${siteHTML()}${storeHTML()}${contentHTML()}${techHTML()}`;
  }

  // ---- Site build: theme type and languages (from the scan)
  let langNames = null;
  try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) {}
  const langName = (code) => { try { return (langNames && langNames.of(code)) || code; } catch (e) { return code; } };
  function siteHTML() {
    const d = report, tt = d.themeType, lg = d.languages;
    if (tt === undefined && lg === undefined) return '';
    const rows = [];
    if (tt) {
      const label = tt.type === 'block' ? 'Block theme' : 'Classic theme';
      rows.push(`<div class="row" title="${esc(tt.evidence)}"><dt>Theme type</dt><dd><span class="v">${label}</span>${tt.type === 'classic' && tt.themeJson ? '<span class="aux">uses theme.json</span>' : tt.type === 'block' ? '<span class="aux">Site Editor</span>' : ''}</dd><span></span></div>`);
    }
    if (lg) {
      const codes = lg.hreflang || [];
      rows.push(`<div class="row"><dt>Translation</dt><dd>${lg.plugin ? `<span class="v">${esc(lg.plugin)}</span>` : codes.length > 1 ? '<span class="aux">Plugin not identified</span>' : '<span class="aux">None detected</span>'}</dd><span></span></div>`);
      const shown = codes.length > 1 ? codes : lg.lang ? [lg.lang] : [];
      const names = [...new Set(shown.map(langName))];
      const list = names.slice(0, 6).join(', ') + (names.length > 6 ? ` +${names.length - 6}` : '');
      rows.push(`<div class="row" title="${esc(shown.join(', '))}"><dt>Language${names.length === 1 ? '' : 's'}</dt><dd>${names.length ? `${codes.length > 1 ? `<span class="v">${names.length}</span>` : ''}<span class="${codes.length > 1 ? 'aux' : 'v'} clip">${esc(list)}</span>` : '<span class="aux">Not set</span>'}</dd><span></span></div>`);
    }
    return `<div class="grp"><div class="grp-h"><h2>Site</h2></div><dl class="rows">${rows.join('')}</dl></div>`;
  }

  // ---- WooCommerce store details (from the popup-time Store API check)
  function fmtMoney(s, v) {
    if (v === null || v === undefined) return '';
    if (v === 0) return 'Free';
    const n = v.toLocaleString('en', { minimumFractionDigits: s.minor ? Math.min(s.minor, 2) : 0, maximumFractionDigits: s.minor ? Math.min(s.minor, 2) : 0 });
    return s.prefix || s.suffix ? `${s.prefix}${n}${s.suffix}` : `${s.symbol || ''}${n}`;
  }
  function storeHTML() {
    const d = report, k = d.deep;
    const woo = /woocommerce/i.test(d.ecommerce || '') || (d.plugins || []).some((p) => p.slug === 'woocommerce');
    if (!woo) return '';
    const sk = (w) => `<span class="sk" style="width:${w}px"></span>`;
    const rows = [];
    const s = k && !k.error ? k.store : null;
    if (!k) rows.push(`<div class="row"><dt>Currency</dt><dd>${sk(70)}</dd><span></span></div>`, `<div class="row"><dt>Prices</dt><dd>${sk(110)}</dd><span></span></div>`);
    else if (!s) rows.push('<div class="row"><dt>Store API</dt><dd><span class="aux">Not public</span></dd><span></span></div>');
    else if (!s.api) rows.push(`<div class="row"><dt>Store API</dt><dd><span class="aux">Blocked (${esc(s.status)})</span></dd><span></span></div>`);
    else {
      const count = k.content ? k.content.products : null;
      rows.push(`<div class="row"><dt>Products</dt><dd>${count !== null && count !== undefined ? `<span class="v">${count.toLocaleString()}</span>` : '<span class="aux">Unknown</span>'}</dd><span></span></div>`);
      rows.push(`<div class="row"><dt>Currency</dt><dd>${s.currency ? `<span class="v">${esc(s.currency)}</span>${s.symbol ? `<span class="num">${esc(s.symbol)}</span>` : ''}` : '<span class="aux">No products to read</span>'}</dd><span></span></div>`);
      if (s.min !== null) rows.push(`<div class="row"><dt>Prices</dt><dd><span class="v">${esc(fmtMoney(s, s.min))}${s.max !== null && s.max !== s.min ? ` – ${esc(fmtMoney(s, s.max))}` : ''}</span></dd><span></span></div>`);
    }
    return `<div class="grp"><div class="grp-h"><h2>Store</h2><span class="aux" style="font-size:12px">WooCommerce</span></div><dl class="rows">${rows.join('')}</dl></div>`;
  }

  const SIGNALS = [
    ['api', 'REST API responds', 'REST API'],
    ['linkHeader', 'REST API in Link header', 'HTTP header'],
    ['generator', 'Generator meta tag', 'Page source'],
    ['wpContent', '/wp-content/ assets', 'Asset URLs'],
    ['wpIncludes', '/wp-includes/ assets', 'Asset URLs'],
    ['linkRel', 'REST API link element', 'Page source'],
    ['adminPaths', 'Login or admin path', 'Page source']
  ];
  function signalSummary(key, sig) {
    const det = String(sig.detail || '');
    if (key === 'api') { const m = det.match(/\((\d+) namespaces\)/); return m ? `/wp-json lists ${m[1]} namespaces` : '/wp-json responds'; }
    if (key === 'generator') { const m = det.match(/WordPress\s+([\d.]+)/i); return m ? `WordPress ${m[1]}` : det.startsWith('RSS') ? 'Found in RSS feed link' : 'WordPress generator tag'; }
    if (key === 'wpContent' || key === 'wpIncludes') return sig.count ? `${sig.count} asset${sig.count === 1 ? '' : 's'} loaded` : 'Assets loaded';
    if (key === 'linkHeader') return 'rel="https://api.w.org/"';
    if (key === 'linkRel') return det.includes('EditURI') ? 'RSD EditURI link' : '<link rel="https://api.w.org/">';
    if (key === 'adminPaths') return /logged in|wpadminbar/i.test(det) ? 'Admin bar present (you’re logged in)' : 'Login link on the page';
    return det;
  }

  function renderEvidence() {
    const d = report;
    const sigs = SIGNALS.map(([k, t, src]) => ({ k, t, src, s: (d.signals && d.signals[k]) || { detected: false } }));
    const matched = sigs.filter((x) => x.s.detected).length;
    $('pane-evidence').innerHTML = `
      <div class="verdict">
        <div class="line"><span class="big">${matched} of 7 signals matched</span><span class="conf">${esc(d.confidence || '')} confidence</span></div>
        <div class="segs" aria-hidden="true">${sigs.map((x) => `<i class="${x.s.detected ? 'on' : ''}"></i>`).join('')}</div>
      </div>
      <ul class="plist">${sigs.map((x) => `
        <li class="sig">
          <button class="sig-main" type="button" aria-expanded="false" ${x.s.detected ? '' : 'disabled'}>
            ${x.s.detected ? ICON.check : ICON.miss}
            <span style="min-width:0"><span class="sig-t">${esc(x.t)}</span><span class="sig-s">${esc(x.s.detected ? signalSummary(x.k, x.s) : 'Not found on this page')}</span></span>
            <span class="sig-src">${esc(x.src)}</span>
          </button>
          ${x.s.detected ? `<div class="reveal"><div><div class="pdetail"><div class="evid">${esc(x.s.detail)}</div></div></div></div>` : ''}
        </li>`).join('')}
      </ul>`;
  }

  // Enrich theme from the site's style.css (already done in content script) and WordPress.org.
  function enrichTheme() {
    const d = report;
    if (!known(d.theme)) return;
    const theme = d.theme;
    fetchThemeMeta(theme).then((meta) => {
      if (!report || report.theme !== theme) return;
      report._wpTheme = meta || null;
      refreshHealthViews();
    });
  }

  // ------------------------------------------------------------------ updates, security, SEO, tech stack
  // Compare dotted versions: 5.9.5 < 6.2.5; 6.4 == 6.4.0; a pre-release (7.2-RC1) sorts before 7.2.
  function compareVersions(a, b) {
    const parse = (v) => {
      const m = String(v || '').trim().match(/^(\d+(?:\.\d+)*)(.*)$/);
      return m ? { nums: m[1].split('.').map((n) => parseInt(n, 10) || 0), pre: /^[-.]?(alpha|beta|rc|dev|pre)/i.test(m[2]) } : { nums: [0], pre: false };
    };
    const x = parse(a), y = parse(b);
    for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
      const d = (x.nums[i] || 0) - (y.nums[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    if (x.pre !== y.pre) return x.pre ? -1 : 1;
    return 0;
  }
  const isBehind = (current, latest) => !!(current && latest && compareVersions(current, latest) < 0);

  // Latest WordPress release, cached for 12 hours in session storage.
  async function fetchCoreLatest() {
    const KEY = 'wp_core_latest';
    try {
      if (hasChrome && chrome.storage && chrome.storage.session) {
        const hit = (await chrome.storage.session.get(KEY))[KEY];
        if (hit && Date.now() - hit.t < 12 * 3600 * 1000) return hit.v;
      }
      const res = await fetchWithTimeout('https://api.wordpress.org/core/version-check/1.7/', { cache: 'no-store' }, 5000);
      const data = await res.json();
      const v = data && data.offers && data.offers[0] && data.offers[0].current;
      if (v && hasChrome && chrome.storage && chrome.storage.session) chrome.storage.session.set({ [KEY]: { v, t: Date.now() } }).catch(() => {});
      return v || '';
    } catch (e) { return ''; }
  }

  // Work out which detected versions are behind WordPress.org. Plugin data comes from the
  // same plugin_information lookups that already load names and icons (no extra requests).
  let updatesPending = true;
  async function checkUpdates() {
    const r = report;
    updatesPending = true;
    const [metas, core] = await Promise.all([
      Promise.all(r.plugins.map((p) => fetchPluginMeta(p.slug).then((m) => [p, m]).catch(() => [p, null]))),
      known(r.version) ? fetchCoreLatest() : Promise.resolve('')
    ]);
    if (report !== r) return;
    for (const [p, m] of metas) {
      if (m && !m.isPro && m.latest && hasVersion(p) && isBehind(p.version, m.latest)) p.latest = m.latest;
      else delete p.latest;
      if (m && m.health) p.health = m.health; else delete p.health;
    }
    r._coreLatest = core || '';
    updatesPending = false;
    refreshHealthViews();
  }

  function themeLatest() {
    const t = themeInfo();
    return t.listed === true && !t.child && isBehind(t.version, report._wpTheme && report._wpTheme.version) ? report._wpTheme.version : '';
  }
  const coreOutdated = () => isBehind(report.version, report._coreLatest);
  const outdatedPlugins = () => report.plugins.filter((p) => p.latest);
  const updateCount = () => outdatedPlugins().length + (coreOutdated() ? 1 : 0) + (themeLatest() ? 1 : 0);

  // ---- Plugin health: closed, stale, or not tested with the site's WordPress version
  const majorMinor = (v) => (String(v || '').match(/^(\d+)\.(\d+)/) || []).slice(1, 3).join('.');
  function monthsSince(dateStr) {
    const t = Date.parse(dateStr);
    return Number.isFinite(t) ? (Date.now() - t) / (30.44 * 86400000) : null;
  }
  function relativeAge(dateStr) {
    const m = monthsSince(dateStr);
    if (m === null) return '';
    if (m < 1) return 'this month';
    if (m < 12) return `${Math.round(m)} month${Math.round(m) === 1 ? '' : 's'} ago`;
    const y = Math.floor(m / 12);
    return `${y} year${y === 1 ? '' : 's'} ago`;
  }
  const fmtInstalls = (n) => !n ? '' : n >= 1e6 ? `${Math.floor(n / 1e6)}M+ installs` : n >= 1e3 ? `${Math.floor(n / 1e3)}K+ installs` : `${n}+ installs`;
  // A REST namespace isn't always the plugin's WordPress.org slug (Jetpack registers "videopress/v1",
  // but the "videopress" slug is an unrelated, closed plugin), so only judge plugins found in asset URLs.
  const healthTrusted = (p) => p.method !== 'REST API Namespace';
  function pluginIssue(p) {
    const h = p.health;
    if (!h || !healthTrusted(p)) return null;
    if (h.closed) return { cls: 'bad', short: 'Closed', text: `Closed on WordPress.org${h.closedDate ? ` (${h.closedDate})` : ''}${h.closedReason ? `: ${h.closedReason}` : ''}` };
    const age = monthsSince(h.lastUpdated);
    if (age !== null && age >= 24) return { cls: 'warn', short: 'Stale', text: `No update in ${Math.floor(age / 12)} years (last ${h.lastUpdated})` };
    // Same rule WordPress.org uses: warn when "tested up to" is older than the last 3 major releases.
    const site = majorMinor(report.version), tested = majorMinor(h.tested);
    const majors = (v) => { const [a, b] = v.split('.').map(Number); return a * 10 + b; };
    if (site && tested && majors(site) - majors(tested) >= 3) return { cls: 'warn', short: 'Untested', text: `Tested up to WordPress ${h.tested}; the site runs ${site}` };
    return null;
  }
  const pluginIssues = () => report.plugins.map((p) => [p, pluginIssue(p)]).filter(([, i]) => i);
  function healthLine(p) {
    const h = p.health;
    if (!h || !healthTrusted(p)) return '';
    if (h.closed) return `Closed on WordPress.org${h.closedDate ? ` on ${h.closedDate}` : ''}${h.closedReason ? ` · ${h.closedReason}` : ''}`;
    return [h.lastUpdated && `Updated ${relativeAge(h.lastUpdated)}`, h.tested && `Tested up to ${h.tested}`, fmtInstalls(h.activeInstalls),
      h.numRatings ? `★ ${(h.rating / 20).toFixed(1)} (${h.numRatings.toLocaleString()})` : ''].filter(Boolean).join(' · ');
  }

  const tagHTML = (cls, label) => `<span class="tag ${cls}">${esc(label)}</span>`;
  const verArrow = (from, to) => `<span class="pver upd"><span class="was">${esc(from)}</span><span class="arr">→</span>${esc(to)}</span>`;

  // Security rows: response headers from the scan, plus the popup-time deep checks.
  // PHP branch support dates (php.net/supported-versions). Branches not listed are older and end-of-life.
  const PHP_SUPPORT = { '8.5': '2029-12-31', '8.4': '2028-12-31', '8.3': '2027-12-31', '8.2': '2026-12-31', '8.1': '2025-12-31', '8.0': '2023-11-26', '7.4': '2022-11-28' };
  function phpItem() {
    const raw = String(report.phpVersion || '');
    const m = raw.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    const branch = `${m[1]}.${m[2]}`, full = m[0];
    const until = PHP_SUPPORT[branch];
    if (!until && Number(m[1]) >= 9) return { label: 'PHP', cls: 'ok', tag: 'Supported', note: `PHP ${full}` };
    if (!until || Date.parse(until) < Date.now()) return { label: 'PHP', cls: 'bad', tag: 'End of life', note: `PHP ${full} no longer gets security fixes${until ? ` (since ${until})` : ''}` };
    const monthsLeft = (Date.parse(until) - Date.now()) / (30.44 * 86400000);
    return monthsLeft < 6 ? { label: 'PHP', cls: 'warn', tag: 'Ending soon', note: `PHP ${full} security support ends ${until}` }
      : { label: 'PHP', cls: 'ok', tag: 'Supported', note: `PHP ${full}, security fixes until ${until}` };
  }
  // How many WordPress major releases (x.y) the site is behind the latest.
  function coreMajorsBehind() {
    const a = String(report.version || '').match(/^(\d+)\.(\d+)/), b = String(report._coreLatest || '').match(/^(\d+)\.(\d+)/);
    if (!a || !b) return 0;
    return (Number(b[1]) * 10 + Number(b[2])) - (Number(a[1]) * 10 + Number(a[2]));
  }

  function securityItems() {
    const d = report, h = d.securityHeaders, k = d.deep, items = [];
    const https = (d.protocol || (d.url || '').slice(0, 6)).startsWith('https');
    const php = phpItem();
    if (php) items.push(php);
    if (k && k.error) items.push({ label: 'Site checks', cls: '', tag: 'Couldn’t run', note: 'Reload this tab, then open WPScout again.' });
    else if (k) {
      items.push(k.xmlrpc.enabled ? { label: 'XML-RPC', cls: 'warn', tag: 'Enabled', note: '/xmlrpc.php accepts requests' } : { label: 'XML-RPC', cls: 'ok', tag: 'Off', note: `/xmlrpc.php answered ${k.xmlrpc.status || 'nothing'}` });
      items.push(k.users.exposed ? { label: 'Usernames', cls: 'warn', tag: `${k.users.list.length} exposed`, note: k.users.list.join(', ') } : { label: 'Usernames', cls: 'ok', tag: 'Hidden', note: 'REST API doesn’t list users' });
      items.push(k.readme.exposed ? { label: 'readme.html', cls: 'warn', tag: 'Public', note: k.readme.version ? `Shows version ${k.readme.version}` : 'Shows the WordPress readme' } : { label: 'readme.html', cls: 'ok', tag: 'Hidden', note: '' });
      items.push(k.uploadsListing.exposed ? { label: 'Uploads', cls: 'warn', tag: 'Listing on', note: '/wp-content/uploads/ lists files' } : { label: 'Uploads', cls: 'ok', tag: 'Listing off', note: '' });
      items.push(k.debugLog.exposed ? { label: 'debug.log', cls: 'bad', tag: 'Exposed', note: '/wp-content/debug.log is public' } : { label: 'debug.log', cls: 'ok', tag: 'Not public', note: '' });
      const lg = loginItem(k.login);
      if (lg) items.push(lg);
      const st = k.securityTxt;
      if (st) items.push(st.found ? { label: 'security.txt', cls: st.expired ? 'warn' : 'ok', tag: st.expired ? 'Expired' : 'Found', note: st.contacts.join(', ') + (st.expires ? ` · expires ${st.expires.slice(0, 10)}` : '') } : { label: 'security.txt', cls: '', tag: 'None', note: 'No /.well-known/security.txt contact' });
    } else {
      items.push({ pending: true }, { pending: true }, { pending: true });
    }
    if (!h) items.push({ label: 'Headers', cls: '', tag: 'Not checked', note: 'The page headers couldn’t be read' });
    else {
      const has = (n) => !!h[n];
      const frameOk = has('x-frame-options') || /frame-ancestors/i.test(h['content-security-policy'] || '');
      if (https) items.push(has('strict-transport-security') ? { label: 'HSTS', cls: 'ok', tag: 'Set', note: h['strict-transport-security'] } : { label: 'HSTS', cls: 'warn', tag: 'Missing', note: 'Strict-Transport-Security' });
      items.push(has('content-security-policy') ? { label: 'CSP', cls: 'ok', tag: 'Set', note: h['content-security-policy'] } : { label: 'CSP', cls: 'warn', tag: 'Missing', note: 'Content-Security-Policy' });
      items.push(frameOk ? { label: 'Framing', cls: 'ok', tag: 'Protected', note: h['x-frame-options'] || 'CSP frame-ancestors' } : { label: 'Framing', cls: 'warn', tag: 'Missing', note: 'X-Frame-Options' });
      items.push(/nosniff/i.test(h['x-content-type-options'] || '') ? { label: 'MIME sniffing', cls: 'ok', tag: 'Blocked', note: 'nosniff' } : { label: 'MIME sniffing', cls: 'warn', tag: 'Missing', note: 'X-Content-Type-Options' });
      items.push(has('referrer-policy') ? { label: 'Referrer', cls: 'ok', tag: 'Set', note: h['referrer-policy'] } : { label: 'Referrer', cls: '', tag: 'Not set', note: 'Referrer-Policy' });
      items.push(has('permissions-policy') ? { label: 'Permissions', cls: 'ok', tag: 'Set', note: h['permissions-policy'] } : { label: 'Permissions', cls: '', tag: 'Not set', note: 'Permissions-Policy' });
    }
    return items;
  }

  // Login page state from the popup-time check of /wp-login.php.
  function loginItem(l) {
    if (!l) return null;
    switch (l.state) {
      case 'default': return { label: 'Login page', cls: '', tag: 'Default', note: '/wp-login.php shows the login form' };
      case 'moved': return { label: 'Login page', cls: 'ok', tag: 'Moved', note: `/wp-login.php forwards to ${l.path}` };
      case 'offsite': return { label: 'Login page', cls: 'ok', tag: 'Elsewhere', note: '/wp-login.php redirects to another domain (single sign-on or an account site)' };
      case 'redirected': return { label: 'Login page', cls: 'ok', tag: 'Hidden', note: `/wp-login.php redirects to ${l.path || 'another page'}` };
      case 'hidden': return { label: 'Login page', cls: 'ok', tag: 'Hidden', note: `/wp-login.php answered ${l.status} without a login form` };
      case 'blocked': return { label: 'Login page', cls: 'ok', tag: 'Blocked', note: `/wp-login.php answered ${l.status}` };
      case 'limited': return { label: 'Login page', cls: 'ok', tag: 'Protected', note: `/wp-login.php answered ${l.status} (rate limit or challenge)` };
      default: return { label: 'Login page', cls: '', tag: 'Unknown', note: 'Couldn’t reach /wp-login.php' };
    }
  }

  // AI and ad files at the domain root.
  function filesItems(k) {
    const out = [];
    if (k.llmsTxt) out.push(k.llmsTxt.found ? { label: 'llms.txt', cls: 'ok', tag: 'Found', note: k.llmsTxt.title || 'Guidance for AI tools' } : { label: 'llms.txt', cls: '', tag: 'None', note: 'No guidance file for AI tools' });
    if (k.adsTxt) out.push(k.adsTxt.found ? { label: 'ads.txt', cls: 'ok', tag: `${k.adsTxt.networkCount} network${k.adsTxt.networkCount === 1 ? '' : 's'}`, note: `${k.adsTxt.entries} sellers (${k.adsTxt.direct} direct): ${k.adsTxt.networks.join(', ')}` } : { label: 'ads.txt', cls: '', tag: 'None', note: 'No ad sellers listed' });
    return out;
  }

  function seoItems() {
    const s = report.seo, k = report.deep, items = [];
    if (!s) return [{ label: 'SEO', cls: '', tag: 'Not read', note: 'Rescan to read this page’s metadata' }, ...(k && !k.error ? filesItems(k) : [])];
    const len = (x) => [...(x || '')].length;
    items.push(!s.title ? { label: 'Title', cls: 'warn', tag: 'Missing', note: '' } : { label: 'Title', cls: len(s.title) > 60 ? 'warn' : 'ok', tag: `${len(s.title)} chars`, note: s.title });
    items.push(!s.description ? { label: 'Description', cls: 'warn', tag: 'Missing', note: 'No meta description' } : { label: 'Description', cls: len(s.description) > 160 ? 'warn' : 'ok', tag: `${len(s.description)} chars`, note: s.description });
    items.push(s.canonical ? { label: 'Canonical', cls: 'ok', tag: 'Set', note: s.canonical } : { label: 'Canonical', cls: 'warn', tag: 'Missing', note: '' });
    const noindex = /noindex/i.test(`${s.robots} ${s.xRobots}`);
    items.push(noindex ? { label: 'Indexing', cls: 'warn', tag: 'Noindex', note: s.robots || s.xRobots } : { label: 'Indexing', cls: 'ok', tag: 'Indexable', note: s.robots || 'No robots meta tag' });
    items.push(s.ogTitle && s.ogImage ? { label: 'Open Graph', cls: 'ok', tag: 'Set', note: s.ogTitle } : (s.ogTitle || s.ogImage) ? { label: 'Open Graph', cls: 'warn', tag: 'Partial', note: s.ogImage ? 'No og:title' : 'No og:image' } : { label: 'Open Graph', cls: 'warn', tag: 'Missing', note: '' });
    items.push(s.twitterCard ? { label: 'Twitter card', cls: 'ok', tag: 'Set', note: s.twitterCard } : { label: 'Twitter card', cls: '', tag: 'None', note: '' });
    items.push(s.schema && s.schema.length ? { label: 'Schema', cls: 'ok', tag: `${s.schema.length} type${s.schema.length === 1 ? '' : 's'}`, note: s.schema.join(', ') } : { label: 'Schema', cls: '', tag: 'None', note: 'No JSON-LD found' });
    items.push(s.lang ? { label: 'Language', cls: 'ok', tag: 'Set', note: s.lang } : { label: 'Language', cls: 'warn', tag: 'Missing', note: '<html lang> not set' });
    items.push({ label: 'H1', cls: s.h1 === 1 ? 'ok' : '', tag: s.h1 === 1 ? 'One' : s.h1 === 0 ? 'None' : `${s.h1} headings`, note: 'On this page' });
    if (k && !k.error) {
      items.push(k.sitemap.found ? { label: 'Sitemap', cls: 'ok', tag: 'Found', note: k.sitemap.path } : { label: 'Sitemap', cls: 'warn', tag: 'Not found', note: 'Checked /wp-sitemap.xml, /sitemap_index.xml, /sitemap.xml' });
      items.push(!k.robots.found ? { label: 'robots.txt', cls: '', tag: 'Not found', note: '' } : k.robots.disallowAll ? { label: 'robots.txt', cls: 'warn', tag: 'Blocks all', note: 'Disallow: / for all crawlers' } : { label: 'robots.txt', cls: 'ok', tag: 'Found', note: k.robots.sitemapLine ? 'Lists a sitemap' : 'No Sitemap line' });
      items.push(...filesItems(k));
    } else if (!k) items.push({ pending: true }, { pending: true });
    return items;
  }

  const issueCount = (items) => items.filter((i) => i.cls === 'warn' || i.cls === 'bad').length;

  function checkRowHTML(i) {
    if (i.html) return i.html;
    if (i.wide) return `<div class="row wide"><dt><span class="v">${esc(i.label)}</span></dt><dd>${tagHTML(i.cls, i.tag)}</dd></div><div class="row note-row"><span class="aux clip" title="${esc(i.note)}">${esc(i.note)}</span></div>`;
    if (i.pending) return '<div class="row chk"><dt><span class="sk" style="width:60px"></span></dt><dd><span class="sk" style="width:120px"></span></dd><span></span></div>';
    return `<div class="row chk"><dt>${esc(i.label)}</dt><dd>${tagHTML(i.cls, i.tag)}${i.note ? `<span class="aux clip" title="${esc(i.note)}">${esc(i.note)}</span>` : ''}</dd><span></span></div>`;
  }

  // ---- Known vulnerabilities (optional keys for Wordfence and WPScan; lookups run in the background worker)
  const VULN_PROVIDERS = {
    wordfence: { label: 'Wordfence', origin: 'https://www.wordfence.com/*' },
    wpscan: { label: 'WPScan', origin: 'https://wpscan.com/*' }
  };
  let vuln = { loaded: false, status: null, results: {} };
  const provOn = (st) => !!(st && st.hasKey && st.permission);
  function vulnQueryItems() {
    const d = report, items = [];
    d.plugins.forEach((p) => { if (hasVersion(p)) items.push({ type: 'plugin', slug: p.wpOrgSlug || p.slug, version: p.version, name: pluginName(p) }); });
    const t = themeInfo();
    if (known(d.theme) && t.version) items.push({ type: 'theme', slug: d.theme, version: t.version, name: t.name });
    if (known(d.version)) items.push({ type: 'core', slug: 'wordpress', version: String(d.version).replace(/-\d{4,}$/, ''), name: 'WordPress' });
    return items;
  }
  async function runVulnLookup() {
    const r = report;
    if (!hasChrome || !r) { if (!vuln.items) vuln = { loaded: true, status: null, results: {} }; if (r) refreshHealthViews(); return; }
    const items = vulnQueryItems();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'VULN_LOOKUP', items });
      if (report !== r) return;
      const w = (res && res.wpscan) || {};
      vuln = { loaded: true, status: res && res.status, results: { ...(res && res.results) }, items, wpscanError: w.error || '', wpscanRetryAt: w.retryAt || 0, wpscanCalls: w.calls || 0 };
    } catch (e) { vuln = { loaded: true, status: null, results: {} }; }
    refreshHealthViews();
  }
  // Combine every provider's matches: one entry per product, one hit per issue (same CVE, or same title, counts once).
  function vulnMatches() {
    const names = Object.fromEntries((vuln.items || []).map((i) => [`${i.type}:${i.slug}`, i.name]));
    const by = new Map();
    let any = false;
    for (const [src, list] of Object.entries(vuln.results || {})) {
      if (!Array.isArray(list)) continue;
      any = true;
      for (const m of list) {
        const k = `${m.type}:${m.slug}`;
        if (!by.has(k)) by.set(k, { type: m.type, slug: m.slug, version: m.version, name: names[k] || m.slug, hits: [], seen: new Map() });
        const e = by.get(k);
        for (const h of m.hits || []) {
          const cves = Array.isArray(h.cve) ? h.cve : h.cve ? [h.cve] : [];
          const tkey = 't:' + String(h.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const keys = [...cves.map((c) => 'c:' + c.toUpperCase()), tkey];
          const hit = keys.map((x) => e.seen.get(x)).find(Boolean);
          if (hit) {
            if (!hit.sources.includes(src)) hit.sources.push(src);
            if (h.url && !hit.links[src]) hit.links[src] = h.url;
            if (!hit.published && h.published) hit.published = h.published;
            if (hit.score == null && h.score != null) { hit.score = h.score; hit.rating = h.rating; }
            if (!hit.patched.length && h.patched && h.patched.length) hit.patched = h.patched;
            keys.forEach((x) => e.seen.set(x, hit));
          } else {
            const n = { title: h.title, score: h.score, rating: h.rating, cve: cves, patched: h.patched || [], sources: [src], links: h.url ? { [src]: h.url } : {}, published: h.published || '' };
            e.hits.push(n); keys.forEach((x) => e.seen.set(x, n));
          }
        }
      }
    }
    if (!any) return null;
    return [...by.values()].map(({ seen, ...m }) => {
      m.hits.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { ...m, total: m.hits.length };
    }).filter((m) => m.total);
  }
  const SAFE_LINK = /^https:\/\/(www\.wordfence\.com|wpscan\.com)\//;
  function vulnRowHTML(m) {
    const top = m.hits[0];
    const srcs = [...new Set(m.hits.flatMap((h) => h.sources))];
    const fixes = m.hits.map((h) => (h.patched || [])[0]).filter(Boolean);
    const fixAll = fixes.length === m.hits.length && fixes.length ? fixes.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b)) : '';
    const summary = `${top.title}${m.total > 1 ? ` · and ${m.total - 1} more` : ''}`;
    const hits = m.hits.map((h) => {
      const sev = h.rating || h.score != null ? `<span class="tag bad">${esc([h.rating, h.score != null ? Number(h.score).toFixed(1) : ''].filter(Boolean).join(' '))}</span>` : '';
      const cves = (h.cve || []).filter((c) => /^CVE-\d{4}-\d{3,}$/.test(c)).map((c) => `<a href="https://www.cve.org/CVERecord?id=${c}" target="_blank" rel="noopener noreferrer">${c}</a>`);
      const fix = h.patched && h.patched.length ? `Fixed in <span class="mono">${esc(h.patched[0])}</span>` : '<span class="pflag bad">No fix listed</span>';
      const by = h.sources.map((src) => {
        const name = esc(VULN_PROVIDERS[src] ? VULN_PROVIDERS[src].label : src);
        const url = h.links && h.links[src];
        return url && SAFE_LINK.test(url) ? `<a class="vsrc-chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>` : `<span class="vsrc-chip">${name}</span>`;
      }).join('');
      return `<li class="vhit">
        <div class="vhit-t">${esc(h.title || 'Untitled issue')}</div>
        <div class="vhit-m">${sev}${cves.join('')}<span>${fix}</span>${h.published ? `<span class="aux">${esc(h.published)}</span>` : ''}</div>
        <div class="vhit-s"><span class="aux">Reported by</span>${by}</div>
      </li>`;
    }).join('');
    return `<div class="row clickable wide vrow" role="button" tabindex="0" aria-expanded="false" data-reveal data-vkey="${esc(m.type + ':' + m.slug)}">
        <dt><span class="v">${esc(m.name)} ${esc(m.version)}</span></dt><dd><span class="tag bad">${m.total} known${top.rating ? ` · ${esc(top.rating)}` : ''}</span></dd>${ICON.chev}
      </div>
      <div class="reveal"><div><div class="theme-card vcard">
        <div class="aux">${fixAll ? `Update to <span class="mono">${esc(fixAll)}</span> or later to fix ${m.total === 1 ? 'it' : 'all of these'}.`
          : m.total === 1 ? `No fixed version is listed yet. Check the ${m.type === 'core' ? 'WordPress' : m.type}’s changelog${m.type === 'plugin' ? ', or consider replacing it' : ''}.`
          : `${m.total - fixes.length} of these ${m.total} have no fixed version listed yet.`} Found by ${esc(srcNames(srcs))}.</div>
        <ul class="vhits">${hits}</ul>
      </div></div></div>
      <div class="row note-row vnote"><span class="aux clip" title="${esc(summary)}">${esc(summary)}</span></div>`;
  }
  const srcNames = (list) => list.map((x) => VULN_PROVIDERS[x] ? VULN_PROVIDERS[x].label : x).join(', ');
  const vulnCount = () => { const m = vulnMatches(); return m ? m.length : 0; };
  const vulnError = (st) => st.error + (st.retryAt ? ` · trying again after ${new Date(st.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
  function vulnItems() {
    if (!vuln.loaded) return [{ pending: true }];
    const st = vuln.status || {};
    const on = Object.keys(VULN_PROVIDERS).filter((k) => provOn(st[k]));
    if (!on.length) return [{ label: 'Off', cls: '', tag: 'Not set up', note: 'Add a Wordfence or WPScan key in Settings to check known vulnerabilities' }];
    const rows = [];
    if (provOn(st.wordfence) && !Array.isArray(vuln.results.wordfence)) {
      rows.push(st.wordfence.error ? { label: 'Wordfence', cls: 'warn', tag: 'Unavailable', note: vulnError(st.wordfence) } : { label: 'Wordfence', cls: '', tag: 'Downloading', note: 'Getting the Wordfence vulnerability list…' });
    }
    if (provOn(st.wpscan) && vuln.wpscanError) rows.push({ label: 'WPScan', cls: 'warn', tag: 'Problem', note: vulnError({ error: vuln.wpscanError, retryAt: vuln.wpscanRetryAt }) });
    const matches = vulnMatches();
    if (matches && !matches.length) {
      const used = Object.keys(vuln.results).filter((k) => Array.isArray(vuln.results[k]));
      const n = (vuln.items || []).length;
      rows.push({ label: 'Known issues', cls: 'ok', tag: 'None found', note: `Checked ${n} version${n === 1 ? '' : 's'} with ${srcNames(used)}` });
    }
    (matches || []).forEach((m) => rows.push({ html: vulnRowHTML(m), cls: 'bad' }));
    return rows.length ? rows : [{ pending: true }];
  }

  // ---- Settings pane: add or remove a key per provider
  let settingsReturnTab = 'overview', keysChanged = false;
  async function renderSettings() {
    let all = {};
    try { all = (await chrome.runtime.sendMessage({ type: 'VULN_STATUS' })) || {}; } catch (e) {}
    for (const k of Object.keys(VULN_PROVIDERS)) {
      const st = all[k] || {};
      let html = '<span class="tag">Off</span> No key added';
      if (st.hasKey && !st.permission) html = '<span class="tag warn">Problem</span> Permission to reach this provider was removed. Save the key again';
      else if (provOn(st)) {
        if (k === 'wordfence') {
          const when = st.updated ? new Date(st.updated).toLocaleString() : '';
          html = st.refreshing ? '<span class="tag">Downloading…</span> Getting the vulnerability list'
            : st.error ? `<span class="tag warn">Problem</span> ${esc(vulnError(st))}`
            : st.updated ? `<span class="tag ok">On</span> ${st.count.toLocaleString()} entries · updated ${esc(when)}` : '<span class="tag">Waiting</span> The list downloads when you next open a WordPress site';
        } else if (st.retryAt) html = `<span class="tag warn">Paused</span> ${esc(vulnError({ error: 'Daily request limit used up', retryAt: st.retryAt }))}`;
        else if (st.error) html = `<span class="tag warn">Problem</span> ${esc(st.error)}`;
        else html = '<span class="tag ok">On</span> Checks run when you open the popup on a WordPress site';
      }
      $('status-' + k).innerHTML = html;
      $('state-' + k).innerHTML = provOn(st) ? '<span class="tag ok">On</span>' : '';
      $('remove-' + k).hidden = !st.hasKey;
      const input = $('key-' + k);
      input.value = '';
      input.placeholder = st.hasKey ? 'Key saved · paste a new one to replace it' : input.getAttribute('aria-label').replace(' API key', '') + ' API key';
    }
  }
  function openSettings() {
    settingsReturnTab = (document.querySelector('.pp-tab[aria-selected="true"]') || {}).dataset?.tab || 'overview';
    PANES.forEach((k) => { $('pane-' + k).hidden = true; });
    $('state-empty').hidden = true; $('state-loading').hidden = true;
    $('pane-settings').hidden = false;
    $('body').scrollTop = 0;
    renderSettings();
  }
  function closeSettings() {
    $('pane-settings').hidden = true;
    if (report) { selectTab(settingsReturnTab); if (keysChanged) { keysChanged = false; runVulnLookup(); } } else runDiagnostics();
  }
  async function saveVulnKey(provider) {
    const P = VULN_PROVIDERS[provider];
    if (!P) return;
    const key = $('key-' + provider).value.trim();
    if (!/^[A-Za-z0-9_\-.=]{16,}$/.test(key)) { toast(`That doesn’t look like a ${P.label} API key`); return; }
    // Chrome's permission prompt takes focus, which closes this popup before the request resolves.
    // So hand the key to the background worker first: it saves the key and starts the download as
    // soon as the permission is granted (chrome.permissions.onAdded), even if the popup is gone.
    // Not awaited, so the request below still runs inside the click's user gesture.
    chrome.runtime.sendMessage({ type: 'VULN_PENDING_KEY', provider, key }).catch(() => {});
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: [P.origin] }); } catch (e) {}
    if (!granted) {
      chrome.runtime.sendMessage({ type: 'VULN_PENDING_KEY', provider, key: '' }).catch(() => {});
      toast(`WPScout needs permission to reach ${P.label} to check vulnerabilities`);
      return;
    }
    if (provider === 'wordfence') $('status-wordfence').innerHTML = '<span class="tag">Downloading…</span> Getting the vulnerability list';
    try { await chrome.runtime.sendMessage({ type: 'VULN_SET_KEY', provider, key }); } catch (e) {}
    keysChanged = true;
    toast(`${P.label} key saved`);
    renderSettings();
  }
  async function removeVulnKey(provider) {
    const P = VULN_PROVIDERS[provider];
    if (!P) return;
    try { await chrome.runtime.sendMessage({ type: 'VULN_CLEAR', provider }); } catch (e) {}
    keysChanged = true;
    vuln.results = { ...vuln.results, [provider]: undefined };
    if (provider === 'wpscan') vuln.wpscanError = '';
    toast(`${P.label} key removed`);
    renderSettings();
  }

  // ---- Performance snapshot (this visit, measured by the browser)
  const fmtMs = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`;
  const fmtBytes = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;
  function perfItems() {
    const f = report.perf;
    if (f === undefined) return [{ pending: true }, { pending: true }, { pending: true }];
    if (!f) return [{ label: 'Performance', cls: '', tag: 'Not measured', note: 'Reload this tab, then open WPScout again.' }];
    const items = [];
    if (f.ttfb !== null) items.push({ label: 'Response', cls: f.ttfb <= 800 ? 'ok' : f.ttfb <= 1800 ? 'warn' : 'bad', tag: fmtMs(f.ttfb), note: 'Time to first byte' });
    if (f.load !== null) items.push({ label: 'Page load', cls: f.load <= 3000 ? 'ok' : f.load <= 6000 ? 'warn' : 'bad', tag: fmtMs(f.load), note: f.domReady ? `DOM ready at ${fmtMs(f.domReady)}` : '' });
    else items.push({ label: 'Page load', cls: '', tag: 'Still loading', note: 'Rescan once the page finishes loading' });
    items.push({ label: 'Page weight', cls: f.bytes > 3 * 1048576 ? 'warn' : 'ok', tag: `${f.bytesPartial ? 'at least ' : ''}${fmtBytes(f.bytes)}`, note: 'Transferred on this visit; cached files count as 0' });
    items.push({ label: 'Requests', cls: f.requests > 120 ? 'warn' : 'ok', tag: String(f.requests), note: `${f.stylesheets} stylesheet${f.stylesheets === 1 ? '' : 's'}` });
    if (f.protocol) {
      const p = f.protocol.toLowerCase();
      items.push({ label: 'Protocol', cls: /h2|h3|quic/.test(p) ? 'ok' : 'warn', tag: p === 'h2' ? 'HTTP/2' : p === 'h3' ? 'HTTP/3' : p.toUpperCase(), note: /h2|h3|quic/.test(p) ? '' : 'An older protocol; HTTP/2 or HTTP/3 loads faster' });
    }
    if (f.images) {
      const share = f.modernImages / f.images;
      items.push({ label: 'Image formats', cls: f.images >= 4 && share < 0.5 ? 'warn' : 'ok', tag: `${f.modernImages} of ${f.images} modern`, note: 'WebP or AVIF' });
      items.push({ label: 'Lazy loading', cls: f.images >= 8 && !f.lazyImages ? 'warn' : 'ok', tag: `${f.lazyImages} of ${f.images}`, note: 'Images with loading="lazy"' });
    }
    items.push({ label: 'Blocking scripts', cls: f.blockingScripts > 3 ? 'warn' : 'ok', tag: String(f.blockingScripts), note: 'In <head> without async or defer' });
    items.push({ label: 'DOM size', cls: f.domNodes > 1500 ? 'warn' : 'ok', tag: `${f.domNodes.toLocaleString()} nodes`, note: '' });
    items.push(...deliveryItems(report.delivery, f));
    return items;
  }

  // Compression and caching of the page itself, from its response headers.
  const fmtSecs = (s) => s >= 86400 ? `${Math.round(s / 86400)} d` : s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
  function deliveryItems(dl, f) {
    const items = [];
    const ENC = { br: 'Brotli', gzip: 'gzip', zstd: 'Zstandard', deflate: 'Deflate' };
    const enc = dl && dl.encoding ? dl.encoding.split(',').map((x) => x.trim()).filter(Boolean).pop() : '';
    const ratio = f && f.htmlWire && f.htmlRaw ? f.htmlWire / f.htmlRaw : null;
    if (enc && enc !== 'identity') items.push({ label: 'Compression', cls: 'ok', tag: ENC[enc] || enc, note: ratio && ratio < 0.95 ? `HTML ${fmtBytes(f.htmlRaw)} sent as ${fmtBytes(f.htmlWire)}` : 'content-encoding' });
    else if (ratio !== null && ratio < 0.9) items.push({ label: 'Compression', cls: 'ok', tag: 'On', note: `HTML ${fmtBytes(f.htmlRaw)} sent as ${fmtBytes(f.htmlWire)}` });
    else if (dl) items.push({ label: 'Compression', cls: 'warn', tag: 'None', note: 'The page is sent uncompressed; Brotli or gzip makes it smaller' });
    if (!dl) return items;
    const cc = (dl.cacheControl || '').toLowerCase();
    if (cc) {
      const num = (k) => { const m = cc.match(new RegExp(`(?:^|[,\\s])${k}=(\\d+)`)); return m ? Number(m[1]) : null; };
      const maxAge = num('max-age'), sMax = num('s-maxage');
      const parts = [];
      if (/no-store/.test(cc)) parts.push('Not stored');
      else if (/no-cache/.test(cc) || maxAge === 0) parts.push('Revalidated');
      else if (maxAge) parts.push(`Browser ${fmtSecs(maxAge)}`);
      if (sMax) parts.push(`CDN ${fmtSecs(sMax)}`);
      if (/private/.test(cc)) parts.push('Private');
      items.push({ label: 'Cache policy', cls: '', tag: parts.join(' · ') || 'Set', note: dl.cacheControl });
    } else items.push({ label: 'Cache policy', cls: '', tag: 'Not set', note: 'No Cache-Control header' });
    const age = Number(dl.age);
    if (dl.age !== '' && Number.isFinite(age)) items.push({ label: 'Cached copy', cls: 'ok', tag: age ? `${fmtSecs(age)} old` : 'Fresh', note: 'Age header: served from a shared cache' });
    if (dl.serverTiming) {
      const timings = dl.serverTiming.split(',').map((s) => {
        const name = s.split(';')[0].trim(), dur = (s.match(/dur=([\d.]+)/) || [])[1], desc = (s.match(/desc="?([^";]+)/) || [])[1];
        return { name: desc || name, dur: dur ? Number(dur) : null };
      }).filter((t) => t.name);
      const timed = timings.filter((t) => t.dur !== null).sort((a, b) => b.dur - a.dur);
      items.push({ label: 'Server timing', cls: '', tag: timed.length ? `${timed[0].name} ${Math.round(timed[0].dur)} ms` : `${timings.length} metric${timings.length === 1 ? '' : 's'}`, note: timings.slice(0, 5).map((t) => t.dur !== null ? `${t.name} ${Math.round(t.dur)} ms` : t.name).join(', ') });
    }
    return items;
  }

  async function runPerf(tabId) {
    const r = report;
    if (!r) return;
    let data = null;
    try { const res = await messageTab(tabId, 'WP_PERF'); if (res && res.ok) data = res.data; } catch (e) {}
    if (!data) {
      try { const out = await chrome.scripting.executeScript({ target: { tabId }, func: readPerf }); data = out && out[0] ? out[0].result : null; } catch (e) {}
    }
    if (report !== r) return;
    r.perf = data || null;
    refreshHealthViews();
  }

  // ---- Content stats (from the popup-time checks) and multisite (from the scan)
  function relDate(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const days = Math.round((Date.now() - t) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 31 ? `${days} days ago` : relativeAge(iso);
  }
  function contentHTML() {
    const d = report, c = d.deep && !d.deep.error ? d.deep.content : null;
    const sk = (w) => `<span class="sk" style="width:${w}px"></span>`;
    const n = (v) => (v === null || v === undefined ? '<span class="aux">Not public</span>' : `<span class="v">${v.toLocaleString()}</span>`);
    const rows = [];
    if (!d.deep) rows.push(`<div class="row"><dt>Posts</dt><dd>${sk(60)}</dd><span></span></div>`, `<div class="row"><dt>Latest post</dt><dd>${sk(110)}</dd><span></span></div>`);
    else if (!c) rows.push('<div class="row"><dt>Content</dt><dd><span class="aux">Couldn’t read the REST API</span></dd><span></span></div>');
    else {
      rows.push(`<div class="row"><dt>Posts</dt><dd>${n(c.posts)}</dd><span></span></div>`);
      rows.push(`<div class="row"><dt>Latest post</dt><dd>${c.latestPost ? `<span class="v">${esc(relDate(c.latestPost))}</span><span class="num">${esc(c.latestPost.slice(0, 10))}</span>` : '<span class="aux">None public</span>'}</dd><span></span></div>`);
      rows.push(`<div class="row"><dt>Pages</dt><dd>${n(c.pages)}</dd><span></span></div>`);
      if (c.products !== null && c.products !== undefined && !storeHTML()) rows.push(`<div class="row"><dt>Products</dt><dd>${n(c.products)}</dd><span></span></div>`);
    }
    rows.push(`<div class="row"><dt>Multisite</dt><dd>${d.multisite ? `<span class="v">Network site</span><span class="num">#${esc(d.multisite.siteId)}</span>` : '<span class="aux">Not detected</span>'}</dd><span></span></div>`);
    return `<div class="grp"><div class="grp-h"><h2>Content</h2></div><dl class="rows">${rows.join('')}</dl></div>`;
  }

  // ---- Checks tab and Health summary
  function renderChecks() {
    const d = report;
    const upd = [];
    if (coreOutdated()) {
      const behind = coreMajorsBehind();
      upd.push(`<div class="row wide"><dt><span class="v">WordPress</span>${behind >= 2 ? ` <span class="pflag warn">${behind} major versions behind</span>` : ''}</dt><dd>${verArrow(d.version, d._coreLatest)}</dd></div>`);
    }
    const tl = themeLatest();
    if (tl) upd.push(`<div class="row wide"><dt><span class="v">${esc(themeInfo().name)}</span> <span class="aux">theme</span></dt><dd>${verArrow(themeInfo().version, tl)}</dd></div>`);
    outdatedPlugins().forEach((p) => upd.push(`<div class="row wide"><dt><span class="v">${esc(pluginName(p))}</span></dt><dd>${verArrow(p.version, p.latest)}</dd></div>`));
    const updBody = updatesPending ? checkRowHTML({ pending: true })
      : upd.length ? upd.join('')
      : '<div class="row"><dt>Versions</dt><dd><span class="tag ok">Up to date</span><span class="aux clip">No updates found for the versions this page shows</span></dd><span></span></div>';
    const issues = pluginIssues();
    const healthBody = updatesPending ? checkRowHTML({ pending: true })
      : issues.length ? issues.map(([p, i]) => `<div class="row wide" title="${esc(i.text)}"><dt><span class="v">${esc(pluginName(p))}</span></dt><dd><span class="tag ${i.cls}">${esc(i.short)}</span></dd></div><div class="row note-row"><span class="aux clip">${esc(i.text)}</span></div>`).join('')
      : '<div class="row"><dt>Plugins</dt><dd><span class="tag ok">No issues</span><span class="aux clip">None closed, stale or untested on WordPress.org</span></dd><span></span></div>';
    const vul = vulnItems();
    const sec = securityItems(), seo = seoItems(), perf = perfItems();
    const openV = [...document.querySelectorAll('#pane-checks [data-vkey][aria-expanded="true"]')].map((e) => e.dataset.vkey);
    $('pane-checks').innerHTML = `
      <div class="grp"><div class="grp-h"><h2>Updates${upd.length ? ` · ${upd.length}` : ''}</h2></div><dl class="rows">${updBody}</dl></div>
      <div class="grp"><div class="grp-h"><h2>Vulnerabilities</h2><button class="link" type="button" data-action="open-settings">Settings</button></div><dl class="rows">${vul.map(checkRowHTML).join('')}</dl></div>
      <div class="grp"><div class="grp-h"><h2>Plugin health${issues.length ? ` · ${issues.length}` : ''}</h2></div><dl class="rows">${healthBody}</dl></div>
      <div class="grp"><div class="grp-h"><h2>Security</h2>${d.deep ? '' : '<span class="aux" style="font-size:12px">Checking the site…</span>'}</div><dl class="rows">${sec.map(checkRowHTML).join('')}</dl></div>
      <div class="grp"><div class="grp-h"><h2>Performance</h2><span class="aux" style="font-size:12px">This visit</span></div><dl class="rows">${perf.map(checkRowHTML).join('')}</dl></div>
      <div class="grp"><div class="grp-h"><h2>SEO</h2></div><dl class="rows">${seo.map(checkRowHTML).join('')}</dl></div>`;
    openV.forEach((k) => toggleReveal(document.querySelector(`#pane-checks [data-vkey="${CSS.escape(k)}"]`), true));
    const total = upd.length + issues.length + issueCount(vul) + issueCount(sec) + issueCount(seo) + issueCount(perf);
    $('tab-checks-count').textContent = total ? String(total) : '';
  }

  function healthRowHTML() {
    const u = updatesPending ? null : updateCount();
    const s = report.deep ? issueCount(securityItems()) : null;
    const seo = issueCount(seoItems());
    const ph = updatesPending ? 0 : pluginIssues().length;
    const v = vulnCount();
    const parts = [];
    if (v) parts.push(`<span class="tag bad">${v} vulnerabilit${v === 1 ? 'y' : 'ies'}</span>`);
    if (u === null) parts.push('<span class="sk" style="width:70px"></span>');
    else parts.push(u ? `<span class="tag warn">${u} update${u === 1 ? '' : 's'}</span>` : '<span class="tag ok">Up to date</span>');
    if (s === null) parts.push('<span class="sk" style="width:80px"></span>');
    else if (s) parts.push(`<span class="aux">${s} security</span>`);
    if (ph) parts.push(`<span class="aux">${ph} plugin</span>`);
    if (seo) parts.push(`<span class="aux">${seo} SEO</span>`);
    return `<div class="row clickable" role="button" tabindex="0" data-goto="checks" id="health-row"><dt>Health</dt><dd>${parts.join('<span class="sep"></span>')}</dd>${ICON.chev}</div>`;
  }

  // Re-render the parts that depend on update/deep-check results, keeping open rows open.
  function refreshHealthViews() {
    if (!report) return;
    const hr = $('health-row');
    if (hr) hr.outerHTML = healthRowHTML();
    renderSiteSub();
    renderHosting();
    renderChecks();
    const open = document.querySelector('#stack-rows [data-reveal]')?.getAttribute('aria-expanded') === 'true';
    renderOverview();
    if (open) toggleReveal(document.querySelector('#stack-rows [data-reveal]'), true);
    renderPlugins();
  }

  function renderSiteSub() {
    const d = report;
    // Nightly/RC builds report "7.2-RC2-65695"; the trailing build number only crowds the header.
    const shownVersion = String(d.version || '').replace(/-\d{4,}$/, '');
    const ver = known(d.version) ? `WordPress ${esc(shownVersion)}` : 'WordPress <span style="font-weight:400;color:var(--ink-3)">· version hidden</span>';
    // When core is behind, the update note replaces the confidence (still shown on the Evidence tab).
    const tail = coreOutdated() ? '<span class="upd-note">update available</span>' : `${esc(d.confidence || '')} confidence`;
    $('site-sub').innerHTML = `<span class="dot"></span><b>${ver}</b><span class="sep"></span>${tail}`;
  }

  const TECH_GROUPS = [['Analytics and tags', ['Analytics']], ['Libraries and fonts', ['Libraries', 'Fonts']], ['Widgets', ['Payments', 'Chat', 'Captcha', 'Cookie consent']]];
  function techHTML() {
    const tech = report.tech || [];
    if (!tech.length) return '<div class="grp"><div class="grp-h"><h2>Tech stack</h2></div><dl class="rows"><div class="row"><dt>Third-party</dt><dd><span class="aux">No tags, libraries or widgets detected</span></dd><span></span></div></dl></div>';
    return TECH_GROUPS.map(([title, cats]) => {
      const items = tech.filter((t) => cats.includes(t.category));
      if (!items.length) return '';
      return `<div class="grp"><div class="grp-h"><h2>${esc(title)}</h2></div><dl class="rows">${items.map((t) =>
        `<div class="row wide" title="${esc(t.evidence)}"><dt><span class="v">${esc(t.name)}</span>${t.version ? ` <span class="num">${esc(t.version)}</span>` : ''}</dt><dd>${t.detail ? `<span class="num clip">${esc(t.detail)}</span>` : `<span class="aux">${esc(t.category)}</span>`}</dd></div>`).join('')}</dl></div>`;
    }).join('');
  }

  // Reports from an older content script (still running in a tab after an update) lack
  // the SEO, tech-stack and security-header fields. Re-read them once by injecting the
  // current detector, so the Checks and Stack tabs aren't empty.
  async function fillMissingFields(tabId) {
    const r = report;
    if (!r || (r.seo && Array.isArray(r.tech) && r.securityHeaders !== undefined && r.languages !== undefined)) return;
    try {
      const out = await chrome.scripting.executeScript({ target: { tabId }, func: detectWordPress });
      const fresh = out && out[0] ? out[0].result : null;
      if (!fresh || report !== r) return;
      r.seo = fresh.seo || null;
      r.tech = fresh.tech || [];
      r.securityHeaders = fresh.securityHeaders === undefined ? null : fresh.securityHeaders;
      r.languages = fresh.languages || null;
      r.themeType = fresh.themeType || null;
      r.delivery = fresh.delivery || null;
      renderHosting();
      refreshHealthViews();
      notifyTabStatus(tabId, true, r.plugins.length, r);
    } catch (e) {}
  }

  // Popup-time checks: ask the content script; if it can't answer (missing, or an older
  // version still running in the tab after an update), inject deepChecks() directly.
  async function runDeepChecks(tabId) {
    const r = report;
    if (!r || r.deep) return;
    let data = null;
    try {
      const res = await messageTab(tabId, 'WP_DEEP_CHECKS');
      if (res && res.ok && res.data) data = res.data;
    } catch (e) {}
    if (!data) {
      try {
        const out = await chrome.scripting.executeScript({ target: { tabId }, func: deepChecks });
        data = out && out[0] ? out[0].result : null;
      } catch (e2) {}
    }
    if (report !== r) return;
    r.deep = data || { error: true };
    refreshHealthViews();
    if (data) notifyTabStatus(tabId, true, r.plugins.length, r);
  }

  // ------------------------------------------------------------------ report text / export
  function generateReportText() {
    const d = report;
    const t = themeInfo();
    const list = sortedPlugins(d.plugins);
    const line = (k, v) => `- **${k}:** ${v}`;
    const sigs = SIGNALS.map(([k, label]) => `- [${d.signals[k] && d.signals[k].detected ? 'x' : ' '}] ${label}`);
    return [
      `# ${hostOf(d.url)}`,
      '',
      d.pageTitle && d.pageTitle !== 'WordPress Site' ? `${d.pageTitle} · ${d.url}` : `${d.url}`,
      `WordPress ${known(d.version) ? d.version : '(version hidden)'} · ${d.confidence} confidence · ${d.signalScore}/7 signals${d.isUserLoggedIn ? ' · you are logged in' : ''}`,
      '',
      '## Stack',
      line('Theme', known(d.theme) ? `${t.name}${t.version ? ' ' + t.version : ''} (\`${d.theme}\`)${t.child ? ` · parent theme: ${formatThemeName(t.parent)}` : ''}` : 'Not detected'),
      line('Theme type', d.themeType ? (d.themeType.type === 'block' ? 'Block theme' : `Classic theme${d.themeType.themeJson ? ' (uses theme.json)' : ''}`) : 'Unknown'),
      line('Builder', d.pageBuilder || 'None detected'),
      line('Store', known(d.ecommerce) ? d.ecommerce : 'None'),
      ...(() => { const s = d.deep && d.deep.store; if (!s || !s.api || !s.currency) return [];
        return [line('Store currency', `${s.currency}${s.min !== null ? ` · prices ${fmtMoney(s, s.min)}${s.max !== null && s.max !== s.min ? ` – ${fmtMoney(s, s.max)}` : ''}` : ''}`)]; })(),
      ...(() => { const l = d.languages; if (!l) return [];
        const codes = l.hreflang && l.hreflang.length > 1 ? l.hreflang : l.lang ? [l.lang] : [];
        return [line('Translation', l.plugin || (codes.length > 1 ? 'plugin not identified' : 'none detected')), line('Languages', codes.length ? [...new Set(codes.map(langName))].join(', ') : 'not set')]; })(),
      line('Hosting', known(d.hostingPlatform) ? d.hostingPlatform : (known(d.proxyCDN) ? d.proxyCDN : 'Not identified')),
      line('Web server', known(d.serverSoftware) ? d.serverSoftware : 'Not exposed'),
      line('PHP', known(d.phpVersion) ? d.phpVersion.replace(/^PHP\//i, '') : 'Not exposed'),
      line('CDN / edge', known(d.proxyCDN) ? d.proxyCDN : 'None detected'),
      line('Page cache', known(d.cacheHeaderStatus) ? `${d.cacheHeaderStatus} (${d.cacheSystem})` : 'Not detected'),
      line('IP', d.ip || 'Unknown'),
      line('Network', d.isp || 'Unknown'),
      line('Location', stripFlag(d.location) || 'Unknown'),
      line('Nameservers', d.dns || 'Unknown'),
      '',
      `## Plugins (${list.length})`,
      ...list.map((p) => `- ${pluginName(p)} ${hasVersion(p) ? p.version : '(version unknown)'}${p.latest ? ` → ${p.latest} available` : ''} · \`${p.slug}\` · ${p.category}`),
      '',
      '## Updates',
      ...(() => {
        const out = [];
        if (coreOutdated()) out.push(`- WordPress ${d.version} → ${d._coreLatest}`);
        if (themeLatest()) out.push(`- Theme ${t.name} ${t.version} → ${themeLatest()}`);
        outdatedPlugins().forEach((p) => out.push(`- ${pluginName(p)} ${p.version} → ${p.latest}`));
        return out.length ? out : [updatesPending ? '- Still checking' : '- None found for the versions this page shows'];
      })(),
      '',
      '## Vulnerabilities',
      ...(() => {
        const m = vulnMatches();
        if (!m) return ['- Not checked (add a Wordfence or WPScan key in Settings)'];
        if (!m.length) return [`- None found (${srcNames(Object.keys(vuln.results).filter((k) => Array.isArray(vuln.results[k])))})`];
        return m.map((x) => `- ${x.name} ${x.version}: ${x.total} known (${x.hits.slice(0, 3).map((h) => `${h.title}${h.cve.length ? ` [${h.cve[0]}]` : ''}`).join('; ')}) · ${srcNames([...new Set(x.hits.flatMap((h) => h.sources))])}`);
      })(),
      '',
      '## Plugin health',
      ...(pluginIssues().length ? pluginIssues().map(([p, i]) => `- ${pluginName(p)}: ${i.text}`) : ['- No closed, stale or untested plugins found']),
      '',
      '## Performance (this visit)',
      ...perfItems().filter((i) => !i.pending).map((i) => `- ${i.label}: ${i.tag}${i.note ? ` (${i.note})` : ''}`),
      '',
      '## Content',
      ...(() => { const c = d.deep && !d.deep.error ? d.deep.content : null; const out = [];
        if (c) { out.push(`- Posts: ${c.posts ?? 'not public'}`, `- Pages: ${c.pages ?? 'not public'}`); if (c.latestPost) out.push(`- Latest post: ${c.latestPost.slice(0, 10)}`); if (c.products !== null && c.products !== undefined) out.push(`- Products: ${c.products}`); }
        out.push(`- Multisite: ${d.multisite ? `network site #${d.multisite.siteId}` : 'not detected'}`); return out; })(),
      '',
      '## Security',
      ...securityItems().filter((i) => !i.pending).map((i) => `- ${i.label}: ${i.tag}${i.note ? ` (${i.note.slice(0, 120)})` : ''}`),
      '',
      '## SEO',
      ...seoItems().filter((i) => !i.pending).map((i) => `- ${i.label}: ${i.tag}${i.note ? ` (${i.note.slice(0, 120)})` : ''}`),
      '',
      '## Tech stack',
      ...((d.tech && d.tech.length) ? d.tech.map((x) => `- ${x.name}${x.version ? ' ' + x.version : ''}${x.detail ? ` (${x.detail})` : ''} · ${x.category}`) : ['- No third-party tags, libraries or widgets detected']),
      '',
      '## Evidence',
      ...sigs,
      '',
      `_Scouted with WPScout${APP_VERSION ? ' ' + APP_VERSION : ''}_`
    ].join('\n');
  }

  function exportJSON() {
    const clean = { ...report };
    delete clean._wpTheme;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wpscout-${hostOf(report.url)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved ${a.download}`);
  }

  // ------------------------------------------------------------------ interactions
  function toggleReveal(trigger, force) {
    if (!trigger) return;
    const panel = trigger.nextElementSibling && trigger.nextElementSibling.classList.contains('reveal') ? trigger.nextElementSibling : null;
    if (!panel) return;
    const open = typeof force === 'boolean' ? force : trigger.getAttribute('aria-expanded') !== 'true';
    trigger.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open);
  }

  const menu = $('menu'), menuBtn = $('menu-btn');
  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const first = menu.querySelector('.mi:not(:disabled)'); if (first) first.focus(); }
  }

  function wire() {
    $('tabs').addEventListener('click', (e) => { const t = e.target.closest('.pp-tab'); if (t) selectTab(t.dataset.tab); });
    $('tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const tabs = [...document.querySelectorAll('.pp-tab')];
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.dataset.tab, true);
    });

    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#menu')) setMenu(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); }
      if (!menu.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = [...menu.querySelectorAll('.mi:not(:disabled)')];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    });

    $('rescan-btn').addEventListener('click', () => runDiagnostics(true));
    $('empty-rescan').addEventListener('click', () => runDiagnostics(true));
    $('copy-btn').addEventListener('click', () => { if (report) copyText(generateReportText(), 'Stack report copied'); });

    $('plugin-search').addEventListener('input', () => { if (report) renderPluginList(); });
    $('chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      activeCat = c.dataset.cat;
      $('chips').querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      renderPluginList();
    });

    document.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto) { selectTab(goto.dataset.goto); return; }

      const open = e.target.closest('[data-open]');
      if (open) { openUrl(open.dataset.open); return; }

      const cp = e.target.closest('[data-copy]');
      if (cp) { copyText(cp.dataset.copy, cp.dataset.copyMsg || 'Copied'); return; }

      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'theme') { toggleTheme(); setMenu(false); }
        if (a === 'export-json' && report) { exportJSON(); setMenu(false); }
        if (a === 'copy-plugins' && report) {
          const txt = sortedPlugins(report.plugins).map((p) => `${p.slug}${hasVersion(p) ? ' ' + p.version : ''}`).join('\n');
          copyText(txt, `${report.plugins.length} plugin slugs copied`);
          setMenu(false);
        }
        if (a === 'copy-theme' && report) {
          const t = themeInfo();
          copyText(`Theme: ${t.name}\nSlug: ${t.slug}\nVersion: ${t.version || 'Unknown'}\nAuthor: ${t.author || 'Unknown'}\nSite: ${report.url}`, 'Theme details copied');
        }
        if (a === 'reload-tab' && currentTab) { chrome.tabs.reload(currentTab.id); window.close(); }
        if (a === 'open-settings') { setMenu(false); openSettings(); }
        if (a === 'close-settings') closeSettings();
        if (a === 'save-key') saveVulnKey(act.dataset.provider);
        if (a === 'remove-key') removeVulnKey(act.dataset.provider);
        if (a === 'clear-search') { $('plugin-search').value = ''; renderPluginList(); $('plugin-search').focus(); }
        return;
      }

      const rev = e.target.closest('[data-reveal], .pl-main, .sig-main');
      if (rev && !rev.disabled) toggleReveal(rev);
    });

    document.addEventListener('keydown', (e) => {
      const r = e.target.closest && e.target.closest('[role="button"][data-reveal], [role="button"][data-goto]');
      if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); }
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeLabel);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeInk);
  }

  // ------------------------------------------------------------------ background messaging
  function notifyTabStatus(tabId, isWP, count = 0, data = null) {
    if (!hasChrome || !tabId || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try { chrome.runtime.sendMessage({ type: 'WP_STATUS', isWP, tabId, count, data }, () => void chrome.runtime.lastError); } catch (e) {}
  }

  function isInternal(url) {
    return !url || /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url) || /chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url);
  }

  // Ask the content script for its report. A normal open reuses the scan the page
  // already ran (or is running); Rescan forces a fresh one. A scan can take several
  // seconds on large sites, so the timeout is generous, and the script is only
  // re-injected when there is no listener at all (not when it is merely slow).
  const SCAN_TIMEOUT = 15000;
  function messageTab(tabId, type) {
    return Promise.race([
      chrome.tabs.sendMessage(tabId, { type }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SCAN_TIMEOUT))
    ]);
  }
  async function askContentScript(tabId, force) {
    const type = force ? 'WP_RESCAN' : 'GET_CONTENT_DATA';
    try {
      const res = await messageTab(tabId, type);
      return res && res.ok ? res.data : null;
    } catch (e) {
      if (e && e.message === 'timeout') throw new Error('The page took too long to answer. Reload it, then rescan.');
    }
    // No content script in this tab (opened before install/update): inject and retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const res = await messageTab(tabId, 'GET_CONTENT_DATA');
      if (res && res.ok) return res.data;
    } catch (e) {
      if (e && e.message === 'timeout') throw new Error('The page took too long to answer. Reload it, then rescan.');
    }
    const out = await chrome.scripting.executeScript({ target: { tabId }, func: detectWordPress });
    return out && out[0] ? out[0].result : null;
  }

  // ------------------------------------------------------------------ main flow
  async function runDiagnostics(force = false) {
    if (!hasChrome) return runPreview();
    let tab = null;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;
      if (!tab || isInternal(tab.url)) {
        if (tab && tab.id) notifyTabStatus(tab.id, false, 0);
        renderEmpty('internal', tab);
        return;
      }

      // 1. Cached report from the background worker: instant render.
      if (!force && chrome.storage && chrome.storage.session) {
        const key = 'report_' + tab.id;
        const res = await chrome.storage.session.get(key).catch(() => null);
        const cached = res && res[key];
        if (cached) {
          fromCache = true;
          if (!cached.isWP) { renderEmpty('nowp', tab); return; }
          renderReport(cached);
          enrichTheme();
          fillMissingFields(tab.id);
          runDeepChecks(tab.id);
          fillMissingFields(tab.id);
          runPerf(tab.id);
          if (!known(cached.ip) || cached.isp === undefined) {
            enrichNetwork(cached).then((d) => {
              if (report !== cached) return;
              refreshNetworkViews();
              notifyTabStatus(tab.id, true, d.plugins.length, d);
            }).catch(() => {});
          }
          return;
        }
      }

      // 2. Live scan.
      fromCache = false;
      report = null;
      renderLoading(tab);
      const data = await askContentScript(tab.id, force);
      if (!data || !data.isWP) {
        notifyTabStatus(tab.id, false, 0);
        renderEmpty('nowp', tab);
        return;
      }
      data.hostname = new URL(tab.url).hostname;
      renderReport(data);
      enrichTheme();
      fillMissingFields(tab.id);
      runDeepChecks(tab.id);
      fillMissingFields(tab.id);
      runPerf(tab.id);
      await enrichNetwork(data);
      if (report === data) refreshNetworkViews();
      notifyTabStatus(tab.id, true, data.plugins.length, data);
    } catch (e) {
      const msg = (e && e.message) || '';
      renderEmpty(/cannot access|permission|cannot be scripted|no tab with id/i.test(msg) ? 'reload' : 'error', tab, msg && !/^[A-Z][a-z]+Error/.test(msg) ? msg : '');
    } finally {
      $('rescan-btn').classList.remove('spinning');
      $('rescan-btn').disabled = !tab || isInternal(tab.url);
    }
  }

  function refreshNetworkViews() {
    const open = document.querySelector('#stack-rows [data-reveal]')?.getAttribute('aria-expanded') === 'true';
    const hostRow = document.querySelector('#stack-rows [data-goto="hosting"] dd');
    if (hostRow) hostRow.innerHTML = hostingSummaryHTML();
    renderHosting();
    $('foot-when').textContent = fromCache ? 'Cached result for this tab' : 'Scanned just now';
    if (open) toggleReveal(document.querySelector('#stack-rows [data-reveal]'), true);
  }

  // Standalone preview (popup.html opened directly in a browser tab).
  // Hash options: #plugins / #hosting / #evidence, plus ,dark ,light ,loading ,empty ,internal
  function runPreview() {
    const opts = (location.hash || '').replace('#', '').split(/[,&]/).filter(Boolean);
    if (opts.includes('dark')) applyTheme('dark');
    if (opts.includes('light')) applyTheme('light');
    const fake = { url: 'https://example.com/', title: 'New Tab' };
    if (opts.includes('loading')) { renderLoading({ url: 'https://www.nasa.gov/' }); return; }
    if (opts.includes('empty')) { renderEmpty('nowp', fake); return; }
    if (opts.includes('internal')) { renderEmpty('internal', { url: 'chrome://newtab/', title: 'New Tab' }); return; }
    fromCache = true;
    const data = getSampleMockData();
    renderReport(data, { tab: opts.find((o) => PANES.includes(o)) });
    report._wpTheme = null;
    if (!opts.includes('no-deep')) report.deep = SAMPLE_DEEP;
    try { report.perf = readPerf(); } catch (e) { report.perf = null; }
    if (opts.includes('vulns')) {
      // Sample: the same Kirki issue from two providers counts once; WPScan button still offered.
      vuln = { loaded: true, items: vulnQueryItems(),
        status: { wordfence: { hasKey: true, permission: true }, wpscan: { hasKey: true, permission: true } },
        results: {
          wordfence: [{ type: 'plugin', slug: 'kirki', version: '5.1.0', hits: [
            { title: 'Kirki <= 5.1.0 - Missing Authorization to Settings Update', score: 5.3, rating: 'Medium', cve: ['CVE-2026-0001'], patched: ['5.1.1'], published: '2026-09-14', url: 'https://www.wordfence.com/threat-intel/vulnerabilities/id/0000-sample' },
            { title: 'Kirki <= 5.0.9 - Reflected Cross-Site Scripting', score: 6.1, rating: 'Medium', cve: ['CVE-2026-0002'], patched: ['5.1.0'], published: '2026-06-02', url: 'https://www.wordfence.com/threat-intel/vulnerabilities/id/0001-sample' }] }],
          wpscan: [
            { type: 'plugin', slug: 'kirki', version: '5.1.0', hits: [{ title: 'Kirki < 5.1.1 - Broken Access Control', score: 5.3, rating: 'Medium', cve: ['CVE-2026-0001'], patched: ['5.1.1'], url: 'https://wpscan.com/vulnerability/sample-1' }] },
            { type: 'plugin', slug: 'popup-maker', version: '1.25.0', hits: [{ title: 'Popup Maker <= 1.25.0 - Stored XSS via shortcode', score: 6.4, rating: 'Medium', cve: [], patched: [], published: '2026-10-30', url: 'https://wpscan.com/vulnerability/sample-2' }] }]
        } };
    }
    refreshHealthViews();
    if (opts.includes('vuln-open')) setTimeout(() => { const r = document.querySelector('#pane-checks .vrow'); toggleReveal(r, true); r.scrollIntoView({ block: 'start' }); }, 300);
    if (opts.includes('theme-open')) toggleReveal(document.querySelector('#stack-rows [data-reveal]'), true);
    if (opts.includes('plugin-open')) { const b = document.querySelector('#plugins-list .pl-main'); toggleReveal(b, true); }
    if (opts.includes('menu')) setTimeout(() => setMenu(true), 50);
    if (opts.includes('signal-open')) toggleReveal(document.querySelector('#pane-evidence .sig-main'), true);
    if (opts.includes('scroll-end')) setTimeout(() => { $('body').scrollTop = 1e6; }, 4000);
  }

  // Sample popup-time check results, used only by the standalone preview.
  const SAMPLE_DEEP = {
    checkedAt: 0,
    xmlrpc: { status: 405, enabled: true },
    users: { status: 200, exposed: true, list: ['admin', 'editor'] },
    readme: { status: 404, exposed: false, version: '' },
    uploadsListing: { status: 403, exposed: false },
    debugLog: { status: 404, exposed: false },
    sitemap: { found: true, path: '/wp-sitemap.xml' },
    robots: { found: true, sitemapLine: true, disallowAll: false },
    content: { posts: 1824, pages: 96, products: 412, latestPost: '2026-11-20T10:00:00' },
    store: { api: true, currency: 'USD', symbol: '$', prefix: '$', suffix: '', minor: 2, min: 4.99, max: 249 },
    login: { state: 'redirected', status: 200, path: '/' },
    llmsTxt: { found: true, title: 'NASA' },
    adsTxt: { found: false, status: 404 },
    securityTxt: { found: true, contacts: ['https://www.nasa.gov/vulnerability-disclosure-policy/'], expires: '2027-06-30T00:00:00Z', expired: false }
  };

  // Sample report used only by the standalone preview.
  function getSampleMockData() {
    return {
      isWP: true,
      pageTitle: 'NASA',
      faviconUrl: 'https://www.nasa.gov/wp-content/themes/nasa/assets/images/favicon.ico',
      url: 'https://www.nasa.gov/',
      origin: 'https://www.nasa.gov',
      protocol: 'https:',
      version: '7.0.8',
      theme: 'nasa',
      themeVersion: '1.1.1',
      themeAuthor: 'Lone Rock Point',
      themeStylesheet: 'https://www.nasa.gov/wp-content/themes/nasa/style.css',
      isChildTheme: false,
      parentTheme: '',
      isUserLoggedIn: false,
      pageBuilder: 'Gutenberg (Block Editor)',
      hasGutenberg: true,
      hostingPlatform: 'WordPress VIP',
      ecommerce: 'WooCommerce',
      themeType: { type: 'classic', themeJson: true, evidence: 'No block template wrapper; theme.json layout settings in global styles' },
      languages: { plugin: 'WPML', hreflang: ['en-US', 'es', 'fr', 'de'], xDefault: true, lang: 'en-US' },
      delivery: { encoding: 'br', cacheControl: 'max-age=300, s-maxage=3600', age: '128', serverTiming: 'wp;dur=212.4, db;desc="Database";dur=48.1', expires: '', lastModified: '' },
      serverSoftware: 'nginx/1.26.1',
      proxyCDN: 'WordPress VIP (Automattic)',
      phpVersion: 'PHP/8.2.30',
      cacheSystem: 'Server Cache',
      cacheHeaderStatus: 'HIT',
      cacheDetail: 'x-cache: HIT',
      ip: '192.0.66.108',
      isp: 'Automattic, Inc',
      location: '🇺🇸 San Francisco, California, US',
      dns: 'a12-64.akam.net, a5-66.akam.net',
      confidence: '98%',
      signalScore: 7,
      signals: {
        api: { id: 'sig-api', detected: true, detail: 'https://www.nasa.gov/wp-json (24 namespaces)' },
        linkHeader: { id: 'sig-link-header', detected: true, detail: '<https://www.nasa.gov/wp-json/>; rel="https://api.w.org/"' },
        generator: { id: 'sig-generator', detected: true, detail: '<meta name="generator" content="WordPress 7.0.8">' },
        wpContent: { id: 'sig-wp-content', detected: true, count: 42, detail: '42 assets found in /wp-content/' },
        wpIncludes: { id: 'sig-wp-includes', detected: true, count: 18, detail: '18 assets found in /wp-includes/' },
        linkRel: { id: 'sig-link-rel', detected: true, detail: '<link rel="https://api.w.org/" href="https://www.nasa.gov/wp-json/">' },
        adminPaths: { id: 'sig-admin-paths', detected: true, detail: 'Verified public login endpoint /wp-login.php' }
      },
      plugins: [
        { slug: 'tutor', name: 'Tutor LMS – eLearning and online course solution', version: '4.2.0', category: 'LMS', sourceTag: 'URL', evidence: 'http://tutorlms.wp/wp-content/plugins/tutor/assets/js/tutor.front.js' },
        { slug: 'tutor-pro', name: 'Tutor LMS Pro', version: '4.2.0', category: 'LMS', sourceTag: 'URL', evidence: 'http://tutorlms.wp/wp-content/plugins/tutor-pro/assets/js/tutor-pro.js' },
        { slug: 'kirki', name: 'Kirki Customizer Framework', version: '5.1.0', category: 'Framework', sourceTag: 'API', evidence: 'http://tutorlms.wp/wp-json/kirki/v1' },
        { slug: 'accessibility-checker', name: 'Equalize Digital Accessibility Checker – WCAG, ADA, Section 508', version: '1.51.1', category: 'Accessibility', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/accessibility-checker/assets/js/frontend.js' },
        { slug: 'gravityforms', name: 'Gravityforms', version: '2.8.6', category: 'Forms', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/gravityforms/js/gravityforms.min.js' },
        { slug: 'gravity-forms-config', name: 'Gravity Forms Config', version: '', category: 'Forms', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/gravity-forms-config/config.js' },
        { slug: 'nasa-blocks', name: 'Nasa Blocks', version: '', category: 'Blocks', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/nasa-blocks/build/index.js' },
        { slug: 'nasa-hds-core-setup', name: 'Nasa Hds Core Setup', version: '', category: 'Plugin', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/nasa-hds-core-setup/setup.js' },
        { slug: 'popup-maker', name: 'Popup Maker – Boost Sales, Conversions, Optins, Popups', version: '1.25.0', category: 'Forms', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/popup-maker/assets/js/site.min.js' },
        { slug: 'schema-pro', name: 'Schema Pro', version: 'REST API', category: 'Schema', sourceTag: 'DOM', evidence: 'https://www.nasa.gov/wp-json/schema-pro/v1' },
        { slug: 'seo-by-rank-math', name: 'Rank Math SEO – AI SEO Tools to Dominate SEO Rankings', version: '1.0.280', category: 'SEO', sourceTag: 'API', evidence: 'https://www.nasa.gov/wp-json/rankmath/v1' },
        { slug: 'wp-parsely', name: 'Parse.ly Analytics', version: '3.14.0', category: 'Analytics', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/wp-parsely/build/loader.js' },
        { slug: 'litespeed-cache', name: 'LiteSpeed Cache', version: '6.2.0.1', category: 'Cache', sourceTag: 'HEADER', evidence: 'x-litespeed-cache: hit' },
        { slug: 'wp-optimize', name: 'WP-Optimize', version: '3.7.0', category: 'Cache', sourceTag: 'DOM', evidence: '<!-- Cached by WP-Optimize -->' },
        { slug: 'wordfence', name: 'Wordfence Security', version: '7.11.5', category: 'Security', sourceTag: 'API', evidence: 'https://www.nasa.gov/wp-json/wordfence/v1' },
        { slug: 'safe-svg', name: 'Safe SVG', version: '2.2.4', category: 'Plugin', sourceTag: 'URL', evidence: 'https://www.nasa.gov/wp-content/plugins/safe-svg/assets/safe-svg.js' },
        { slug: 'contact-form-7', name: 'Contact Form 7', version: '5.9.5', category: 'Forms', sourceTag: 'API', evidence: 'https://www.nasa.gov/wp-json/contact-form-7/v1' }
      ]
    };
  }


  // ------------------------------------------------------------------ boot
  applyTheme(storedTheme());
  $('app-version').textContent = APP_VERSION ? `WPScout ${APP_VERSION}` : 'WPScout';
  wire();
  runDiagnostics();
})();
