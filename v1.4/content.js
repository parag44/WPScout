// ==========================================================================
// WPScout - Fast Content Script Detector & Background Scanner
// Automatically detects WordPress, resolves active theme & plugins,
// and notifies background service worker to update toolbar badge and cache.
// ==========================================================================

(function() {
  // 1. Fast Synchronous Pre-Check (sub-millisecond)
  function isWordPressSite() {
    // 1. Meta generator tag
    if (document.querySelector('meta[name="generator"][content*="WordPress" i]')) return true;

    // 2. REST API / RSD / WLW / Feed links
    if (document.querySelector(
      'link[rel="https://api.w.org/"], ' +
      'link[rel*="wp-json" i], ' +
      'link[rel="EditURI"][type*="rsd+xml" i], ' +
      'link[rel="wlwmanifest"], ' +
      'link[type*="rss+xml"][href*="/feed"]'
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
      'style[id*="wp-"], style[id*="global-styles"], ' +
      'style[id*="block-library"], style[id*="classic-theme-styles"], ' +
      'link[id*="wp-block-"], link[id*="wp-emoji"]'
    )) return true;

    // 5. Admin bar (logged in) & common body/block classes
    if (document.getElementById('wpadminbar')) return true;
    if (document.querySelector(
      'body[class*="wp-"], body[class*="page-template"], body[class*="theme-"], ' +
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

  // Check RSS Feed generators
  const rssLink = document.querySelector('link[type*="rss+xml"], link[rel="alternate"][type*="xml"]');
  if (rssLink && rssLink.href && rssLink.href.includes('/feed')) {
    if (!signals.generator.detected) {
      signals.generator.detected = true;
      signals.generator.detail = `RSS Feed: ${rssLink.href}`;
    }
  }

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

      const bodyThemeMatch = token.match(/^(?:wp-theme|theme)-([a-zA-Z0-9_-]+)$/i);
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
      const styleRes = await fetch(styleUrl);
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

  // If theme was found via inlined block theme signals or style.css, ensure wpContent signal reflects it
  if (theme !== 'Unknown' && !signals.wpContent.detected) {
    signals.wpContent.detected = true;
    signals.wpContent.detail = `Theme detected (${themeName || theme})`;
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

  try {
    const abortCtrl = new AbortController();
    let response;
    try {
      response = await fetch(document.location.href, {
        method: 'GET',
        signal: abortCtrl.signal
      });
    } catch (e) {
      response = await fetch(document.location.href, { method: 'HEAD' });
    }

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

    abortCtrl.abort();
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
    let restRes = await fetch(origin + '/wp-json');
    if (!restRes.ok) restRes = await fetch(origin + '/?rest_route=/');

    if (restRes.ok) {
      const restData = await restRes.json();
      if (restData && restData.namespaces && Array.isArray(restData.namespaces)) {
        isWP = true;
        signals.api.detected = true;
        signals.api.detail = `${origin}/wp-json (${restData.namespaces.length} namespaces)`;

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
                  evidence: `${origin}/wp-json/${ns}`
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
                  evidence: `${origin}/wp-json${matchedRoute}`
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
  if (signals.wpContent.detected) signalScore++;
  if (signals.wpIncludes.detected) signalScore++;
  if (signals.linkRel.detected) signalScore++;
  if (signals.adminPaths.detected) signalScore++;

  let confidence = '0%';
  if (signalScore >= 5) confidence = '98%';
  else if (signalScore >= 3) confidence = '90%';
  else if (signalScore >= 1) confidence = '75%';

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
    plugins
  };
}

  let isScanning = false;
  let lastScanResult = null;

  async function performScanAndNotify() {
    if (isScanning) return;
    isScanning = true;
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

      const scanResult = await detectWordPress();
      lastScanResult = scanResult;

      try {
        chrome.runtime.sendMessage({
          type: 'WP_PREFETCH_DATA',
          isWP: Boolean(scanResult && scanResult.isWP),
          data: scanResult
        }).catch(() => {});
      } catch(e) {}
    } catch (e) {
    } finally {
      isScanning = false;
    }
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
          detectWordPress().then(data => {
            lastScanResult = data;
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

        if (msg && msg.type === 'GET_CONTENT_DATA') {
          if (lastScanResult) {
            sendResponse({ ok: true, data: lastScanResult });
          } else {
            detectWordPress().then(data => {
              lastScanResult = data;
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

  // Prevent duplicate execution in the same frame
  if (window.__wpscout_content_injected) return;
  window.__wpscout_content_injected = true;

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
    observer = new MutationObserver(() => {
      if (isWordPressSite() && !lastScanResult) {
        performScanAndNotify();
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
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
