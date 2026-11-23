// ==========================================================================
// WPScout - Fast Content Script Detector & Background Scanner
// Automatically detects WordPress, resolves active theme & plugins,
// and notifies background service worker to update toolbar badge and cache.
// ==========================================================================

(function() {
  // Re-injection (popup or background after an update) must not add a second listener.
  if (window.__wpscout_content_injected) return;
  window.__wpscout_content_injected = true;

  // 1. Fast Synchronous Pre-Check (sub-millisecond)
  function isWordPressSite() {
    // 1. Meta generator tag
    if (document.querySelector('meta[name="generator"][content*="WordPress" i]')) return true;

    // 2. REST API / RSD / WLW links
    // (A feed link alone is not evidence: Gmail, Blogger, Medium and most CMSs publish /feed URLs.)
    if (document.querySelector(
      'link[rel="https://api.w.org/"], ' +
      'link[rel*="wp-json" i], ' +
      'link[rel="EditURI"][type*="rsd+xml" i], ' +
      'link[rel="wlwmanifest"]'
    )) return true;

    // 3. Asset directories: /wp-content/ or /wp-includes/ in links, scripts, images, audio, video, source
    if (document.querySelector(
      'link[href*="/wp-content/"], link[href*="/wp-includes/"], ' +
      'script[src*="/wp-content/"], script[src*="/wp-includes/"], ' +
      'img[src*="/wp-content/"], source[srcset*="/wp-content/"], ' +
      'a[href*="/wp-content/uploads/"]'
    )) return true;

    // 4. Core inline styles & IDs (block library, global styles, classic theme styles, emoji styles)
    if (document.querySelector(
      'style[id^="wp-block-"], style[id="global-styles-inline-css"], style[id="classic-theme-styles-inline-css"], ' +
      'style[id*="block-library"], style[id*="classic-theme-styles"], ' +
      'link[id*="wp-block-"], link[id*="wp-emoji"]'
    )) return true;

    // 5. Admin bar (logged in) & common core WP body/block classes
    if (document.getElementById('wpadminbar')) return true;
    if (document.querySelector(
      'body.wp-custom-logo, body.wp-embed-responsive, body[class*="wp-theme-"], body.page-template-default, ' +
      'body.admin-bar, body.logged-in, ' +
      '[class*="wp-block-"], [class*="wp-container-"]'
    )) return true;

    // 6. Fast scan of inline scripts for WordPress fingerprints
    const inlineScripts = document.querySelectorAll('script:not([src])');
    for (let i = 0; i < inlineScripts.length && i < 25; i++) {
      const text = inlineScripts[i].textContent;
      if (text && (
        text.includes('_wpemojiSettings') ||
        text.includes('/wp-content/') ||
        text.includes('/wp-includes/') ||
        text.includes('wp-json') ||
        text.includes('wp.i18n') ||
        text.includes('wp.apiFetch') ||
        text.includes('wc_add_to_cart_params') ||
        text.includes('elementorFrontendConfig')
      )) {
        return true;
      }
    }

    return false;
  }

  // 2. Full WordPress & Plugin Diagnostic Engine
  async function detectWordPress() {
  function fetchWithTimeout(resource, options = {}, timeout = 2500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(resource, {
      ...options,
      signal: controller.signal
    }).finally(() => clearTimeout(id));
  }

  let isWP = false;
  let version = 'Unknown';
  let theme = 'Unknown';
  let themeVersion = '';
  let themeAuthor = '';
  let themeStylesheet = '';
  let isChildTheme = false;
  let parentTheme = '';
  let isUserLoggedIn = false;
  let pageBuilder = 'None Detected';
  let hasGutenberg = false;
  let hostingPlatform = 'Unknown';
  let ecommerce = 'None';

  const pluginsMap = new Map();
  const urlParams = new URL(document.location.href);
  const origin = urlParams.origin;

  // Network checks run in parallel with the DOM scan; each is awaited where it was used before.
  // Page headers: GET aborted as soon as headers arrive (HEAD as fallback).
  // Sent without cookies, and skipped on URLs that may carry one-time tokens or perform an
  // action on GET (login, password reset, confirm/unsubscribe links, nonces).
  const unsafeToRefetch = /\/wp-(?:login|signup|activate)\.php|\/wp-admin\/|[?&](?:key|token|nonce|_wpnonce|action|code|confirm|unsubscribe|login)=/i
    .test(document.location.pathname + document.location.search);
  const headersPromise = unsafeToRefetch ? Promise.resolve(null) : (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    try {
      const res = await fetch(document.location.href, { method: 'GET', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(timer);
      return { res, stop: () => ctrl.abort() };
    } catch (e) {
      clearTimeout(timer);
      const res = await fetchWithTimeout(document.location.href, { method: 'HEAD', credentials: 'omit' }, 1500);
      return { res, stop: () => {} };
    }
  })().catch(() => null);

  // REST API index (/wp-json, then ?rest_route=/). On large sites this is close to 1 MB, so a
  // compact copy (namespaces + route names) is cached per origin by the background worker.
  // The page's own <link rel="https://api.w.org/"> points at the real REST root, which differs from
  // /wp-json when WordPress lives in a subfolder (example.com/blog/wp-json/). It's also the cache key,
  // so a subfolder site and the main site on the same domain don't share an entry.
  const apiLinkEl = document.querySelector('link[rel="https://api.w.org/"]');
  const restRoot = apiLinkEl && apiLinkEl.href ? apiLinkEl.href.replace(/\/?$/, '/') : origin + '/wp-json/';
  const restLabel = restRoot.replace(/\/$/, '');
  function restCache(type, payload) {
    return new Promise((resolve) => {
      const done = setTimeout(() => resolve(undefined), 400);
      try {
        chrome.runtime.sendMessage({ type, origin: restRoot, data: payload }, (r) => {
          clearTimeout(done);
          resolve(chrome.runtime.lastError || !r ? undefined : r);
        });
      } catch (e) { clearTimeout(done); resolve(undefined); }
    });
  }
  const restPromise = (async () => {
    const cached = await restCache('REST_CACHE_GET');
    if (cached && cached.hit) return cached.data;
    let r = await fetchWithTimeout(restRoot, { credentials: 'omit' }, 2500);
    if (!r.ok && restRoot !== origin + '/wp-json/') r = await fetchWithTimeout(origin + '/wp-json', { credentials: 'omit' }, 2500);
    if (!r.ok) r = await fetchWithTimeout(origin + '/?rest_route=/', { credentials: 'omit' }, 2000);
    const raw = r.ok ? await r.json() : null;
    const compact = raw && Array.isArray(raw.namespaces) ? {
      name: raw.name || '',
      description: raw.description || '',
      namespaces: raw.namespaces,
      routes: Object.fromEntries(Object.keys(raw.routes || {}).map((k) => [k, 1]))
    } : null;
    restCache('REST_CACHE_SET', compact);
    return compact;
  })().catch(() => null);

  // 7 Explicit Detection Signals as requested
  const signals = {
    api: { id: 'sig-api', detected: false, detail: 'Not detected' },
    linkHeader: { id: 'sig-link-header', detected: false, detail: 'Not detected' },
    generator: { id: 'sig-generator', detected: false, detail: 'Not detected' },
    wpContent: { id: 'sig-wp-content', detected: false, count: 0, detail: 'Not detected' },
    wpIncludes: { id: 'sig-wp-includes', detected: false, count: 0, detail: 'Not detected' },
    linkRel: { id: 'sig-link-rel', detected: false, detail: 'Not detected' },
    adminPaths: { id: 'sig-admin-paths', detected: false, detail: 'Not detected' }
  };

  // --- Signal 3: WordPress Generator Meta Tag ---
  const generatorMeta = document.querySelector('meta[name="generator"][content*="WordPress" i]');
  if (generatorMeta) {
    isWP = true;
    signals.generator.detected = true;
    signals.generator.detail = generatorMeta.outerHTML.substring(0, 80);
    const match = generatorMeta.content.match(/WordPress\s+([0-9a-zA-Z.-]+)/i);
    if (match) version = match[1];
  }

  // Feed links (RSS/Atom with /feed) are deliberately NOT a WordPress signal: Gmail's inbox
  // (/mail/u/0/feed/atom), Blogger, Ghost and others publish them too.

  // --- Signal 6: wp-json Link Rel Detected ---
  const linkRelWp = document.querySelector('link[rel="https://api.w.org/"], link[rel="alternate"][type="application/json"][href*="wp-json"]');
  const linkRsd = document.querySelector('link[rel="EditURI"][type="application/rsd+xml"]');
  if (linkRelWp) {
    isWP = true;
    signals.linkRel.detected = true;
    signals.linkRel.detail = `<link rel="https://api.w.org/" href="${linkRelWp.href}">`;
  } else if (linkRsd) {
    isWP = true;
    signals.linkRel.detected = true;
    signals.linkRel.detail = `<link rel="EditURI" href="${linkRsd.href}">`;
  }

  // --- Signal 7: WordPress Admin / Login Paths & Admin Bar ---
  const adminBar = document.getElementById('wpadminbar');
  const bodyLogged = document.body && (document.body.classList.contains('logged-in') || document.body.classList.contains('admin-bar'));
  if (adminBar || bodyLogged) {
    isWP = true;
    isUserLoggedIn = true;
    signals.adminPaths.detected = true;
    signals.adminPaths.detail = 'Logged in session detected (wpadminbar present)';
  } else {
    const loginLink = document.querySelector('a[href*="wp-login.php"], a[href*="wp-admin"], form[action*="wp-login.php"]');
    if (loginLink) {
      isWP = true;
      signals.adminPaths.detected = true;
      signals.adminPaths.detail = `Admin route: ${loginLink.getAttribute('href') || loginLink.getAttribute('action')}`;
    }
  }

  // --- Gutenberg Blocks Check ---
  const gutenbergEl = document.querySelector('[class*="wp-block-"], [class*="wp-container-"], link[href*="block-library"]');
  if (gutenbergEl) {
    hasGutenberg = true;
  }

  // --- Page Builder Check ---
  if (document.querySelector('.elementor, link[href*="elementor"]')) pageBuilder = 'Elementor';
  else if (document.querySelector('.et_pb_section, link[href*="divi"]')) pageBuilder = 'Divi';
  else if (document.querySelector('.fl-builder, link[href*="beaver-builder"]')) pageBuilder = 'Beaver Builder';
  else if (document.querySelector('.vc_row, link[href*="js_composer"]')) pageBuilder = 'WPBakery';
  else if (document.querySelector('.brx-body, link[href*="bricks"]')) pageBuilder = 'Bricks';
  else if (document.querySelector('.ct-section, link[href*="oxygen"]')) pageBuilder = 'Oxygen';
  else if (hasGutenberg) pageBuilder = 'Gutenberg (Block Editor)';

  // --- Signal 4 & 5: /wp-content/ and /wp-includes/ Asset Scans (Layer 1) ---
  const elements = document.querySelectorAll('link[href], script[src], img[src], source[srcset]');
  let wpContentCount = 0;
  let wpIncludesCount = 0;

  elements.forEach(el => {
    const url = el.href || el.src;
    if (!url) return;

    if (url.includes('/wp-content/')) {
      isWP = true;
      wpContentCount++;
      if (!signals.wpContent.detected) {
        signals.wpContent.detected = true;
        signals.wpContent.detail = `Asset: ${url.substring(0, 75)}`;
      }
    }

    if (url.includes('/wp-includes/')) {
      isWP = true;
      wpIncludesCount++;
      if (!signals.wpIncludes.detected) {
        signals.wpIncludes.detected = true;
        signals.wpIncludes.detail = `Core: ${url.substring(0, 75)}`;
      }
    }

    // Active Theme Extraction from external URLs (Supports standard + concatenated combo URLs)
    const themeMatches = url.matchAll(/\/wp-content\/themes\/([^\/,\?]+)\//gi);
    for (const themeMatch of themeMatches) {
      const detectedTheme = themeMatch[1].toLowerCase();
      if (!['plugins', 'uploads', 'themes'].includes(detectedTheme)) {
        if (theme === 'Unknown') {
          theme = detectedTheme;
          themeStylesheet = url;
        } else if (theme !== detectedTheme && !isChildTheme) {
          isChildTheme = true;
          parentTheme = detectedTheme;
        }

        const verMatch = url.match(/(?:\?|&)ver=([0-9a-zA-Z.-]+)/i);
        if (verMatch && verMatch[1] !== version && !themeVersion) {
          themeVersion = verMatch[1];
        }
      }
    }

    // Plugin Assets Extraction (Handles Standard + VIP Combo Concatenated URLs like _static/??...)
    const pluginMatches = url.matchAll(/\/wp-content\/plugins\/([^\/,\?]+)\//gi);
    for (const pluginMatch of pluginMatches) {
      const slug = pluginMatch[1].toLowerCase();
      if (!['plugins', 'uploads', 'themes', 'mu-plugins', 'core'].includes(slug)) {
        let pVer = '';
        const verMatch = url.match(/(?:\?|&)ver=([0-9a-zA-Z.-]+)/i);
        if (verMatch && verMatch[1] !== version) pVer = verMatch[1];

        const existing = pluginsMap.get(slug);
        if (!existing || (pVer && !existing.version)) {
          pluginsMap.set(slug, {
            slug,
            version: pVer,
            method: 'Frontend Asset',
            sourceTag: 'URL',
            evidence: url.length > 95 ? url.substring(0, 95) + '...' : url
          });
        }
      }
    }
  });

  // --- MULTI-LAYER PLUGIN SCANNER (INLINE SCRIPTS, LOCALIZED JS & INLINE CSS) ---
  // Many modern WordPress plugins (such as Advanced Accordion Block, WooCommerce, Elementor,
  // Tutor LMS, etc.) localize data via wp_localize_script() into inline <script> tags
  // (e.g. <script id="jquery-core-js-extra"> var aagb_local_object = {"assets": ".../advanced-accordion-block/assets/"} </script>)
  // Scanning inline script textContent ensures these plugins are always detected even without raw script[src] files.
  const inlineScripts = document.querySelectorAll('script');
  inlineScripts.forEach(scriptEl => {
    const text = scriptEl.textContent;
    if (!text || !text.includes('/wp-content/plugins/')) return;

    const pluginMatches = text.matchAll(/\/wp-content\/plugins\/([a-zA-Z0-9_-]+)\//gi);
    for (const match of pluginMatches) {
      const slug = match[1].toLowerCase();
      if (!['plugins', 'uploads', 'themes', 'mu-plugins', 'core'].includes(slug)) {
        isWP = true;
        wpContentCount++;
        const snippetIndex = Math.max(0, match.index - 35);
        const snippet = text.substring(snippetIndex, snippetIndex + 140).replace(/\s+/g, ' ').trim();
        const existing = pluginsMap.get(slug);
        if (!existing) {
          pluginsMap.set(slug, {
            slug,
            version: '',
            method: 'Inline Script Data (wp_localize_script)',
            sourceTag: 'DOM',
            evidence: scriptEl.id ? `<script id="${scriptEl.id}"> ...${snippet}...` : snippet
          });
        }
      }
    }
  });

  // Also scan all inline <style> tags for plugin asset paths (e.g. @font-face, SVG, background URLs)
  const inlineStyleBlocks = document.querySelectorAll('style');
  inlineStyleBlocks.forEach(styleEl => {
    const text = styleEl.textContent;
    if (!text || !text.includes('/wp-content/plugins/')) return;

    const pluginMatches = text.matchAll(/\/wp-content\/plugins\/([a-zA-Z0-9_-]+)\//gi);
    for (const match of pluginMatches) {
      const slug = match[1].toLowerCase();
      if (!['plugins', 'uploads', 'themes', 'mu-plugins', 'core'].includes(slug)) {
        isWP = true;
        const existing = pluginsMap.get(slug);
        if (!existing) {
          const snippetIndex = Math.max(0, match.index - 25);
          const snippet = text.substring(snippetIndex, snippetIndex + 120).replace(/\s+/g, ' ').trim();
          pluginsMap.set(slug, {
            slug,
            version: '',
            method: 'Inlined CSS Asset',
            sourceTag: 'DOM',
            evidence: styleEl.id ? `<style id="${styleEl.id}"> ...${snippet}...` : snippet
          });
        }
      }
    }
  });

  // Scan inlined style and script ID handles for block signatures (e.g. id="aagb-separate-accordion-css")
  const idElements = document.querySelectorAll('style[id], script[id]');
  idElements.forEach(el => {
    const id = (el.id || '').toLowerCase();
    if (id.startsWith('aagb-') || id.includes('advanced-accordion')) {
      if (!pluginsMap.has('advanced-accordion-block')) {
        pluginsMap.set('advanced-accordion-block', {
          slug: 'advanced-accordion-block',
          version: '',
          method: 'Block Asset Handle',
          sourceTag: 'DOM',
          evidence: `<${el.tagName.toLowerCase()} id="${el.id}">`
        });
      }
    }
  });

  // --- THIRD-PARTY EMBED & INTEGRATION SIGNATURES (HubSpot, Disqus, WooCommerce, Sailthru, Analytics) ---
  const thirdPartySignatures = [
    {
      slug: 'hubspot',
      name: 'HubSpot All-In-One Marketing',
      category: 'Marketing',
      check: () => {
        if (window.hbspt || window._hsq) return 'window.hbspt object';
        const scripts = document.querySelectorAll('script');
        for (let i = 0; i < scripts.length && i < 35; i++) {
          const t = scripts[i].textContent || '';
          if (t.includes('hubspotPortalId') || t.includes('hs-scripts.com') || t.includes('js.hsforms.net')) {
            return 'Inline script (hubspotPortalId / hs-scripts)';
          }
        }
        return null;
      }
    },
    {
      slug: 'disqus-comment-system',
      name: 'Disqus Comment System',
      category: 'Comments',
      check: () => {
        if (window.disqus_shortname || window.disqus_config || window.DISQUS) return 'window.disqus_shortname';
        if (document.getElementById('disqus_thread')) return '#disqus_thread container';
        const scripts = document.querySelectorAll('script[src*="disqus.com"]');
        if (scripts.length > 0) return scripts[0].src;
        return null;
      }
    },
    {
      slug: 'woocommerce',
      name: 'WooCommerce',
      category: 'E-Commerce',
      isEcom: true,
      check: () => {
        if (window.wc_add_to_cart_params || window.woocommerce_params) return 'window.wc_add_to_cart_params';
        if (document.body && (document.body.classList.contains('woocommerce') || document.body.classList.contains('woocommerce-page'))) return 'body.woocommerce';
        const scripts = document.querySelectorAll('script');
        for (let i = 0; i < scripts.length && i < 35; i++) {
          const t = scripts[i].textContent || '';
          if (t.includes('isWooCommerceBlocksEnabled') || t.includes('woocommerce-blocks')) {
            return 'WooCommerce Blocks integration config';
          }
        }
        return null;
      }
    },
    {
      slug: 'sailthru-widget',
      name: 'Sailthru for WordPress',
      category: 'Marketing',
      check: () => {
        if (window.sailthru_vars || window.Sailthru) return 'window.sailthru_vars';
        return null;
      }
    },
    {
      slug: 'google-analytics-for-wordpress',
      name: 'MonsterInsights – Google Analytics Dashboard',
      category: 'Analytics',
      check: () => {
        if (window.__gaTracker || window.monsterinsights_frontend) return 'window.monsterinsights_frontend';
        return null;
      }
    },
    {
      slug: 'google-site-kit',
      name: 'Site Kit by Google',
      category: 'Analytics',
      check: () => {
        const meta = document.querySelector('meta[name="generator"][content*="Site Kit" i]');
        if (meta) return meta.outerHTML;
        return null;
      }
    }
  ];

  for (const item of thirdPartySignatures) {
    if (!pluginsMap.has(item.slug)) {
      try {
        const evidence = item.check();
        if (evidence) {
          pluginsMap.set(item.slug, {
            slug: item.slug,
            version: '',
            method: 'Integration Signature',
            sourceTag: 'DOM',
            evidence: String(evidence).substring(0, 80)
          });
          if (item.isEcom && ecommerce === 'None') {
            ecommerce = item.name;
          }
        }
      } catch (e) {}
    }
  }

  // --- MULTI-LAYER CASCADE THEME DETECTION (WPOPTIC-STYLE) ---

  // Layer 2: <body> Class Inspection (Standard for modern FSE & Block Themes)
  // WordPress core get_body_class() injects "wp-theme-[slug]" or "theme-[slug]"
  if (document.body && document.body.className) {
    const classTokens = document.body.className.split(/\s+/);
    for (const token of classTokens) {
      const childMatch = token.match(/^wp-child-theme-([a-zA-Z0-9_-]+)$/i);
      if (childMatch) {
        const candidate = childMatch[1].toLowerCase();
        if (theme === 'Unknown') {
          theme = candidate;
        } else if (theme !== candidate) {
          isChildTheme = true;
          parentTheme = theme;
          theme = candidate;
        }
        isWP = true;
      }

      const bodyThemeMatch = token.match(/^wp-theme-([a-zA-Z0-9_-]+)$/i);
      if (bodyThemeMatch) {
        const candidate = bodyThemeMatch[1].toLowerCase();
        if (!['dark', 'light', 'default', 'custom', 'preview', 'editor', 'mode', 'active', 'ui'].includes(candidate)) {
          if (theme === 'Unknown') {
            theme = candidate;
            isWP = true;
          }
        }
      }
    }
  }

  // Layer 3: Inlined <style> ID Handles
  // When themes use wp_style_add_data( $handle, 'path', ... ) or inline stylesheets,
  // WordPress outputs <style id="[handle]-style-inline-css"> or <style id="[handle]-style-css">.
  if (theme === 'Unknown') {
    const styleTags = document.querySelectorAll('style[id]');
    for (let i = 0; i < styleTags.length; i++) {
      const id = styleTags[i].id;
      if (!id) continue;
      const handleMatch = id.match(/^([a-zA-Z0-9_-]+)-(?:style|theme)(?:-inline)?-css$/i);
      if (handleMatch) {
        const candidate = handleMatch[1].toLowerCase();
        if (!['global-styles', 'wp-block-library', 'classic-theme', 'core', 'wp', 'block-library'].includes(candidate)) {
          theme = candidate;
          isWP = true;
          break;
        }
      }
    }
  }

  // Layer 4: Text Content of Inlined <style> Blocks (e.g. bundled @font-face or asset URLs)
  if (theme === 'Unknown') {
    const styleTags = document.querySelectorAll('style');
    for (let i = 0; i < styleTags.length && i < 25; i++) {
      const text = styleTags[i].textContent;
      if (text && text.includes('/wp-content/themes/')) {
        const match = text.match(/\/wp-content\/themes\/([^\/'"\\)]+)\//i);
        if (match) {
          const candidate = match[1].toLowerCase();
          if (!['plugins', 'uploads', 'themes'].includes(candidate)) {
            theme = candidate;
            isWP = true;
            break;
          }
        }
      }
    }
  }

  // Layer 5: Direct style.css Inspection & Header Extraction (WPOPTIC / Theme Standard)
  // Calls [origin]/wp-content/themes/[slug]/style.css to parse the official WordPress
  // header comment (Theme Name, Version, Author, Author URI, Description, Template).
  let themeName = '';
  let themeDescription = '';
  let themeAuthorUri = '';

  if (theme !== 'Unknown') {
    try {
      const styleUrl = `${origin}/wp-content/themes/${theme}/style.css`;
      const styleRes = await fetchWithTimeout(styleUrl, {}, 2000);
      if (styleRes.ok) {
        const cssText = await styleRes.text();
        if (cssText) {
          const nameMatch = cssText.match(/Theme Name:\s*([^\r\n*]+)/i);
          const verMatch = cssText.match(/Version:\s*([^\r\n*]+)/i);
          const authorMatch = cssText.match(/Author:\s*([^\r\n*]+)/i);
          const authorUriMatch = cssText.match(/Author URI:\s*([^\r\n*]+)/i);
          const templateMatch = cssText.match(/Template:\s*([^\r\n*]+)/i);
          const descMatch = cssText.match(/Description:\s*([^\r\n*]+)/i);

          if (nameMatch) themeName = nameMatch[1].trim();
          if (verMatch && (!themeVersion || verMatch[1] !== version)) themeVersion = verMatch[1].trim();
          if (authorMatch && !themeAuthor) themeAuthor = authorMatch[1].trim().replace(/<[^>]+>/g, '');
          if (authorUriMatch) themeAuthorUri = authorUriMatch[1].trim();
          if (templateMatch && !isChildTheme) {
            isChildTheme = true;
            parentTheme = templateMatch[1].trim();
          }
          if (descMatch) themeDescription = descMatch[1].trim();
          if (!themeStylesheet) themeStylesheet = styleUrl;
        }
      }
    } catch (e) {}
  }

  // Signal 4 (/wp-content/) is ONLY detected if actual /wp-content/ assets or stylesheets were loaded
  if (wpContentCount > 0) {
    signals.wpContent.detected = true;
    if (!signals.wpContent.detail || signals.wpContent.detail === 'Not detected') {
      signals.wpContent.detail = `${wpContentCount} /wp-content/ asset(s) loaded`;
    }
  } else {
    signals.wpContent.detected = false;
  }

  signals.wpContent.count = wpContentCount;
  signals.wpIncludes.count = wpIncludesCount;

  // --- HTTP Headers & Cache Status (via GET + AbortController) ---
  let serverSoftware = 'Unknown';
  let proxyCDN = 'None Detected';
  let phpVersion = 'Unknown';
  let cacheSystem = 'None Detected';
  let cacheHeaderStatus = 'Unknown';
  let cacheDetail = '';

  function parseCacheStatus(raw) {
    if (!raw) return 'Unknown';
    const s = raw.trim();
    const upper = s.toUpperCase();

    if (upper.includes('SAVING')) return 'Saving to Cache';
    if (upper.includes('NOT CACHED') || upper.includes('NO-CACHE') || upper.includes('BYPASS') || upper.includes('DISABLED') || upper.includes('EXCLUDED')) return 'BYPASS';
    if (upper.includes('HIT') || upper.includes('CACHED') || upper.includes('SUPERCACHE') || upper.includes('WP-CACHE') || upper === 'ACTIVE') return 'HIT';
    if (upper.includes('MISS')) return 'MISS';
    if (upper.includes('DYNAMIC')) return 'DYNAMIC';
    if (upper.includes('EXPIRED')) return 'EXPIRED';
    if (upper.includes('STALE')) return 'STALE';
    if (upper.includes('REVALIDATED')) return 'REVALIDATED';
    return s.length > 20 ? s.substring(0, 20) : s;
  }

  const knownCacheRules = [
    { header: 'wpo-cache-status', system: 'WP-Optimize', pluginSlug: 'wp-optimize' },
    { header: 'x-wpo-cache-status', system: 'WP-Optimize', pluginSlug: 'wp-optimize' },
    { header: 'x-litespeed-cache', system: 'LiteSpeed Cache', pluginSlug: 'litespeed-cache' },
    { header: 'wp-super-cache', system: 'WP Super Cache', pluginSlug: 'wp-super-cache' },
    { header: 'x-super-cache', system: 'WP Super Cache', pluginSlug: 'wp-super-cache' },
    { header: 'x-w3tc-pagecache', system: 'W3 Total Cache', pluginSlug: 'w3-total-cache' },
    { header: 'x-flying-press-cache', system: 'FlyingPress', pluginSlug: 'flying-press' },
    { header: 'x-nitro-cache', system: 'NitroPack', pluginSlug: 'nitropack' },
    { header: 'x-breeze-cache', system: 'Breeze Cache', pluginSlug: 'breeze' },
    { header: 'x-cache-handler', system: 'Cache Enabler', pluginSlug: 'cache-enabler' },
    { header: 'cf-cache-status', system: 'Cloudflare' },
    { header: 'x-kinsta-cache', system: 'Kinsta Cache' },
    { header: 'x-wpengine-cache', system: 'WP Engine Cache' },
    { header: 'x-pantheon-styx-edge-cache', system: 'Pantheon Styx' },
    { header: 'x-fastcgi-cache', system: 'Nginx FastCGI' },
    { header: 'x-varnish-cache', system: 'Varnish' },
    { header: 'x-cache-status', system: 'Server Cache' },
    { header: 'x-cache', system: 'Edge/Server Cache' }
  ];

  const SECURITY_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
  const securityHeaders = {};
  let headersChecked = false;
  let xRobotsTag = '';

  const pageHeaders = await headersPromise;
  try {
    if (!pageHeaders) throw new Error('no headers');
    const response = pageHeaders.res;
    headersChecked = true;
    for (const h of SECURITY_HEADERS) {
      const v = response.headers.get(h);
      securityHeaders[h] = v ? v.slice(0, 300) : null;
    }
    xRobotsTag = response.headers.get('x-robots-tag') || '';

    // --- Signal 2: wp-json in Link Header ---
    const linkHeader = response.headers.get('link');
    if (linkHeader && (linkHeader.includes('rel="https://api.w.org/"') || linkHeader.includes('/wp-json/'))) {
      isWP = true;
      signals.linkHeader.detected = true;
      signals.linkHeader.detail = linkHeader.length > 80 ? linkHeader.substring(0, 80) + '...' : linkHeader;
    }

    // Server Software & Proxy / Edge CDN
    const rawServer = response.headers.get('server');
    if (rawServer) {
      const lServer = rawServer.toLowerCase();
      if (lServer.includes('cloudflare')) {
        proxyCDN = 'Cloudflare';
        serverSoftware = 'Cloudflare (Edge Reverse Proxy)';
      } else if (lServer.includes('sucuri')) {
        proxyCDN = 'Sucuri';
        serverSoftware = 'Sucuri Firewall';
      } else if (lServer.includes('fastly')) {
        proxyCDN = 'Fastly';
        serverSoftware = 'Fastly CDN';
      } else {
        serverSoftware = rawServer;
      }
    }

    // Host & Platform Detection (x-powered-by, x-hacker, custom vendor headers)
    const poweredBy = response.headers.get('x-powered-by') || '';
    const xHacker = response.headers.get('x-hacker') || '';
    const lPowered = poweredBy.toLowerCase();
    const lHacker = xHacker.toLowerCase();

    if (lPowered.includes('php')) {
      phpVersion = poweredBy;
    }

    if (lPowered.includes('wordpress vip') || lPowered.includes('wpvip') || lHacker.includes('viphacker') || lHacker.includes('a8c.com')) {
      hostingPlatform = 'WordPress VIP';
      if (serverSoftware === 'Unknown' || serverSoftware.includes('Cloudflare')) {
        serverSoftware = 'WordPress VIP (Nginx / Edge)';
      }
    } else if (response.headers.has('x-wpengine') || response.headers.has('x-wpengine-cache') || lPowered.includes('wp engine')) {
      hostingPlatform = 'WP Engine';
      proxyCDN = proxyCDN !== 'None Detected' ? `${proxyCDN} (WP Engine)` : 'WP Engine EverCache';
    } else if (response.headers.has('x-kinsta-cache') || lPowered.includes('kinsta')) {
      hostingPlatform = 'Kinsta';
      proxyCDN = proxyCDN !== 'None Detected' ? `${proxyCDN} (Kinsta Edge)` : 'Kinsta Cloud Platform';
    } else if (response.headers.has('x-pantheon-styx-edge-cache') || response.headers.has('x-pantheon-endpoint') || lPowered.includes('pantheon')) {
      hostingPlatform = 'Pantheon';
      proxyCDN = 'Pantheon Styx Edge';
    } else if (response.headers.has('x-flywheel-cache') || lPowered.includes('flywheel')) {
      hostingPlatform = 'Flywheel';
    } else if (response.headers.has('x-pressable') || lPowered.includes('pressable')) {
      hostingPlatform = 'Pressable';
    } else if (response.headers.has('x-siteground') || response.headers.has('x-sg-cache')) {
      hostingPlatform = 'SiteGround';
    } else if (response.headers.has('x-litespeed-cache') || (rawServer && rawServer.toLowerCase().includes('litespeed'))) {
      if (hostingPlatform === 'Unknown') hostingPlatform = 'LiteSpeed Web Server';
    }

    // Cache Headers
    for (const rule of knownCacheRules) {
      if (response.headers.has(rule.header)) {
        cacheSystem = rule.system;
        const rawVal = response.headers.get(rule.header);
        cacheHeaderStatus = parseCacheStatus(rawVal);
        cacheDetail = `${rule.header}: ${rawVal}`;

        if (rule.pluginSlug && !pluginsMap.has(rule.pluginSlug)) {
          pluginsMap.set(rule.pluginSlug, {
            slug: rule.pluginSlug,
            version: '',
            method: 'HTTP Cache Header',
            sourceTag: 'HEADER',
            evidence: `${rule.header}: ${rawVal}`
          });
        }
        break;
      }
    }

    // Wildcard cache fallback
    if (cacheSystem === 'None Detected') {
      response.headers.forEach((val, key) => {
        if (cacheSystem !== 'None Detected') return;
        const lKey = key.toLowerCase();
        if (lKey.includes('cache-status') || (lKey.includes('cache') && !lKey.includes('cache-control'))) {
          cacheSystem = key;
          cacheHeaderStatus = parseCacheStatus(val);
          cacheDetail = `${key}: ${val}`;
        }
      });
    }

    pageHeaders.stop();
  } catch (e) {
    // Ignore fetch error
  }

  // --- HTML Comment Inspection for Caching (DOM fallback) ---
  if (cacheSystem === 'None Detected' || cacheHeaderStatus === 'Unknown' || cacheHeaderStatus === 'BYPASS') {
    try {
      const iter = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT, () => NodeFilter.FILTER_ACCEPT);
      let node;
      while ((node = iter.nextNode())) {
        const text = (node.nodeValue || '').trim();
        if (/cached\s+by\s+wp-optimize|wpo-cache/i.test(text)) {
          cacheSystem = 'WP-Optimize';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: WP-Optimize';
          if (!pluginsMap.has('wp-optimize')) {
            pluginsMap.set('wp-optimize', { slug: 'wp-optimize', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        } else if (/wp\s*rocket/i.test(text)) {
          cacheSystem = 'WP Rocket';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: WP Rocket';
          if (!pluginsMap.has('wp-rocket')) {
            pluginsMap.set('wp-rocket', { slug: 'wp-rocket', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        } else if (/wp\s*fastest\s*cache/i.test(text)) {
          cacheSystem = 'WP Fastest Cache';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: WP Fastest Cache';
          if (!pluginsMap.has('wp-fastest-cache')) {
            pluginsMap.set('wp-fastest-cache', { slug: 'wp-fastest-cache', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        } else if (/w3\s*total\s*cache/i.test(text)) {
          cacheSystem = 'W3 Total Cache';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: W3 Total Cache';
          if (!pluginsMap.has('w3-total-cache')) {
            pluginsMap.set('w3-total-cache', { slug: 'w3-total-cache', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        } else if (/supercache|cached\s+page\s+served\s+by\s+wp-cache/i.test(text)) {
          cacheSystem = 'WP Super Cache';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: WP Super Cache';
          if (!pluginsMap.has('wp-super-cache')) {
            pluginsMap.set('wp-super-cache', { slug: 'wp-super-cache', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        } else if (/litespeed\s*cache/i.test(text)) {
          cacheSystem = 'LiteSpeed Cache';
          cacheHeaderStatus = 'HIT';
          cacheDetail = 'HTML Comment: LiteSpeed Cache';
          if (!pluginsMap.has('litespeed-cache')) {
            pluginsMap.set('litespeed-cache', { slug: 'litespeed-cache', version: '', method: 'HTML Comment Signature', sourceTag: 'DOM', evidence: text.substring(0, 80) });
          }
          break;
        }
      }
    } catch (e) {}
  }

  // --- Signal 1: wp-json API Detected ---
  let restSiteName = '';
  let restDescription = '';
  try {
    const restData = await restPromise;
    if (restData) {
      if (restData && restData.namespaces && Array.isArray(restData.namespaces)) {
        isWP = true;
        signals.api.detected = true;
        signals.api.detail = `${restLabel} (${restData.namespaces.length} namespaces)`;

        if (restData.name) restSiteName = restData.name;
        if (restData.description) restDescription = restData.description;

        const coreNamespaces = ['oembed', 'wp', 'wp-site-health', 'wp-block-editor', 'wp-abilities'];
        restData.namespaces.forEach(ns => {
          const parts = ns.split('/');
          if (parts.length > 0) {
            let prefix = parts[0].toLowerCase();
            if (!coreNamespaces.includes(prefix) && prefix.length > 1) {
              if (prefix === 'ldlms') prefix = 'sfwd-lms';
              if (prefix === 'yoast') prefix = 'wordpress-seo';
              if (prefix === 'wc' || prefix.includes('woocommerce')) {
                prefix = 'woocommerce';
                ecommerce = 'WooCommerce';
              }

              if (!pluginsMap.has(prefix)) {
                pluginsMap.set(prefix, {
                  slug: prefix,
                  version: 'REST API',
                  method: 'REST API Namespace',
                  sourceTag: 'API',
                  evidence: `${restRoot}${ns}`
                });
              }
            }
          }
        });

        // Scan Individual REST Sub-routes for Deep Integration Signatures
        if (restData.routes && typeof restData.routes === 'object') {
          const routeKeys = Object.keys(restData.routes);
          const knownRouteSignatures = [
            { pattern: /\/hubspot\//i, slug: 'hubspot', name: 'HubSpot All-In-One Marketing', category: 'Marketing' },
            { pattern: /\/newsletters?\//i, slug: 'newsletter', name: 'Newsletter', category: 'Marketing' },
            { pattern: /\/disqus\//i, slug: 'disqus-comment-system', name: 'Disqus Comment System', category: 'Comments' },
            { pattern: /\/(?:wc|woocommerce)\/|\/seen-wc-/i, slug: 'woocommerce', name: 'WooCommerce', category: 'E-Commerce', isEcom: true },
            { pattern: /\/mailchimp/i, slug: 'mailchimp-for-woocommerce', name: 'Mailchimp for WordPress', category: 'Marketing' },
            { pattern: /\/wpforms/i, slug: 'wpforms-lite', name: 'WPForms', category: 'Forms' },
            { pattern: /\/gravityforms/i, slug: 'gravityforms', name: 'Gravity Forms', category: 'Forms' },
            { pattern: /\/wordfence/i, slug: 'wordfence', name: 'Wordfence Security', category: 'Security' },
            { pattern: /\/rankmath/i, slug: 'seo-by-rank-math', name: 'Rank Math SEO', category: 'SEO' },
            { pattern: /\/redirection/i, slug: 'redirection', name: 'Redirection', category: 'SEO' },
            { pattern: /\/elementor/i, slug: 'elementor', name: 'Elementor Website Builder', category: 'Blocks' }
          ];

          for (const sig of knownRouteSignatures) {
            if (!pluginsMap.has(sig.slug)) {
              const matchedRoute = routeKeys.find(r => sig.pattern.test(r));
              if (matchedRoute) {
                pluginsMap.set(sig.slug, {
                  slug: sig.slug,
                  version: 'REST API',
                  method: 'REST API Sub-route',
                  sourceTag: 'API',
                  evidence: `${restLabel}${matchedRoute}`
                });
                if (sig.isEcom && ecommerce === 'None') {
                  ecommerce = sig.name;
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {}

  // Calculate Overall Confidence Score based on confirmed signals
  let signalScore = 0;
  if (signals.api.detected) signalScore++;
  if (signals.linkHeader.detected) signalScore++;
  if (signals.generator.detected) signalScore++;
  if (signals.wpContent.detected && wpContentCount > 0) signalScore++;
  if (signals.wpIncludes.detected && wpIncludesCount > 0) signalScore++;
  if (signals.linkRel.detected) signalScore++;
  if (signals.adminPaths.detected && (isUserLoggedIn || signals.adminPaths.detail.includes('wpadminbar'))) signalScore++;

  // Plugins only prove WordPress when found under /wp-content/plugins/. Integration scripts
  // (HubSpot, Disqus), cache headers and HTML comments (LiteSpeed, WP Rocket) also appear on
  // sites that aren't WordPress, so they only describe a site already confirmed as WordPress.
  const WP_PATH_METHODS = ['Frontend Asset', 'Inline Script Data (wp_localize_script)', 'Inlined CSS Asset'];
  const hasWpPluginPath = [...pluginsMap.values()].some((p) => WP_PATH_METHODS.includes(p.method));

  // Strict Verification Guard: A site is ONLY WordPress if at least 1 verified primary core signal exists
  const hasHardWpSignal = Boolean(
    signals.api.detected ||
    signals.linkHeader.detected ||
    signals.generator.detected ||
    (signals.wpContent.detected && wpContentCount > 0) ||
    (signals.wpIncludes.detected && wpIncludesCount > 0) ||
    signals.linkRel.detected ||
    (signals.adminPaths.detected && isUserLoggedIn) ||
    hasWpPluginPath
  );

  let confidence = '0%';
  if (!hasHardWpSignal) {
    isWP = false;
    theme = 'Unknown';
    themeName = '';
    themeVersion = '';
    pageBuilder = 'None Detected';
    signalScore = 0;
    confidence = '0%';
  } else {
    isWP = true;
    if (signalScore >= 5) confidence = '98%';
    else if (signalScore >= 3) confidence = '90%';
    else if (signalScore >= 2) confidence = '80%';
    else confidence = '60%';
  }

  // Categorize Plugins & Normalize Titles
  function categorizePlugin(slug) {
    const s = slug.toLowerCase();
    if (s.includes('player') || s.includes('video') || s.includes('media') || s.includes('audio') || s.includes('jw-player')) return 'Media';
    if (s.includes('market') || s.includes('mail') || s.includes('campaign') || s.includes('newsletter') || s.includes('sailthru') || s.includes('hubspot') || s === 'leadin') return 'Marketing';
    if (s.includes('comment') || s.includes('disqus')) return 'Comments';
    if (s.includes('lms') || s.includes('tutor') || s.includes('course') || s.includes('learn') || s.includes('academy') || s.includes('sensei') || s.includes('lifter')) return 'LMS';
    if (s.includes('form') || s === 'contact-form-7' || s === 'gravityforms' || s === 'wpforms') return 'Forms';
    if (s.includes('seo') || s.includes('schema') || s === 'wordpress-seo') return 'SEO';
    if (s.includes('cache') || s.includes('optimize') || s.includes('rocket') || s === 'autoptimize') return 'Cache';
    if (s.includes('security') || s.includes('fence') || s.includes('firewall') || s === 'wordfence') return 'Security';
    if (s.includes('woo') || s.includes('shop') || s.includes('cart')) return 'E-Commerce';
    if (s.includes('elementor') || s.includes('builder') || s.includes('blocks') || s.includes('block') || s.includes('gutenberg') || s.includes('accordion')) return 'Blocks';
    if (s.includes('analytics') || s.includes('parsely') || s.includes('pixel') || s.includes('track')) return 'Analytics';
    if (s.includes('access') || s.includes('wcag') || s.includes('ada')) return 'Accessibility';
    if (s === 'vip' || s === 'cron-control' || s === 'content-connect' || s === 'wpcom') return 'Platform';
    return 'Plugin';
  }

  function formatPluginName(slug) {
    const knownNames = {
      'jw-player-7-for-wp-premium': 'JW Player for WordPress Premium',
      'jw-player': 'JW Player for WordPress',
      'sailthru-widget': 'Sailthru for WordPress',
      'hubspot': 'HubSpot All-In-One Marketing',
      'leadin': 'HubSpot All-In-One Marketing',
      'disqus-comment-system': 'Disqus Comment System',
      'disqus': 'Disqus Comment System',
      'newsletter': 'Newsletter – Email Marketing',
      'coauthors': 'Co-Authors Plus',
      'co-authors-plus': 'Co-Authors Plus',
      'apple-news': 'Apple News',
      'elasticpress': 'ElasticPress',
      'cron-control': 'Cron Control (VIP)',
      'vip': 'WordPress VIP Platform Client',
      'content-connect': 'Content Connect (VIP)',
      'simple-page-ordering': 'Simple Page Ordering',
      'tc': 'TechCrunch Core Features',
      'tc-deployment': 'TechCrunch Deployment Manager',
      'two-factor': 'Two Factor',
      'zapier': 'Zapier for WordPress',
      'my-jetpack': 'My Jetpack',
      'jetpack-boost': 'Jetpack Boost',
      'jetpack': 'Jetpack – Security, Backup & Speed',
      'akismet': 'Akismet Anti-spam: Spam Protection',
      'wpcom': 'WordPress.com Platform Integration',
      'tutor': 'Tutor LMS',
      'tutor-pro': 'Tutor LMS Pro',
      'advanced-accordion-block': 'Advanced Accordion Gutenberg Block',
      'wordpress-seo': 'Yoast SEO',
      'wordpress-seo-premium': 'Yoast SEO Premium',
      'contact-form-7': 'Contact Form 7',
      'woocommerce': 'WooCommerce',
      'wp-optimize': 'WP-Optimize',
      'litespeed-cache': 'LiteSpeed Cache',
      'wp-super-cache': 'WP Super Cache',
      'w3-total-cache': 'W3 Total Cache',
      'seo-by-rank-math': 'Rank Math SEO',
      'seo-by-rank-math-pro': 'Rank Math SEO Pro',
      'gravityforms': 'Gravity Forms',
      'popup-maker': 'Popup Maker',
      'wp-parsely': 'Parse.ly Analytics',
      'elementor': 'Elementor Website Builder',
      'elementor-pro': 'Elementor Pro',
      'advanced-custom-fields': 'Advanced Custom Fields (ACF)',
      'advanced-custom-fields-pro': 'Advanced Custom Fields Pro',
      'acf-pro': 'Advanced Custom Fields Pro',
      'accessibility-checker': 'Equalize Digital Accessibility Checker',
      'wordfence': 'Wordfence Security',
      'updraftplus': 'UpdraftPlus Backup',
      'google-analytics-for-wordpress': 'MonsterInsights – Google Analytics',
      'google-site-kit': 'Site Kit by Google',
      'duracelltomi-google-tag-manager': 'GTM4WP – Google Tag Manager for WordPress',
      'mailchimp-for-woocommerce': 'Mailchimp for WooCommerce',
      'wpforms-lite': 'WPForms',
      'redirection': 'Redirection'
    };
    if (knownNames[slug]) return knownNames[slug];
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const plugins = Array.from(pluginsMap.values()).map(p => {
    return {
      ...p,
      name: formatPluginName(p.slug),
      category: categorizePlugin(p.slug),
      iconUrl: `https://ps.w.org/${p.slug}/assets/icon-128x128.png`,
      iconFallbackUrl: `https://ps.w.org/${p.slug}/assets/icon-256x256.png`
    };
  });

  // --- Wider tech stack: analytics, fonts, libraries, payments, chat, captcha, consent ---
  // Read from script/link URLs and the first inline scripts only; no extra requests.
  function detectTech() {
    const urls = Array.from(document.querySelectorAll('script[src], link[href]')).map((e) => e.src || e.href).filter(Boolean);
    const inline = Array.from(document.querySelectorAll('script:not([src])')).slice(0, 60).map((x) => (x.textContent || '').slice(0, 20000)).join('\n');
    const TECH = [
      { name: 'Google Analytics 4', category: 'Analytics', src: /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/i, inline: /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)/i },
      { name: 'Google Tag Manager', category: 'Analytics', src: /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i, inline: /googletagmanager\.com\/gtm\.js[\s\S]{0,400}?(GTM-[A-Z0-9]{4,})|(GTM-[A-Z0-9]{4,})[\s\S]{0,400}?googletagmanager/i },
      { name: 'Universal Analytics', category: 'Analytics', src: /google-analytics\.com\/(?:analytics|ga)\.js/i, inline: /['"](UA-\d{4,}-\d+)['"]/ },
      { name: 'Meta Pixel', category: 'Analytics', src: /connect\.facebook\.net\/[^/]+\/fbevents\.js/i, inline: /fbq\(\s*['"]init['"]\s*,\s*['"](\d+)/ },
      { name: 'Microsoft Clarity', category: 'Analytics', src: /clarity\.ms\/tag\/([a-z0-9]+)/i, inline: /clarity\.ms\/tag\/["'+\s]*([a-z0-9]{6,})?/i },
      { name: 'Hotjar', category: 'Analytics', src: /static\.hotjar\.com/i, inline: /_hjSettings\s*=\s*\{\s*hjid\s*:\s*(\d+)|static\.hotjar\.com/ },
      { name: 'LinkedIn Insight', category: 'Analytics', src: /snap\.licdn\.com\/li\.lms-analytics/i, inline: /_linkedin_partner_id\s*=\s*["']?(\d+)/ },
      { name: 'TikTok Pixel', category: 'Analytics', src: /analytics\.tiktok\.com/i, inline: /ttq\.load\(\s*['"]([A-Z0-9]+)/ },
      { name: 'Google Fonts', category: 'Fonts', src: /fonts\.googleapis\.com\/css2?\?/i, families: true },
      { name: 'Adobe Fonts', category: 'Fonts', src: /use\.typekit\.net/i },
      { name: 'Font Awesome', category: 'Fonts', src: /font-?awesome|kit\.fontawesome\.com/i, ver: /font-?awesome[^?]*?[\/@-]v?(\d+\.\d+(?:\.\d+)?)|font-?awesome[^?]*\?ver=(\d+\.\d+(?:\.\d+)?)/i },
      { name: 'jQuery', category: 'Libraries', src: /\/jquery(?:-\d[\d.]*)?(?:\.min)?\.js(?:[?#]|$)/i, ver: /\/jquery(?:\.min)?\.js\?ver=([\d.]+)|\/jquery-(\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/i },
      { name: 'jQuery Migrate', category: 'Libraries', src: /jquery-migrate(?:\.min)?\.js/i, ver: /jquery-migrate(?:\.min)?\.js\?ver=([\d.]+)/i },
      { name: 'Bootstrap', category: 'Libraries', src: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)/i, ver: /bootstrap[@\/-](\d+\.\d+\.\d+)|bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)\?ver=(\d+\.\d+\.\d+)/i },
      { name: 'Swiper', category: 'Libraries', src: /swiper(?:-bundle)?(?:\.min)?\.(?:js|css)/i },
      { name: 'Slick', category: 'Libraries', src: /\/slick(?:\.min)?\.(?:js|css)/i },
      { name: 'GSAP', category: 'Libraries', src: /\/gsap(?:\.min)?\.js|greensock/i },
      { name: 'Stripe', category: 'Payments', src: /js\.stripe\.com/i },
      { name: 'PayPal', category: 'Payments', src: /paypal\.com\/sdk\/js|paypalobjects\.com/i },
      { name: 'Intercom', category: 'Chat', src: /widget\.intercom\.io|js\.intercomcdn\.com/i, inline: /intercomSettings/ },
      { name: 'Crisp', category: 'Chat', src: /client\.crisp\.chat/i, inline: /CRISP_WEBSITE_ID/ },
      { name: 'Tawk.to', category: 'Chat', src: /embed\.tawk\.to/i, inline: /embed\.tawk\.to/ },
      { name: 'Zendesk', category: 'Chat', src: /static\.zdassets\.com|zopim\.com/i },
      { name: 'Drift', category: 'Chat', src: /js\.driftt\.com/i, inline: /drift\.load\(/ },
      { name: 'reCAPTCHA', category: 'Captcha', src: /google\.com\/recaptcha|gstatic\.com\/recaptcha|recaptcha\.net\/recaptcha/i },
      { name: 'hCaptcha', category: 'Captcha', src: /hcaptcha\.com\/1\/api\.js|js\.hcaptcha\.com/i },
      { name: 'Cloudflare Turnstile', category: 'Captcha', src: /challenges\.cloudflare\.com\/turnstile/i },
      { name: 'Cookiebot', category: 'Cookie consent', src: /consent\.cookiebot\.com/i },
      { name: 'OneTrust', category: 'Cookie consent', src: /cdn\.cookielaw\.org|optanon/i },
      { name: 'CookieYes', category: 'Cookie consent', src: /cdn-cookieyes\.com|\/cookie-law-info\//i },
      { name: 'Complianz', category: 'Cookie consent', src: /\/complianz-gdpr/i }
    ];
    const firstGroup = (m) => (m ? m.slice(1).find(Boolean) || '' : '');
    const found = [];
    for (const t of TECH) {
      const url = urls.find((u) => t.src.test(u));
      const inl = !url && t.inline ? inline.match(t.inline) : null;
      if (!url && !inl) continue;
      const item = { name: t.name, category: t.category, version: '', detail: '', evidence: url ? url.slice(0, 160) : 'Inline script' };
      if (url && t.ver) item.version = firstGroup(url.match(t.ver));
      const id = url ? firstGroup(url.match(t.src)) : firstGroup(inl);
      if (id && /^(G-|GTM-|UA-|\d|[a-z0-9]{6,}$)/i.test(id) && !t.ver) item.detail = id;
      if (t.families) {
        const fams = new Set();
        urls.filter((u) => t.src.test(u)).forEach((u) => {
          try { new URL(u).searchParams.getAll('family').forEach((f) => f.split('|').forEach((x) => fams.add(x.split(':')[0].replace(/\+/g, ' ').trim()))); } catch (e) {}
        });
        item.detail = Array.from(fams).filter(Boolean).slice(0, 6).join(', ');
      }
      found.push(item);
    }
    return found;
  }

  // --- SEO and metadata, read from the DOM (no extra requests) ---
  function readSeo() {
    const q = (sel) => document.querySelector(sel);
    const meta = (sel) => ((q(sel) && q(sel).getAttribute('content')) || '').trim();
    const types = new Set();
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        const walk = (n) => {
          if (!n || typeof n !== 'object') return;
          if (Array.isArray(n)) { n.forEach(walk); return; }
          [].concat(n['@type'] || []).forEach((x) => { if (typeof x === 'string') types.add(x); });
          if (n['@graph']) walk(n['@graph']);
        };
        walk(JSON.parse(el.textContent));
      } catch (e) {}
    });
    const canonical = q('link[rel="canonical"]');
    return {
      title: (document.title || '').trim().slice(0, 300),
      description: meta('meta[name="description" i]').slice(0, 400),
      canonical: canonical ? canonical.href : '',
      robots: meta('meta[name="robots" i]'),
      xRobots: xRobotsTag,
      lang: document.documentElement.getAttribute('lang') || '',
      h1: document.querySelectorAll('h1').length,
      ogTitle: meta('meta[property="og:title"]').slice(0, 300),
      ogImage: meta('meta[property="og:image"]'),
      twitterCard: meta('meta[name="twitter:card" i]'),
      schema: Array.from(types).slice(0, 12),
      hreflang: document.querySelectorAll('link[rel="alternate"][hreflang]').length
    };
  }

  // --- Multisite: network sub-sites keep uploads in /wp-content/uploads/sites/<id>/ (or legacy blogs.dir)
  function detectMultisite() {
    const html = Array.from(document.querySelectorAll('img[src], source[srcset], link[href], script[src], a[href]')).slice(0, 400)
      .map((e) => e.getAttribute('src') || e.getAttribute('srcset') || e.getAttribute('href') || '').join(' ');
    const m = html.match(/\/wp-content\/uploads\/sites\/(\d+)\//) || html.match(/\/wp-content\/blogs\.dir\/(\d+)\//);
    return m ? { siteId: Number(m[1]) } : null;
  }

  let tech = [], seo = null, multisite = null;
  try { tech = detectTech(); } catch (e) {}
  try { seo = readSeo(); } catch (e) {}
  try { multisite = detectMultisite(); } catch (e) {}

  return {
    isWP,
    pageTitle: restSiteName || document.title || 'WordPress Site',
    faviconUrl: document.querySelector('link[rel~="icon"]')?.href || `${origin}/favicon.ico`,
    url: document.location.href,
    origin,
    protocol: urlParams.protocol,
    version,
    theme,
    themeName: themeName || '',
    themeVersion,
    themeAuthor,
    themeAuthorUri: themeAuthorUri || '',
    themeDescription: themeDescription || '',
    themeStylesheet,
    isChildTheme,
    parentTheme,
    isUserLoggedIn,
    pageBuilder,
    hasGutenberg,
    hostingPlatform,
    ecommerce,
    serverSoftware,
    proxyCDN,
    phpVersion,
    cacheSystem,
    cacheHeaderStatus,
    cacheDetail,
    signals,
    signalScore,
    confidence,
    plugins,
    tech,
    seo,
    multisite,
    securityHeaders: headersChecked ? securityHeaders : null
  };
}

  // <deep-checks>
  // Extra checks that request public paths on the site. Run only when the popup asks
  // (WP_DEEP_CHECKS), never on ordinary page views. Same-origin, no cookies.
  async function deepChecks() {
    const origin = location.origin;
    // Where WordPress lives: from the REST API link (e.g. https://example.com/news/wp-json/), else the domain root.
    const apiEl = document.querySelector('link[rel="https://api.w.org/"]');
    const apiHref = apiEl && apiEl.href ? apiEl.href : origin + '/wp-json/';
    const plainRest = /[?&]rest_route=/.test(apiHref);
    const base = plainRest ? apiHref.split('?')[0].replace(/index\.php$/, '').replace(/\/?$/, '/') : apiHref.replace(/wp-json\/?$/, '').replace(/\/?$/, '/');
    const restRoot = plainRest ? null : apiHref.replace(/\/?$/, '/');
    const rest = (route, query) => (restRoot ? `${restRoot}${route}?${query}` : `${base}?rest_route=/${route}&${query}`);
    const at = (path) => base + path.replace(/^\//, '');
    const get = async (url, limit) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
        const text = (await r.text()).slice(0, limit);
        return { status: r.status, ok: r.ok, type: r.headers.get('content-type') || '', total: r.headers.get('x-wp-total'), text };
      } catch (e) {
        return { status: 0, ok: false, type: '', text: '', error: e && e.name === 'AbortError' ? 'timeout' : 'failed' };
      } finally {
        clearTimeout(timer);
      }
    };
    const [xmlrpc, users, readme, uploads, debugLog, robots, smWp, smIndex, smPlain, posts, pages, products] = await Promise.all([
      get(at('xmlrpc.php'), 600),
      get(rest('wp/v2/users', 'per_page=10&_fields=slug,name'), 20000),
      get(at('readme.html'), 4000),
      get(at('wp-content/uploads/'), 4000),
      get(at('wp-content/debug.log'), 400),
      get(origin + '/robots.txt', 10000),
      get(at('wp-sitemap.xml'), 800),
      get(at('sitemap_index.xml'), 800),
      get(at('sitemap.xml'), 800),
      get(rest('wp/v2/posts', 'per_page=1&_fields=date,modified'), 2000),
      get(rest('wp/v2/pages', 'per_page=1&_fields=id'), 500),
      get(rest('wc/store/v1/products', 'per_page=1&_fields=id'), 500)
    ]);
    // Content stats from the REST API totals (X-WP-Total) and the newest post's date.
    const count = (r) => (r.ok && r.total !== null && r.total !== undefined && /^\d+$/.test(r.total) ? Number(r.total) : null);
    let latestPost = '';
    if (posts.ok) { try { const a = JSON.parse(posts.text); if (Array.isArray(a) && a[0]) latestPost = a[0].date || a[0].modified || ''; } catch (e) {} }
    const content = { posts: count(posts), pages: count(pages), products: count(products), latestPost };
    let userList = null;
    if (users.ok) {
      try { const a = JSON.parse(users.text); if (Array.isArray(a)) userList = a.map((u) => u.slug || u.name).filter(Boolean).slice(0, 10); } catch (e) {}
    }
    const isHtml = (r) => /text\/html/i.test(r.type) || /<html|<!doctype html/i.test(r.text);
    const readmeHit = readme.ok && /wordpress/i.test(readme.text) && /<title>\s*WordPress/i.test(readme.text);
    const basePath = new URL(base).pathname;
    const sitemap = [[basePath + 'wp-sitemap.xml', smWp], [basePath + 'sitemap_index.xml', smIndex], [basePath + 'sitemap.xml', smPlain]].find(([, r]) => r.ok && /<(urlset|sitemapindex)[\s>]/i.test(r.text));
    const robotsText = robots.ok && !isHtml(robots) ? robots.text : null;
    // Parse robots.txt groups: "blocks everything" only when the group for all crawlers (*) has "Disallow: /".
    let disallowAll = false;
    if (robotsText) {
      let agents = [], inRules = false, starGroup = false;
      for (const raw of robotsText.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const key = m[1].toLowerCase(), val = m[2].trim();
        if (key === 'user-agent') {
          if (inRules) { agents = []; inRules = false; }
          agents.push(val.toLowerCase());
          starGroup = agents.includes('*');
        } else if (key === 'disallow' || key === 'allow') {
          inRules = true;
          if (starGroup && key === 'disallow' && val === '/') disallowAll = true;
        }
      }
    }
    return {
      checkedAt: Date.now(),
      base,
      xmlrpc: { status: xmlrpc.status, enabled: /XML-RPC server accepts POST requests only/i.test(xmlrpc.text) },
      users: { status: users.status, exposed: !!(userList && userList.length), list: userList || [] },
      readme: { status: readme.status, exposed: !!readmeHit, version: readmeHit ? ((readme.text.match(/Version\s+(\d[\d.]*)/i) || [])[1] || '') : '' },
      uploadsListing: { status: uploads.status, exposed: uploads.ok && /<title>\s*Index of/i.test(uploads.text) },
      debugLog: { status: debugLog.status, exposed: debugLog.ok && !isHtml(debugLog) && debugLog.text.trim().length > 0 },
      sitemap: sitemap ? { found: true, path: sitemap[0] } : { found: false },
      robots: robotsText === null ? { found: false, status: robots.status } : { found: true, sitemapLine: /^\s*sitemap:/im.test(robotsText), disallowAll },
      content
    };
  }

  // Performance snapshot for this visit, from the browser's own timing data. No requests.
  function readPerf() {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const imgs = Array.from(document.images);
    const isModern = (i) => /\.(webp|avif)(?:[?#]|$)/i.test(i.currentSrc || i.src || '') ||
      !!(i.closest('picture') && i.closest('picture').querySelector('source[type="image/webp"], source[type="image/avif"]'));
    let bytes = nav.transferSize || 0, hidden = 0;
    for (const r of res) { if (r.transferSize) bytes += r.transferSize; else if (!r.decodedBodySize) hidden++; }
    const head = document.head;
    return {
      ttfb: nav.responseStart ? Math.round(nav.responseStart - (nav.activationStart || 0)) : null,
      domReady: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      protocol: nav.nextHopProtocol || '',
      requests: res.length + 1,
      bytes,
      bytesPartial: hidden > 0,
      images: imgs.length,
      modernImages: imgs.filter(isModern).length,
      lazyImages: imgs.filter((i) => i.loading === 'lazy').length,
      blockingScripts: head ? head.querySelectorAll('script[src]:not([async]):not([defer]):not([type="module"])').length : 0,
      stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      domNodes: document.getElementsByTagName('*').length
    };
  }
  // </deep-checks>

  let deepChecksPromise = null;

  let lastScanResult = null;
  let scanInFlight = null;

  // One scan at a time: callers that arrive mid-scan share the same promise.
  function scan() {
    if (!scanInFlight) {
      scanInFlight = detectWordPress()
        .then((data) => { lastScanResult = data; return data; })
        .finally(() => { scanInFlight = null; });
    }
    return scanInFlight;
  }

  async function performScanAndNotify() {
    if (scanInFlight) return;
    try {
      if (!isWordPressSite()) {
        try {
          chrome.runtime.sendMessage({
            type: 'WP_PREFETCH_DATA',
            isWP: false,
            data: { isWP: false, url: window.location.href }
          }).catch(() => {});
        } catch(e) {}
        return;
      }

      const scanResult = await scan();

      try {
        chrome.runtime.sendMessage({
          type: 'WP_PREFETCH_DATA',
          isWP: Boolean(scanResult && scanResult.isWP),
          data: scanResult
        }).catch(() => {});
      } catch(e) {}
    } catch (e) {}
  }

  // 3. Respond to on-demand messages from popup or background worker
  try {
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.type === 'WP_CHECK') {
          sendResponse({ isWP: isWordPressSite() });
          return;
        }

        if (msg && msg.type === 'WP_RESCAN') {
          scan().then(data => {
            try {
              chrome.runtime.sendMessage({
                type: 'WP_PREFETCH_DATA',
                isWP: Boolean(data && data.isWP),
                data
              }).catch(() => {});
            } catch(e) {}
            sendResponse({ ok: true, data });
          }).catch(err => {
            sendResponse({ ok: false, error: err.message });
          });
          return true; // asynchronous response
        }

        if (msg && msg.type === 'WP_PERF') {
          try { sendResponse({ ok: true, data: readPerf() }); } catch (err) { sendResponse({ ok: false }); }
          return;
        }

        if (msg && msg.type === 'WP_DEEP_CHECKS') {
          if (!deepChecksPromise) deepChecksPromise = deepChecks().catch((e) => { deepChecksPromise = null; throw e; });
          deepChecksPromise.then((data) => sendResponse({ ok: true, data })).catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
          return true;
        }

        if (msg && msg.type === 'GET_CONTENT_DATA') {
          if (lastScanResult) {
            sendResponse({ ok: true, data: lastScanResult });
          } else {
            scan().then(data => {
              sendResponse({ ok: true, data });
            }).catch(err => {
              sendResponse({ ok: false, error: err.message });
            });
            return true;
          }
        }
      });
    }
  } catch (e) {}

  // 4. Multi-stage passive scanning
  // Immediate scan on document_end
  if (isWordPressSite()) {
    performScanAndNotify();
  }

  // Delayed checks for deferred scripts, late stylesheets, and SPA hydration
  setTimeout(() => {
    if (isWordPressSite() && !lastScanResult) performScanAndNotify();
  }, 1000);

  setTimeout(() => {
    if (isWordPressSite() && !lastScanResult) performScanAndNotify();
  }, 2500);

  window.addEventListener('load', () => {
    if (isWordPressSite() && !lastScanResult) performScanAndNotify();
  }, { once: true });

  // Lightweight MutationObserver for dynamic script/stylesheet injection
  let observer = null;
  try {
    // Throttled: busy single-page apps can fire thousands of mutations a second.
    let pendingCheck = null;
    observer = new MutationObserver(() => {
      if (pendingCheck) return;
      pendingCheck = setTimeout(() => {
        pendingCheck = null;
        if (observer && isWordPressSite() && !lastScanResult) {
          performScanAndNotify();
          observer.disconnect();
          observer = null;
        }
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, 8000);
  } catch (e) {}
})();
