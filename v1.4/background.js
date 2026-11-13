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

  const iconPath = isWP ? ICONS_ACTIVE : ICONS_DIMMED;
  const countStr = isWP ? (pluginCount > 0 ? String(pluginCount) : 'WP') : '';
  const title = isWP
    ? `WPScout - WordPress Detected (${pluginCount} ${pluginCount === 1 ? 'Plugin' : 'Plugins'})`
    : 'WPScout - Scout Any WordPress Website (Non-WordPress Site)';

  chrome.action.setIcon({ tabId, path: iconPath }).catch(() => {});
  chrome.action.setTitle({ tabId, title }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: countStr }).catch(() => {});

  if (isWP) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#0284C7' }).catch(() => {});
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

// Network Helpers for background enrichment
async function getHostIP(hostname) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`);
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
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(apex)}&type=NS`);
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
    const res = await fetch(`https://ipwho.is/${ip}`);
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

      const [ip, ns] = await Promise.all([
        getHostIP(hostname),
        getNameservers(hostname)
      ]);
      data.ip = ip;
      data.dns = ns;

      const geo = await getISPAndLocation(ip);
      data.isp = geo.isp;
      data.location = geo.location;

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

  const tabId = message.tabId || (sender && sender.tab && sender.tab.id);

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
chrome.runtime.onInstalled.addListener(async () => {
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
