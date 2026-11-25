// ==========================================================================
// WPScout - Background Service Worker & Prefetch Manager
// - Real-time toolbar badge with detected plugin count (e.g. 19, 23, 7)
// - Dynamic action icon switching (Active Blue vs Dimmed Slate)
// - High-speed session caching for instant 0ms popup load
// - Background DNS, IP, ISP and Geolocation resolution
// ==========================================================================

const ICONS_ACTIVE = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png'
};

const ICONS_DIMMED = {
  16: 'icons/icon-dim-16.png',
  32: 'icons/icon-dim-32.png',
  48: 'icons/icon-dim-48.png',
  128: 'icons/icon-dim-128.png'
};

// In-memory caches (tabId -> data)
const tabReports = new Map();
const wpTabs = new Map();

// Per-host DNS / ISP lookups and per-origin REST API indexes, so browsing a site
// doesn't repeat the same network calls on every page view.
const HOST_TTL = 60 * 60 * 1000;
const REST_TTL = 30 * 60 * 1000;
const hostCache = new Map();   // hostname -> { t, ip, dns, isp, location }
const restCache = new Map();   // origin -> { t, data }
function cacheGet(map, key, ttl) {
  const e = map.get(key);
  if (!e) return undefined;
  if (Date.now() - e.t > ttl) { map.delete(key); return undefined; }
  return e;
}
function cacheSet(map, key, value, max = 100) {
  map.delete(key);
  map.set(key, { t: Date.now(), ...value });
  while (map.size > max) map.delete(map.keys().next().value);
}

// Restore session state when service worker wakes up from idle
if (chrome.storage && chrome.storage.session) {
  chrome.storage.session.get(null).then((items) => {
    if (items) {
      for (const [key, val] of Object.entries(items)) {
        if (key.startsWith('tab_wp_')) {
          const id = parseInt(key.replace('tab_wp_', ''), 10);
          if (id && val) wpTabs.set(id, true);
        } else if (key.startsWith('report_')) {
          const id = parseInt(key.replace('report_', ''), 10);
          if (id && val) {
            tabReports.set(id, val);
            const count = (val.plugins && val.plugins.length) || 0;
            updateTabBadge(id, count, Boolean(val.isWP));
          }
        }
      }
    }
  }).catch(() => {});
}

// Check if a URL is an internal or non-inspectable browser page
function isInternalUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:')
  );
}

// Update toolbar action icon, badge count, and tooltip for a tab
function updateTabBadge(tabId, pluginCount, isWP) {
  if (!tabId || tabId <= 0) return;

  const countStr = isWP ? (pluginCount > 0 ? String(pluginCount) : 'WP') : '';
  const title = isWP
    ? `WPScout - WordPress Detected (${pluginCount} ${pluginCount === 1 ? 'Plugin' : 'Plugins'})`
    : 'WPScout - Scout Any WordPress Website (Non-WordPress Site)';

  // Always keep the crisp brand blue icon active
  chrome.action.setIcon({ tabId, path: ICONS_ACTIVE }).catch(() => {});
  chrome.action.setTitle({ tabId, title }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: countStr }).catch(() => {});

  if (isWP) {
    // Black with white text, matching the black-and-white W badge icon.
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#14171B' }).catch(() => {});
    try {
      chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }).catch(() => {});
    } catch (e) {}

    wpTabs.set(tabId, true);
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({ [`tab_wp_${tabId}`]: true }).catch(() => {});
    }
  } else {
    wpTabs.delete(tabId);
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(`tab_wp_${tabId}`).catch(() => {});
    }
  }
}

// Legacy alias
function updateTabIcon(tabId, isWP) {
  const report = tabReports.get(tabId);
  const count = (report && report.plugins && report.plugins.length) || 0;
  updateTabBadge(tabId, count, isWP);
}

// Fast fetch with timeout helper
function fetchWithTimeout(resource, options = {}, timeout = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(id));
}

// Network Helpers for background enrichment
async function getHostIP(hostname) {
  try {
    const res = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {}, 3000);
    const data = await res.json();
    if (data.Answer && data.Answer.length > 0) {
      return data.Answer.map(a => a.data).find(ip => ip.match(/^[0-9.]+$/)) || 'Unknown';
    }
  } catch (e) {}
  return 'Unknown';
}

async function getNameservers(hostname) {
  try {
    const parts = hostname.split('.');
    let apex = hostname;
    if (parts.length > 2) apex = parts.slice(-2).join('.');
    const res = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(apex)}&type=NS`, {}, 3000);
    const data = await res.json();
    if (data.Answer && data.Answer.length > 0) {
      return data.Answer.map(a => a.data.replace(/\.$/, '')).slice(0, 2).join(', ');
    }
  } catch (e) {}
  return 'Unknown';
}

async function getISPAndLocation(ip) {
  if (!ip || ip === 'Unknown' || ip.startsWith('127.') || ip === 'localhost') {
    return { isp: 'Localhost / Private', location: 'Internal Network' };
  }
  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, {}, 3000);
    const data = await res.json();
    if (data && data.success) {
      const flag = data.flag && data.flag.emoji ? `${data.flag.emoji} ` : '';
      const loc = [data.city, data.region, data.country_code].filter(Boolean).join(', ');
      return {
        isp: data.connection && data.connection.isp ? data.connection.isp : 'Unknown',
        location: `${flag}${loc}`
      };
    }
  } catch (e) {}
  return { isp: 'Unknown', location: 'Unknown' };
}

// Background enrichment & session storage
async function enrichAndSaveReport(tabId, data) {
  if (!tabId || tabId <= 0 || !data) return;

  if (!data.isWP) {
    updateTabBadge(tabId, 0, false);
    const nonWpPayload = { isWP: false, url: data.url };
    tabReports.set(tabId, nonWpPayload);
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({ [`report_${tabId}`]: nonWpPayload }).catch(() => {});
    }
    return;
  }

  const pluginCount = (data.plugins && data.plugins.length) || 0;
  updateTabBadge(tabId, pluginCount, true);

  // 1. Immediately cache initial DOM data so popup opens in 0ms
  tabReports.set(tabId, data);
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ [`report_${tabId}`]: data }).catch(() => {});
  }

  // 2. Background DNS & Geo lookup if not already resolved
  if (!data.ip || data.ip === 'Unknown') {
    try {
      const urlObj = new URL(data.url);
      const hostname = urlObj.hostname;
      data.hostname = hostname;

      let net = cacheGet(hostCache, hostname, HOST_TTL);
      if (!net) {
        const [ip, ns] = await Promise.all([
          getHostIP(hostname),
          getNameservers(hostname)
        ]);
        const geo = await getISPAndLocation(ip);
        net = { ip, dns: ns, isp: geo.isp, location: geo.location };
        if (ip !== 'Unknown') cacheSet(hostCache, hostname, net);
      }
      data.ip = net.ip;
      data.dns = net.dns;
      data.isp = net.isp;
      data.location = net.location;

      // Update cache with full network details
      tabReports.set(tabId, data);
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.set({ [`report_${tabId}`]: data }).catch(() => {});
      }
    } catch (e) {}
  }
}

// Proactively verify WordPress status of a tab
function checkTab(tabId, url) {
  if (!tabId || tabId <= 0 || isInternalUrl(url)) return;

  chrome.tabs.sendMessage(tabId, { type: 'WP_CHECK' }, (res) => {
    if (chrome.runtime.lastError) {
      // Content script may not have been injected yet (e.g. existing tab before install/update)
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).catch(() => {});
    } else if (res && res.isWP) {
      // Ask content script for full scan payload
      chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_DATA' }, (scanRes) => {
        if (scanRes && scanRes.ok && scanRes.data) {
          enrichAndSaveReport(tabId, scanRes.data);
        } else {
          updateTabBadge(tabId, 0, true);
        }
      });
    }
  });
}

// 1. Listen for detection reports from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  // Content scripts are identified by Chrome (sender.tab); only the popup passes tabId.
  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  if (message.type === 'REST_CACHE_GET') {
    const e = message.origin && cacheGet(restCache, message.origin, REST_TTL);
    sendResponse(e ? { hit: true, data: e.data } : { hit: false });
    return;
  }

  if (message.type === 'REST_CACHE_SET') {
    if (message.origin && sender && sender.tab) cacheSet(restCache, message.origin, { data: message.data || null }, 50);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'WP_PREFETCH_DATA') {
    if (tabId) {
      enrichAndSaveReport(tabId, message.data);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'WP_STATUS') {
    if (tabId) {
      const count = message.count || 0;
      updateTabBadge(tabId, count, Boolean(message.isWP));
      if (message.data) {
        enrichAndSaveReport(tabId, message.data);
      }
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'GET_REPORT') {
    const report = (tabId && tabReports.get(tabId)) || null;
    sendResponse({ report });
    return;
  }
});

// 2. Navigation & Update monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    if (isInternalUrl(changeInfo.url)) {
      updateTabBadge(tabId, 0, false);
      return;
    }
    // Navigating to new URL: clear badge until scan completes
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    tabReports.delete(tabId);
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove([`report_${tabId}`, `tab_wp_${tabId}`]).catch(() => {});
    }
  }

  // When page completes loading, re-assert or verify
  if (changeInfo.status === 'complete' && tab && tab.url && !isInternalUrl(tab.url)) {
    if (tabReports.has(tabId)) {
      const r = tabReports.get(tabId);
      const count = (r.plugins && r.plugins.length) || 0;
      updateTabBadge(tabId, count, Boolean(r.isWP));
    } else {
      checkTab(tabId, tab.url);
    }
  }
});

// 3. Tab switch activation monitoring
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  if (!tabId) return;

  const report = tabReports.get(tabId);
  if (report) {
    const count = (report.plugins && report.plugins.length) || 0;
    updateTabBadge(tabId, count, Boolean(report.isWP));
  } else {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && !isInternalUrl(tab.url)) {
        checkTab(tabId, tab.url);
      }
    } catch (e) {}
  }
});

// 4. Tab cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  wpTabs.delete(tabId);
  tabReports.delete(tabId);
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove([`tab_wp_${tabId}`, `report_${tabId}`]).catch(() => {});
  }
});

// 5. Global initialization on install or extension update
chrome.runtime.onInstalled.addListener(async (details) => {
  // First install: open the popup so the welcome screen greets the user (Chrome 127+; needs a
  // focused window, so it quietly does nothing otherwise and the welcome shows on first open).
  // Updates: people who already use WPScout skip the welcome.
  try {
    const key = 'wpscout_onboard';
    const cur = (await chrome.storage.local.get(key))[key];
    if (details && details.reason === 'install') {
      if (!cur && chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
    } else if (details && details.reason === 'update' && !cur) {
      await chrome.storage.local.set({ [key]: { welcomed: true, scans: 0, review: 'pending', askAt: 10 } });
    }
  } catch (e) {}

  chrome.action.setIcon({ path: ICONS_ACTIVE }).catch(() => {});
  chrome.action.setTitle({ title: 'WPScout - Scout Any WordPress Website' }).catch(() => {});
  chrome.action.setBadgeText({ text: '' }).catch(() => {});

  // Inspect existing open tabs immediately on install/reload
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        checkTab(tab.id, tab.url);
      }
    }
  } catch (e) {}
});

// ==========================================================================
// Known vulnerabilities (optional, bring-your-own Wordfence Intelligence key)
// The feed is downloaded at most once a day into IndexedDB and matched locally:
// no site data is ever sent to Wordfence. Needs the optional wordfence.com
// host permission, which the popup requests only when the user adds a key.
// ==========================================================================
const WF_ORIGIN = 'https://www.wordfence.com/*';
const WF_FEED = 'https://www.wordfence.com/api/intelligence/v3/vulnerabilities/scanner';
const WF_MAX_AGE = 24 * 3600 * 1000;
let wfRefreshing = null;
let wfLastError = '';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wpscout', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = () => resolve(true); t.onerror = () => resolve(false); });
}

// Same comparison the popup uses: numeric segments, pre-releases sort first.
function cmpVersion(a, b) {
  const parse = (v) => { const m = String(v || '').trim().match(/^(\d+(?:\.\d+)*)(.*)$/); return m ? { n: m[1].split('.').map((x) => parseInt(x, 10) || 0), pre: /^[-.]?(alpha|beta|rc|dev|pre)/i.test(m[2]) } : { n: [0], pre: false }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) { const d = (x.n[i] || 0) - (y.n[i] || 0); if (d) return d < 0 ? -1 : 1; }
  if (x.pre !== y.pre) return x.pre ? -1 : 1;
  return 0;
}

// Turn the Wordfence feed (an object keyed by vulnerability id, or an array) into
// { plugin: Map(slug → [entry]), theme: Map, core: Map }. Maps, not plain objects, so
// slugs such as "constructor" or "__proto__" can't collide with Object.prototype.
function indexFeed(feed) {
  const index = { plugin: new Map(), theme: new Map(), core: new Map() };
  let count = 0;
  const list = Array.isArray(feed) ? feed : Object.values(feed || {});
  for (const v of list) {
    if (!v || !Array.isArray(v.software)) continue;
    for (const sw of v.software) {
      const type = sw.type === 'core' ? 'core' : sw.type === 'theme' ? 'theme' : sw.type === 'plugin' ? 'plugin' : null;
      if (!type || !sw.slug) continue;
      const ranges = Object.values(sw.affected_versions || {}).map((r) => [r.from_version ?? '*', r.from_inclusive !== false, r.to_version ?? '*', r.to_inclusive !== false]);
      if (!ranges.length) continue;
      const entry = {
        id: v.id || '', title: String(v.title || '').slice(0, 200), published: String(v.published || '').slice(0, 10),
        score: v.cvss && typeof v.cvss.score === 'number' ? v.cvss.score : null,
        rating: (v.cvss && v.cvss.rating) || '', cve: v.cve || '',
        ranges, patched: Array.isArray(sw.patched_versions) ? sw.patched_versions.slice(0, 4) : []
      };
      const slug = String(sw.slug).toLowerCase();
      const bucket = index[type];
      if (!bucket.has(slug)) bucket.set(slug, []);
      bucket.get(slug).push(entry);
      count++;
    }
  }
  return { index, count };
}

function inRange(version, [from, fromIncl, to, toIncl]) {
  const lo = from === '*' || (fromIncl ? cmpVersion(version, from) >= 0 : cmpVersion(version, from) > 0);
  const hi = to === '*' || (toIncl ? cmpVersion(version, to) <= 0 : cmpVersion(version, to) < 0);
  return lo && hi;
}

async function wfStatus() {
  const { wf_key: key } = await chrome.storage.local.get('wf_key');
  const permission = await chrome.permissions.contains({ origins: [WF_ORIGIN] }).catch(() => false);
  const meta = (await idbGet('wf_meta')) || null;
  const fail = (await idbGet('wf_fail')) || null;
  return { hasKey: !!key, permission, updated: meta ? meta.updated : 0, count: meta ? meta.count : 0, refreshing: !!wfRefreshing,
    error: wfLastError || (fail && fail.error) || '', retryAt: fail && fail.retryAt > Date.now() ? fail.retryAt : 0 };
}

async function wfRefresh(force = false) {
  if (wfRefreshing) return wfRefreshing;
  wfRefreshing = (async () => {
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);  // keep the worker up during a long download
    try {
      const { wf_key: key } = await chrome.storage.local.get('wf_key');
      if (!key) throw new Error('No Wordfence API key set');
      if (!(await chrome.permissions.contains({ origins: [WF_ORIGIN] }))) throw new Error('WPScout doesn’t have permission to reach wordfence.com');
      const meta = await idbGet('wf_meta');
      if (!force && meta && Date.now() - meta.updated < WF_MAX_AGE) return;
      // Back off after a failure, even across worker restarts, so popups don't hammer the feed.
      const fail = await idbGet('wf_fail');
      if (fail && fail.retryAt > Date.now() && !(force && fail.status !== 429)) return;
      const res = await fetch(WF_FEED, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) {
        const err = new Error(res.status === 401 || res.status === 403 ? 'Wordfence rejected the API key'
          : res.status === 429 ? 'Wordfence is limiting downloads for this key' : `Wordfence answered ${res.status}`);
        err.status = res.status;
        const ra = parseInt(res.headers.get('retry-after') || '', 10);
        err.wait = res.status === 429 ? Math.max(ra > 0 ? ra * 1000 : 0, 3600 * 1000) : 15 * 60 * 1000;
        throw err;
      }
      const { index, count } = indexFeed(await res.json());
      if (!count) throw new Error('The Wordfence feed came back empty or in an unknown format');
      await idbSet('wf_index', index);
      await idbSet('wf_meta', { updated: Date.now(), count });
      await idbSet('wf_fail', null);
      wfLastError = '';
    } catch (e) {
      wfLastError = (e && e.message) || 'Download failed';
      await idbSet('wf_fail', { error: wfLastError, status: (e && e.status) || 0, retryAt: Date.now() + ((e && e.wait) || 15 * 60 * 1000) }).catch(() => {});
    } finally {
      clearInterval(keepAlive);
      wfRefreshing = null;
    }
  })();
  return wfRefreshing;
}

async function wfLookup(items) {
  const index = await idbGet('wf_index');
  if (!index) return null;
  const out = [];
  for (const it of items || []) {
    const bucket = index[it.type];
    const list = bucket instanceof Map ? bucket.get(String(it.slug || '').toLowerCase()) : null;
    if (!Array.isArray(list) || !it.version) continue;
    const hits = list.filter((e) => e.ranges.some((r) => inRange(it.version, r)));
    if (hits.length) {
      hits.sort((a, b) => (b.score || 0) - (a.score || 0));
      out.push({ type: it.type, slug: it.slug, version: it.version, hits: hits.slice(0, 30), total: hits.length });
    }
  }
  return out;
}

// ---- WPScan: looks up one product at a time with the user's own token.
// GET plugins/{slug}, themes/{slug}, wordpresses/{digits}, header "Authorization: Token token=…".
// WPScan's terms don't allow caching its data, so nothing is stored; each popup open asks again.
// After a 429 (daily limit used up) it waits until the next UTC day.
const PROVIDERS = {
  wordfence: { key: 'wf_key', origin: WF_ORIGIN, label: 'Wordfence' },
  wpscan: { key: 'wps_key', origin: 'https://wpscan.com/*', label: 'WPScan' }
};
const WPS_API = 'https://wpscan.com/api/v3/';
const providerErrors = { wpscan: '' };

function ratingFor(score) {
  if (typeof score !== 'number') return '';
  return score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : score > 0 ? 'Low' : 'None';
}
const cveList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((c) => String(c).trim()).filter(Boolean).map((c) => (/^cve-/i.test(c) ? c.toUpperCase() : `CVE-${c}`));

async function providerState(name) {
  const p = PROVIDERS[name];
  const got = await chrome.storage.local.get(p.key);
  const permission = await chrome.permissions.contains({ origins: [p.origin] }).catch(() => false);
  return { key: got[p.key] || '', permission };
}

async function fetchJSON(url, headers, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    return { status: res.status, json: res.ok ? await res.json().catch(() => null) : null };
  } finally { clearTimeout(timer); }
}

function httpError(label, status) {
  if (status === 401 || status === 403) return `${label} rejected the API key`;
  if (status === 429) return `${label}’s request limit for this key is used up`;
  return `${label} answered ${status}`;
}

async function wpscanLookup(items) {
  const { key, permission } = await providerState('wpscan');
  if (!key || !permission) return { matches: null, error: 'WPScan isn’t set up', calls: 0 };
  const fail = await idbGet('wps_fail');
  if (fail && fail.retryAt > Date.now()) return { matches: null, error: fail.error, retryAt: fail.retryAt, calls: 0 };
  const out = [];
  let error = '', calls = 0;
  for (const it of items.slice(0, 25)) {  // one at a time, so a used-up limit stops the rest
    const path = it.type === 'core' ? `wordpresses/${String(it.version).replace(/\D/g, '')}`
      : `${it.type === 'theme' ? 'themes' : 'plugins'}/${encodeURIComponent(String(it.slug || '').toLowerCase())}`;
    let r;
    try { r = await fetchJSON(WPS_API + path, { Authorization: `Token token=${key}` }); calls++; }
    catch (e) { error = 'Couldn’t reach WPScan'; break; }
    if (r.status === 404) continue;
    if (r.status !== 200 || !r.json) { error = httpError('WPScan', r.status); if (r.status === 401 || r.status === 403 || r.status === 429) break; continue; }
    const body = Object.values(r.json).find((x) => x && Array.isArray(x.vulnerabilities));
    if (!body) continue;
    const hits = body.vulnerabilities.filter((v) => {
      if (it.type === 'core') return true;  // WPScan lists only the issues for that exact core version
      const from = v.introduced_in ? cmpVersion(it.version, v.introduced_in) >= 0 : true;
      const to = v.fixed_in ? cmpVersion(it.version, v.fixed_in) < 0 : true;
      return from && to;
    }).map((v) => {
      const score = v.cvss && v.cvss.score != null ? parseFloat(v.cvss.score) : null;
      const sev = v.cvss && v.cvss.severity ? String(v.cvss.severity) : '';
      return { id: String(v.id || ''), title: String(v.title || '').slice(0, 200), score: Number.isFinite(score) ? score : null,
        rating: sev ? sev[0].toUpperCase() + sev.slice(1).toLowerCase() : ratingFor(score),
        cve: cveList(v.references && v.references.cve), patched: v.fixed_in ? [String(v.fixed_in)] : [], source: 'wpscan',
        published: String(v.published_date || v.created_at || '').slice(0, 10),
        url: /^[A-Za-z0-9-]{4,64}$/.test(String(v.id || '')) ? `https://wpscan.com/vulnerability/${v.id}` : '' };
    });
    if (hits.length) out.push({ type: it.type, slug: it.slug, version: it.version, hits });
  }
  providerErrors.wpscan = error;
  if (/limit/.test(error)) {
    const d = new Date(); const retryAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    await idbSet('wps_fail', { error, retryAt }).catch(() => {});
    return { matches: error && !out.length ? null : out, error, retryAt, calls };
  }
  return { matches: error && !out.length && !calls ? null : out, error, calls };
}

async function allStatus() {
  const wf = await wfStatus();
  const wps = await providerState('wpscan');
  return {
    wordfence: wf,
    wpscan: { hasKey: !!wps.key, permission: wps.permission, error: providerErrors.wpscan, retryAt: ((await idbGet('wps_fail')) || {}).retryAt || 0 }
  };
}

// When the user grants a provider's permission, save the key the popup handed over and start.
// The popup has usually closed by now (the permission prompt takes its focus).
async function onProviderPermissionAdded(perms) {
  const origins = (perms && perms.origins) || [];
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (!origins.includes(p.origin)) continue;
    const pk = p.key + '_pending';
    const pending = (await chrome.storage.local.get(pk))[pk];
    if (!pending) continue;
    await chrome.storage.local.set({ [p.key]: pending });
    await chrome.storage.local.remove(pk);
    if (name === 'wordfence') { await idbSet('wf_fail', null); wfLastError = ''; wfRefresh(true); }
    else { providerErrors[name] = ''; await idbSet('wps_fail', null); }
  }
}
chrome.permissions.onAdded.addListener((perms) => { onProviderPermissionAdded(perms).catch(() => {}); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.tab) return;  // popup only
  const provider = PROVIDERS[message.provider] ? message.provider : 'wordfence';
  if (message.type === 'VULN_STATUS') { allStatus().then(sendResponse); return true; }
  if (message.type === 'VULN_PENDING_KEY') {
    const pk = PROVIDERS[provider].key + '_pending';
    (message.key ? chrome.storage.local.set({ [pk]: String(message.key).trim() }) : chrome.storage.local.remove(pk)).then(() => sendResponse(true));
    return true;
  }
  if (message.type === 'VULN_SET_KEY') {
    (async () => {
      await chrome.storage.local.set({ [PROVIDERS[provider].key]: String(message.key || '').trim() });
      await chrome.storage.local.remove(PROVIDERS[provider].key + '_pending');
      if (provider === 'wordfence') { await idbSet('wf_fail', null); wfLastError = ''; await wfRefresh(true); }
      else { providerErrors[provider] = ''; await idbSet('wps_fail', null); }
      sendResponse(await allStatus());
    })();
    return true;
  }
  if (message.type === 'VULN_CLEAR') {
    (async () => {
      await chrome.storage.local.remove([PROVIDERS[provider].key, PROVIDERS[provider].key + '_pending']);
      if (provider === 'wordfence') { await idbSet('wf_index', null); await idbSet('wf_meta', null); await idbSet('wf_fail', null); wfLastError = ''; }
      else { providerErrors[provider] = ''; await idbSet('wps_fail', null); }
      await chrome.permissions.remove({ origins: [PROVIDERS[provider].origin] }).catch(() => {});
      sendResponse(await allStatus());
    })();
    return true;
  }
  if (message.type === 'VULN_LOOKUP') {
    // Wordfence (local list) and WPScan (live lookups, not cached) run on every popup open.
    (async () => {
      const wfJob = (async () => {
        const st = await wfStatus();
        if (!st.hasKey || !st.permission) return null;
        if (!st.updated || Date.now() - st.updated > WF_MAX_AGE) { const job = wfRefresh(); if (!st.updated) await job; }
        const m = await wfLookup(message.items);
        const wfUrl = (id) => (/^[A-Za-z0-9-]{8,64}$/.test(String(id)) ? `https://www.wordfence.com/threat-intel/vulnerabilities/id/${id}` : '');
        return m && m.map((x) => ({ ...x, hits: x.hits.map((h) => ({ ...h, cve: cveList(h.cve), source: 'wordfence', url: wfUrl(h.id) })) }));
      })();
      const wpsJob = wpscanLookup(message.items || []).catch(() => ({ matches: null, error: 'Couldn’t reach WPScan' }));
      const [wordfence, wps] = await Promise.all([wfJob, wpsJob]);
      sendResponse({ status: await allStatus(), results: { wordfence, wpscan: wps.matches }, wpscan: wps });
    })();
    return true;
  }
});
