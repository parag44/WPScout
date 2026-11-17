/**
 * WPScout Landing Page Interactive Scripts
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // 1. Interactive Demo Simulator Data
  // ==========================================
  const demoData = {
    wordpress: {
      url: 'https://wordpress.org',
      isWP: true,
      statusText: 'WordPress 6.7 Verified',
      statusClass: 'status-wp',
      core: '6.7 (Latest Stable)',
      gutenberg: 'Active (Block Engine)',
      theme: 'Wporg Main Theme',
      author: 'WordPress.org Community',
      parentTheme: 'None (Standalone)',
      server: 'Nginx / OpenResty',
      cdn: 'Automattic Edge CDN',
      cacheStatus: 'HIT',
      cacheClass: 'hit',
      php: '8.2 (Exposed via FastCGI)',
      hostIp: '198.143.164.252 (USA)',
      nameservers: 'ns1.wordpress.org, ns2.wordpress.org',
      plugins: [
        'wporg-mu-plugins v2.1',
        'wporg-markdown v1.4',
        'rest-api-helpers v3.0',
        'jetpack-boost v3.2',
        'akismet v5.3.3',
        'two-factor v0.9'
      ],
      signals: '7/7 Signals Passed (REST, Links, Assets, Meta, wp-content, wp-includes, Admin)'
    },
    techcrunch: {
      url: 'https://techcrunch.com',
      isWP: true,
      statusText: 'WordPress VIP Detected',
      statusClass: 'status-wp',
      core: '6.6.2 (VIP Enterprise Branch)',
      gutenberg: 'Active (Full Site Editing)',
      theme: 'TechCrunch 2024 Modern',
      author: 'Yahoo Inc. / VIP Architecture',
      parentTheme: 'Automattic VIP Framework',
      server: 'Nginx Enterprise / VIP Go',
      cdn: 'Fastly Edge Cloud',
      cacheStatus: 'HIT',
      cacheClass: 'hit',
      php: '8.3 (VIP Hardened)',
      hostIp: '192.0.66.168 (USA)',
      nameservers: 'ns1.wordpress.com, ns2.wordpress.com',
      plugins: [
        'vip-go-mu-plugins v4.1',
        'parse-ly-analytics v3.4',
        'wordpress-seo-premium v23.4',
        'co-authors-plus v3.6',
        'safecss v1.9',
        'jetpack-vip v12.8'
      ],
      signals: '7/7 Signals Passed'
    },
    woocommerce: {
      url: 'https://woocommerce.com',
      isWP: true,
      statusText: 'WordPress 6.7 + WooCommerce',
      statusClass: 'status-wp',
      core: '6.7.0 (Official WP.org)',
      gutenberg: 'Active (Woo Blocks)',
      theme: 'WooCommerce Storefront Pro',
      author: 'WooCommerce Core Team',
      parentTheme: 'Storefront Core',
      server: 'Nginx + Varnish Cache',
      cdn: 'Cloudflare Enterprise',
      cacheStatus: 'DYNAMIC',
      cacheClass: 'dynamic',
      php: '8.2.14',
      hostIp: '104.18.28.114 (Cloudflare Anycast)',
      nameservers: 'cameron.ns.cloudflare.com, ray.ns.cloudflare.com',
      plugins: [
        'woocommerce v9.4.2',
        'woocommerce-subscriptions v6.8',
        'woocommerce-payments v8.6',
        'automatewoo v6.1',
        'yoast-seo v23.8',
        'wp-rocket v3.16'
      ],
      signals: '7/7 Signals Passed'
    },
    nonwp: {
      url: 'https://github.com',
      isWP: false,
      statusText: 'Not a WordPress Site',
      statusClass: 'status-nonwp',
      core: 'N/A (Ruby on Rails / Go)',
      gutenberg: 'N/A',
      theme: 'N/A (Custom Primer React UI)',
      author: 'GitHub, Inc.',
      parentTheme: 'N/A',
      server: 'GitHub Frontend Proxy',
      cdn: 'Fastly CDN',
      cacheStatus: 'BYPASS',
      cacheClass: 'dynamic',
      php: 'N/A',
      hostIp: '140.82.121.4 (USA)',
      nameservers: 'dns1.p08.nsone.net, dns2.p08.nsone.net',
      plugins: [],
      signals: '0/7 Signals Detected (Safe negative check)'
    }
  };

  let currentDemoTarget = 'wordpress';

  function renderDemo(targetKey) {
    const data = demoData[targetKey] || demoData.wordpress;
    currentDemoTarget = targetKey;

    const urlElem = document.getElementById('sim-url-text');
    const statusElem = document.getElementById('sim-status-pill');
    const bodyElem = document.getElementById('sim-body-content');

    urlElem.textContent = data.url;
    statusElem.textContent = data.statusText;
    statusElem.className = `status-pill ${data.statusClass}`;

    if (!data.isWP) {
      bodyElem.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 40px; margin-bottom: 12px;">🔍</div>
          <h3 style="color: #ffffff; font-size: 18px; margin-bottom: 8px;">No WordPress Signals Found</h3>
          <p style="color: #94a3b8; font-size: 14px; max-width: 480px; margin: 0 auto 20px auto;">
            WPScout inspected headers, meta tags, script assets, and REST API routes for <code>${data.url}</code>. No WordPress signatures were found.
          </p>
          <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.06); padding: 8px 16px; border-radius: 9999px; font-size: 12px; color: #cbd5e1;">
            <span>Detected Server: <strong>${data.server}</strong></span>
            <span>•</span>
            <span>Edge: <strong>${data.cdn}</strong></span>
          </div>
        </div>
      `;
      return;
    }

    const pluginsHtml = data.plugins.map(p => `<span class="sim-plugin-pill">🧩 ${p}</span>`).join('');

    bodyElem.innerHTML = `
      <div class="sim-grid">
        <!-- Card 1: Core & Theme -->
        <div class="sim-card">
          <div class="sim-card-header">
            <span>WordPress & Theme</span>
            <span style="color: #38bdf8;">Verified</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">WP Version:</span>
            <span class="sim-val">${data.core}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Editor:</span>
            <span class="sim-val">${data.gutenberg}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Active Theme:</span>
            <span class="sim-val">${data.theme}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Parent Theme:</span>
            <span class="sim-val">${data.parentTheme}</span>
          </div>
        </div>

        <!-- Card 2: Server & Caching -->
        <div class="sim-card">
          <div class="sim-card-header">
            <span>Server & Caching</span>
            <span class="sim-tag ${data.cacheClass}">Cache: ${data.cacheStatus}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Web Server:</span>
            <span class="sim-val">${data.server}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Edge CDN:</span>
            <span class="sim-val">${data.cdn}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">PHP Runtime:</span>
            <span class="sim-val">${data.php}</span>
          </div>
          <div class="sim-val-row">
            <span class="sim-key">Host IPv4:</span>
            <span class="sim-val">${data.hostIp}</span>
          </div>
        </div>
      </div>

      <!-- Plugins Section -->
      <div class="sim-card" style="margin-top: 16px;">
        <div class="sim-card-header">
          <span>Detected Plugins (REST API & Enqueued Assets)</span>
          <span style="color: #c084fc;">${data.plugins.length} Detected</span>
        </div>
        <div class="sim-plugins-list">
          ${pluginsHtml}
        </div>
      </div>
    `;
  }

  // Handle Demo Buttons
  const demoButtons = document.querySelectorAll('.demo-btn');
  demoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      demoButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDemo(btn.dataset.target);
    });
  });

  // Initial Demo Render
  renderDemo('wordpress');

  // Copy Report in Demo Simulator
  const copyBtn = document.getElementById('sim-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const data = demoData[currentDemoTarget] || demoData.wordpress;
      const report = `### WPScout Diagnostic Report: ${data.url}
- **WordPress Core:** ${data.core}
- **Active Theme:** ${data.theme} (Parent: ${data.parentTheme})
- **Server:** ${data.server}
- **Edge CDN:** ${data.cdn}
- **Cache Status:** ${data.cacheStatus}
- **Plugins:** ${data.plugins.join(', ') || 'None'}
- **Resolved IP:** ${data.hostIp}
*Generated by WPScout Chrome Extension*`;

      navigator.clipboard.writeText(report).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = `<span>✓ Copied!</span>`;
        copyBtn.style.color = '#34d399';
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.style.color = '';
        }, 2000);
      });
    });
  }

  // ==========================================
  // 2. Screenshot Gallery Tabs
  // ==========================================
  const galleryTabs = document.querySelectorAll('.gallery-tab-btn');
  const gallerySlides = document.querySelectorAll('.gallery-slide');

  galleryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      galleryTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = `gallery-${tab.dataset.tab}`;
      gallerySlides.forEach(slide => {
        slide.classList.remove('active');
        if (slide.id === targetId) {
          slide.classList.add('active');
        }
      });
    });
  });

  // ==========================================
  // 3. FAQ Accordion
  // ==========================================
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      // Close other items
      faqItems.forEach(i => i.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // ==========================================
  // 4. Smooth Anchor Scrolling
  // ==========================================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }
    });
  });

  // ==========================================
  // 5. Theme Toggle (Light / Dark Mode)
  // ==========================================
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      try {
        localStorage.setItem('wpscout-theme', newTheme);
      } catch (e) {}
    });
  }

  // Listen to OS theme changes if user hasn't explicitly set a preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('wpscout-theme')) {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      }
    });
  }
});
