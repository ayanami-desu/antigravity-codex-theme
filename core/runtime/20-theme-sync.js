/**
 * Part 20: Light/Dark Theme Mode Sync & Starlight Anime Layer Mount
 */
  const PRESETS = {
    STARLIGHT_LIGHT: 'starlight-light',
    STARLIGHT_DARK: 'starlight-dark',
    CODEX_PURE_WHITE: 'codex-pure-white',
    CODEX_DARK: 'codex-dark'
  };
  const ALL_CUSTOM_PRESET_NAMES = new Set([...Object.values(PRESETS), 'onyx-dark']);

  if (window.__ag_theme_mode_observer) {
    try { window.__ag_theme_mode_observer.disconnect(); } catch (e) {}
    window.__ag_theme_mode_observer = null;
  }

  function findOuterSidebar() {
    if (typeof document.querySelectorAll !== 'function') return null;
    const list = document.querySelectorAll('.bg-sidebar');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (
        el &&
        el.classList &&
        el.classList.contains('flex-col') &&
        el.classList.contains('h-full') &&
        (!el.closest || (!el.closest('[data-testid="settings-sidebar"]') && !el.closest('.overscroll-none')))
      ) {
        return el;
      }
    }
    return null;
  }

  function normalizeMascotPos(val) {
    return val === 'sidebar' ? 'sidebar' : 'content-left';
  }

  function syncBgLayer() {
    let bgLayer = document.getElementById('ag-anime-bg-layer');
    if (!bgLayer) {
      bgLayer = document.createElement('div');
      bgLayer.id = 'ag-anime-bg-layer';
      bgLayer.setAttribute('aria-hidden', 'true');
      if (typeof document.body.prepend === 'function') {
        document.body.prepend(bgLayer);
      } else if (typeof document.body.appendChild === 'function') {
        document.body.appendChild(bgLayer);
      }
    }
    return document.getElementById('ag-anime-bg-layer');
  }

  function syncMascotLayer(hasMascotAsset, posMode, bgLayer) {
    let mascotLayer = document.getElementById('ag-anime-mascot-layer');
    const outerSidebar = findOuterSidebar();
    if (outerSidebar && typeof outerSidebar.setAttribute === 'function') {
      outerSidebar.setAttribute('data-ag-outer-sidebar', '1');
    }

    if (!hasMascotAsset) {
      if (typeof window.__ag_mascot_avoid_teardown === 'function') {
        try { window.__ag_mascot_avoid_teardown(); } catch (e) {}
      }
      if (typeof window.__ag_content_mascot_teardown === 'function') {
        try { window.__ag_content_mascot_teardown(); } catch (e) {}
      }
      if (mascotLayer) mascotLayer.remove();
      return;
    }

    const targetParent = posMode === 'sidebar' ? outerSidebar : document.body;
    if (!targetParent) {
      if (mascotLayer) mascotLayer.remove();
      return;
    }

    if (!mascotLayer) {
      mascotLayer = document.createElement('div');
      mascotLayer.id = 'ag-anime-mascot-layer';
      mascotLayer.setAttribute('aria-hidden', 'true');
    }
    if (mascotLayer.parentNode !== targetParent) {
      if (targetParent === document.body) {
        if (bgLayer && bgLayer.parentNode === document.body && typeof document.body.insertBefore === 'function') {
          document.body.insertBefore(mascotLayer, bgLayer.nextSibling);
        } else if (typeof document.body.appendChild === 'function') {
          document.body.appendChild(mascotLayer);
        }
      } else if (typeof targetParent.appendChild === 'function') {
        targetParent.appendChild(mascotLayer);
      }
    }

    if (posMode === 'sidebar') {
      if (typeof window.__ag_content_mascot_teardown === 'function') {
        try { window.__ag_content_mascot_teardown(); } catch (e) {}
      }
      if (mascotLayer.style && typeof mascotLayer.style.removeProperty === 'function') {
        mascotLayer.style.removeProperty('--ag-mascot-left');
        mascotLayer.style.removeProperty('--ag-mascot-scale');
      }
      ensureSidebarMascotAvoidance(outerSidebar, mascotLayer);
      scheduleSidebarMascotAvoidance();
    } else {
      if (typeof window.__ag_mascot_avoid_teardown === 'function') {
        try { window.__ag_mascot_avoid_teardown(); } catch (e) {}
      }
      if (mascotLayer.style && typeof mascotLayer.style.removeProperty === 'function') {
        mascotLayer.style.removeProperty('--ag-mascot-avoid-scale');
      }
      ensureContentLeftMascotObserver(mascotLayer);
      updateContentLeftMascotLayout();
      scheduleContentLeftMascotLayout();
    }
  }

  function ensureAnimeMountObserver() {
    if (window.__ag_anime_mount_obs || typeof MutationObserver !== 'function' || !document.body) return;
    let lastHasChatSurface = Boolean(
      document.getElementById('antigravity.agentSidePanelInputBox') ||
        (typeof document.querySelector === 'function' && document.querySelector('[data-autoscroll-overlay-host="true"]'))
    );
    const scheduleMount = () => {
      if (window.__ag_anime_mount_raf) return;
      const run = () => {
        window.__ag_anime_mount_raf = 0;
        syncAnimeLayers();
      };
      if (typeof requestAnimationFrame === 'function') {
        window.__ag_anime_mount_raf = requestAnimationFrame(run);
      } else {
        run();
      }
    };
    try {
      const obs = new MutationObserver(() => {
        if (MODULES.theme === false || IS_SWARM_PLUGIN_FRAME || !document.body) return;
        const posMode = normalizeMascotPos(MASCOT_POSITION);
        const outerSidebar = findOuterSidebar();
        const hasMascotUrl = Boolean(
          SHOW_MASCOT && THEME_ASSETS && THEME_ASSETS.mascotUrls && THEME_ASSETS.mascotUrls['1']
        );
        const needSidebarMascot = Boolean(
          hasMascotUrl &&
            posMode === 'sidebar' &&
            outerSidebar &&
            !document.getElementById('ag-anime-mascot-layer')
        );
        const needBodyMascot = Boolean(
          hasMascotUrl &&
            posMode !== 'sidebar' &&
            !document.getElementById('ag-anime-mascot-layer')
        );
        const box = document.getElementById('antigravity.agentSidePanelInputBox');
        const hasChatSurface = Boolean(
          box || (typeof document.querySelector === 'function' && document.querySelector('[data-autoscroll-overlay-host="true"]'))
        );
        if (posMode === 'content-left' && hasMascotUrl && hasChatSurface !== lastHasChatSurface) {
          lastHasChatSurface = hasChatSurface;
          scheduleContentLeftMascotLayout();
        }
        const comp = document.getElementById('ag-composer-companion');
        const needCompanion = Boolean(
          SHOW_MASCOT &&
            THEME_ASSETS &&
            THEME_ASSETS.composerIdleUrl &&
            box &&
            (!comp || comp.parentNode !== box)
        );
        const needBg = !document.getElementById('ag-anime-bg-layer');
        if (needSidebarMascot || needBodyMascot || needCompanion || needBg) {
          scheduleMount();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      window.__ag_anime_mount_obs = obs;
      if (Array.isArray(window.__ag_cleanup_fns)) {
        window.__ag_cleanup_fns.push(() => {
          try { obs.disconnect(); } catch (e) {}
          if (window.__ag_anime_mount_raf && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(window.__ag_anime_mount_raf);
            window.__ag_anime_mount_raf = 0;
          }
          window.__ag_anime_mount_obs = null;
        });
      }
    } catch (e) {}
  }

  function syncAnimeLayers() {
    const docEl = document.documentElement;
    if (!docEl) return;
    if (MODULES.theme === false) {
      for (const id of ['ag-anime-bg-layer', 'ag-anime-mascot-layer', 'ag-composer-companion']) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
      docEl.removeAttribute('data-ag-bg-dim');
      docEl.removeAttribute('data-ag-mascot-pos');
      docEl.removeAttribute('data-ag-mascot-variant');
      docEl.removeAttribute('data-ag-mascot-size');
      docEl.removeAttribute('data-ag-composer-active');
      return;
    }

    const posMode = normalizeMascotPos(MASCOT_POSITION);
    const variantMode = typeof MASCOT_VARIANT === 'string' && (MASCOT_VARIANT === '1' || MASCOT_VARIANT === '2' || MASCOT_VARIANT === '3' || MASCOT_VARIANT === '4')
      ? MASCOT_VARIANT
      : 'auto';
    docEl.removeAttribute('data-ag-show-bg');
    docEl.removeAttribute('data-ag-glass-blur');
    docEl.setAttribute('data-ag-bg-dim', typeof BG_DIM === 'string' ? BG_DIM : 'medium');
    docEl.setAttribute('data-ag-mascot-pos', posMode);
    docEl.setAttribute('data-ag-mascot-variant', variantMode);
    docEl.setAttribute('data-ag-mascot-size', typeof MASCOT_SIZE === 'string' ? MASCOT_SIZE : 'md');

    if (IS_SWARM_PLUGIN_FRAME || !document.body) return;
    const hasMascotAsset = Boolean(
      SHOW_MASCOT &&
        THEME_ASSETS &&
        THEME_ASSETS.mascotUrls &&
        typeof THEME_ASSETS.mascotUrls === 'object' &&
        THEME_ASSETS.mascotUrls['1']
    );

    const bgLayer = syncBgLayer();
    syncMascotLayer(hasMascotAsset, posMode, bgLayer);
    syncComposerCompanion();
    ensureAnimeMountObserver();
  }

  window.__ag_apply_visual_config = function (cfg, nextVersion) {
    if (!cfg || typeof cfg !== 'object') return false;
    if (typeof cfg.showMascot === 'boolean') SHOW_MASCOT = cfg.showMascot;
    if (cfg.mascotPosition === 'content-left' || cfg.mascotPosition === 'sidebar') {
      MASCOT_POSITION = cfg.mascotPosition;
    }
    if (cfg.mascotVariant === 'auto' || cfg.mascotVariant === '1' || cfg.mascotVariant === '2' || cfg.mascotVariant === '3' || cfg.mascotVariant === '4') {
      MASCOT_VARIANT = cfg.mascotVariant;
    }
    if (cfg.mascotSize === 'sm' || cfg.mascotSize === 'md' || cfg.mascotSize === 'lg') MASCOT_SIZE = cfg.mascotSize;
    if (cfg.bgDim === 'low' || cfg.bgDim === 'medium' || cfg.bgDim === 'high') BG_DIM = cfg.bgDim;
    if (typeof nextVersion === 'string' && nextVersion) {
      PATCH_VERSION = nextVersion;
      window.__ag_patch_version = nextVersion;
    }
    syncAnimeLayers();
    return true;
  };

  function setComposerActiveState(box, active) {
    const isActive = Boolean(active && box);
    if (box && typeof box.setAttribute === 'function' && typeof box.removeAttribute === 'function') {
      if (isActive) {
        box.setAttribute('data-ag-composer-active', '1');
      } else {
        box.removeAttribute('data-ag-composer-active');
      }
    }
    if (document.documentElement) {
      if (isActive) {
        document.documentElement.setAttribute('data-ag-composer-active', '1');
      } else {
        document.documentElement.removeAttribute('data-ag-composer-active');
      }
    }
  }

  let composerVisuallySuppressed = false;
  let lastOutsideDownAt = 0;

  function syncComposerCompanion() {
    if (IS_SWARM_PLUGIN_FRAME || !document.body) return;
    ensureComposerListeners();
    const hasCompanionAsset = Boolean(
      MODULES.theme !== false &&
        SHOW_MASCOT &&
        THEME_ASSETS &&
        typeof THEME_ASSETS.composerIdleUrl === 'string' &&
        THEME_ASSETS.composerIdleUrl
    );
    let comp = document.getElementById('ag-composer-companion');
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!hasCompanionAsset) {
      if (comp) comp.remove();
      setComposerActiveState(inputBox, false);
      return;
    }
    if (!inputBox || typeof inputBox.appendChild !== 'function') {
      if (comp) comp.remove();
      setComposerActiveState(null, false);
      return;
    }
    if (!comp) {
      comp = document.createElement('div');
      comp.id = 'ag-composer-companion';
      comp.setAttribute('aria-hidden', 'true');
    }
    if (comp.parentNode !== inputBox) {
      inputBox.appendChild(comp);
    }
    const hasWinFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const activeInside =
      !composerVisuallySuppressed &&
      hasWinFocus &&
      document.activeElement &&
      typeof inputBox.contains === 'function' &&
      inputBox.contains(document.activeElement);
    setComposerActiveState(inputBox, activeInside);
    if (
      comp.style &&
      typeof inputBox.getBoundingClientRect === 'function'
    ) {
      const br = inputBox.getBoundingClientRect();
      const mainContainer =
        (typeof inputBox.closest === 'function' && (inputBox.closest('[data-main-content-body]') || inputBox.closest('main'))) ||
        document.body;
      const mr = mainContainer && typeof mainContainer.getBoundingClientRect === 'function' ? mainContainer.getBoundingClientRect() : null;
      const rightBound = mr && mr.right > 0 ? mr.right : (typeof window.innerWidth === 'number' ? window.innerWidth : br.right + 200);
      const spaceRight = Math.max(0, rightBound - br.right);
      let scale = 1;
      let opacity = 1;
      if (spaceRight >= 164) {
        scale = 1;
        opacity = 1;
      } else if (spaceRight >= 98) {
        scale = Math.max(0.58, (spaceRight - 14) / 150);
        opacity = 1;
      } else {
        scale = 0.58;
        opacity = 0;
      }
      comp.style.setProperty('--ag-composer-companion-scale', scale.toFixed(3));
      comp.style.setProperty('--ag-composer-companion-opacity', String(opacity));
    }
  }

  function ensureComposerListeners() {
    if (window.__ag_composer_listeners_ready) return;
    window.__ag_composer_listeners_ready = true;
    const schedule = () => {
      if (window.__ag_comp_raf) return;
      const run = () => {
        window.__ag_comp_raf = 0;
        syncComposerCompanion();
      };
      if (typeof requestAnimationFrame === 'function') {
        window.__ag_comp_raf = requestAnimationFrame(run);
      } else {
        run();
      }
    };
    let outsideDownX = 0;
    let outsideDownY = 0;
    let outsideWasDrag = false;
    let pendingBlurTimer = 0;
    const clearPendingBlur = () => {
      if (pendingBlurTimer) {
        clearTimeout(pendingBlurTimer);
        pendingBlurTimer = 0;
      }
    };
    const hasNonEmptySelection = () => {
      try {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        return Boolean(sel && !sel.isCollapsed && String(sel.toString() || '').length > 0);
      } catch (e) {
        return false;
      }
    };
    const blurComposerIfStillHeld = () => {
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      if (!box || typeof box.contains !== 'function') return false;
      if (!lastOutsideDownAt || Date.now() - lastOutsideDownAt >= 400 || outsideWasDrag || hasNonEmptySelection()) {
        return false;
      }
      const activeEl = document.activeElement;
      if (activeEl && box.contains(activeEl) && typeof activeEl.blur === 'function') {
        try {
          activeEl.blur();
          return true;
        } catch (e) {}
      }
      return false;
    };
    const syncComposerFocusState = (targetEl) => {
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      if (!box || typeof box.contains !== 'function') {
        setComposerActiveState(null, false);
        return;
      }
      const inside = Boolean(targetEl && box.contains(targetEl));
      if (!inside) composerVisuallySuppressed = false;
      setComposerActiveState(box, inside && !composerVisuallySuppressed);
    };
    const onPointerDownCapture = (ev) => {
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      if (!box || typeof box.contains !== 'function') return;
      const target = ev && ev.target;
      if (target && box.contains(target)) {
        clearPendingBlur();
        lastOutsideDownAt = 0;
        outsideWasDrag = false;
        composerVisuallySuppressed = false;
        setComposerActiveState(box, true);
        return;
      }
      if (target && target.closest && target.closest('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) {
        return;
      }
      // Track outside click without calling blur() mid-pointerdown so drag selection and focusable controls work normally
      clearPendingBlur();
      lastOutsideDownAt = Date.now();
      outsideDownX = typeof ev?.clientX === 'number' ? ev.clientX : 0;
      outsideDownY = typeof ev?.clientY === 'number' ? ev.clientY : 0;
      outsideWasDrag = false;
      composerVisuallySuppressed = true;
      setComposerActiveState(box, false);
    };
    const onPointerUpCapture = (ev) => {
      if (!lastOutsideDownAt) return;
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      const target = ev && ev.target;
      if (target && box && typeof box.contains === 'function' && box.contains(target)) {
        return;
      }
      const dx = (typeof ev?.clientX === 'number' ? ev.clientX : outsideDownX) - outsideDownX;
      const dy = (typeof ev?.clientY === 'number' ? ev.clientY : outsideDownY) - outsideDownY;
      if (Math.hypot(dx, dy) > 6 || hasNonEmptySelection()) {
        outsideWasDrag = true;
        return;
      }
      clearPendingBlur();
      pendingBlurTimer = setTimeout(() => {
        pendingBlurTimer = 0;
        if (blurComposerIfStillHeld()) {
          setComposerActiveState(document.getElementById('antigravity.agentSidePanelInputBox'), false);
        }
      }, 24);
    };
    const onKeyDownCapture = (ev) => {
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      const target = (ev && ev.target) || document.activeElement;
      if (box && typeof box.contains === 'function' && target && box.contains(target)) {
        clearPendingBlur();
        lastOutsideDownAt = 0;
        outsideWasDrag = false;
        composerVisuallySuppressed = false;
        setComposerActiveState(box, true);
      }
    };
    const onFocusIn = (ev) => {
      const targetEl = (ev && ev.target) || document.activeElement;
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      if (
        box &&
        typeof box.contains === 'function' &&
        targetEl &&
        box.contains(targetEl) &&
        lastOutsideDownAt &&
        Date.now() - lastOutsideDownAt < 350
      ) {
        // Cancel Antigravity's conversation-click auto-focus bounce cleanly once unless user dragged a selection
        composerVisuallySuppressed = true;
        setComposerActiveState(box, false);
        if (!outsideWasDrag && !hasNonEmptySelection()) {
          clearPendingBlur();
          pendingBlurTimer = setTimeout(() => {
            pendingBlurTimer = 0;
            blurComposerIfStillHeld();
          }, 0);
        }
        return;
      }
      composerVisuallySuppressed = false;
      syncComposerFocusState(targetEl);
    };
    const onFocusOut = () => {
      setTimeout(() => {
        const hasWinFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
        const box = document.getElementById('antigravity.agentSidePanelInputBox');
        const stillInside = Boolean(hasWinFocus && box && document.activeElement && box.contains(document.activeElement));
        if (!stillInside) {
          composerVisuallySuppressed = false;
          setComposerActiveState(box, false);
        }
      }, 0);
    };
    const onWindowBlur = () => {
      clearPendingBlur();
      lastOutsideDownAt = 0;
      outsideWasDrag = false;
      composerVisuallySuppressed = false;
      syncComposerFocusState(null);
    };
    try {
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('pointerdown', onPointerDownCapture, true);
        document.addEventListener('pointerup', onPointerUpCapture, true);
        document.addEventListener('keydown', onKeyDownCapture, true);
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('focusout', onFocusOut, true);
      }
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('resize', schedule);
        window.addEventListener('blur', onWindowBlur);
      }
      if (Array.isArray(window.__ag_cleanup_fns)) {
        window.__ag_cleanup_fns.push(() => {
          clearPendingBlur();
          if (typeof document.removeEventListener === 'function') {
            document.removeEventListener('pointerdown', onPointerDownCapture, true);
            document.removeEventListener('pointerup', onPointerUpCapture, true);
            document.removeEventListener('keydown', onKeyDownCapture, true);
            document.removeEventListener('focusin', onFocusIn, true);
            document.removeEventListener('focusout', onFocusOut, true);
          }
          if (typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', schedule);
            window.removeEventListener('blur', onWindowBlur);
          }
          if (window.__ag_comp_raf && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(window.__ag_comp_raf);
            window.__ag_comp_raf = 0;
          }
          window.__ag_composer_listeners_ready = false;
        });
      }
    } catch (e) {}
  }

  function updateSidebarMascotAvoidance() {
    const mascotLayer = document.getElementById('ag-anime-mascot-layer');
    if (!mascotLayer || !mascotLayer.style || typeof mascotLayer.getBoundingClientRect !== 'function') return;
    const outerSidebar = mascotLayer.parentNode;
    if (
      !outerSidebar ||
      !outerSidebar.getAttribute ||
      outerSidebar.getAttribute('data-ag-outer-sidebar') !== '1' ||
      typeof outerSidebar.getBoundingClientRect !== 'function'
    ) {
      return;
    }

    const sidebarRect = outerSidebar.getBoundingClientRect();
    if (!sidebarRect || sidebarRect.height <= 0) return;

    // Footer anchor (系统设置 bar at bottom of outer sidebar)
    let footerTop = sidebarRect.bottom - 44;
    if (outerSidebar.children && outerSidebar.children.length > 0) {
      const lastChild = outerSidebar.children[outerSidebar.children.length - 1];
      const targetFooter = lastChild && lastChild.id === 'ag-anime-mascot-layer' && outerSidebar.children.length > 1
        ? outerSidebar.children[outerSidebar.children.length - 2]
        : lastChild;
      if (targetFooter && typeof targetFooter.getBoundingClientRect === 'function') {
        const fr = targetFooter.getBoundingClientRect();
        if (fr && fr.height > 20 && fr.top > sidebarRect.top + 80) {
          footerTop = Math.min(footerTop, fr.top);
        }
      }
    }

    // O(1) measurement of stable sidebar anchors (nav block + virtualized list container) rather than scanning descendant nodes
    const listViewport = typeof outerSidebar.querySelector === 'function'
      ? (outerSidebar.querySelector('[data-testid="conversation-list-sidebar"]') ||
         outerSidebar.querySelector('.overscroll-none') ||
         outerSidebar.querySelector('.overflow-y-auto'))
      : null;
    if (!listViewport || typeof listViewport.getBoundingClientRect !== 'function') {
      mascotLayer.style.setProperty('--ag-mascot-avoid-scale', '0.460');
      mascotLayer.style.setProperty('--ag-mascot-avoid-opacity', '0');
      return;
    }

    const listRect = listViewport.getBoundingClientRect();
    const minTop = Math.max(sidebarRect.top, listRect.top);
    let lowestTextY = minTop;

    const navItems = outerSidebar.querySelector('[data-testid="sidebar-navigation-items"]');
    if (navItems && typeof navItems.getBoundingClientRect === 'function') {
      const nr = navItems.getBoundingClientRect();
      if (nr && nr.bottom > minTop && nr.bottom < footerTop) {
        lowestTextY = Math.max(lowestTextY, nr.bottom);
      }
    }

    const contentAnchor =
      (listViewport.firstElementChild && typeof listViewport.firstElementChild.getBoundingClientRect === 'function'
        ? listViewport.firstElementChild
        : null);
    if (contentAnchor) {
      const cr = contentAnchor.getBoundingClientRect();
      if (cr && cr.height > 0 && cr.bottom > minTop) {
        lowestTextY = Math.max(lowestTextY, Math.min(cr.bottom, footerTop));
      }
    } else if (listViewport.scrollHeight > listViewport.clientHeight + 2) {
      lowestTextY = footerTop;
    }

    const mascotFeetY = footerTop - 2;
    const freeHeight = Math.max(0, mascotFeetY - lowestTextY);
    const baseHeight = mascotLayer.offsetHeight || 310;

    let scale = 1;
    let opacity = 1;
    if (freeHeight >= baseHeight + 10) {
      scale = 1;
      opacity = 1;
    } else if (freeHeight >= 132) {
      // Gently shrink mascot so her hat stays clear of sidebar project/chat text
      scale = Math.max(0.54, Math.min(1, (freeHeight - 10) / baseHeight));
      opacity = 0.84 + 0.16 * ((scale - 0.54) / 0.46);
    } else if (freeHeight >= 40) {
      // Very tight viewport or expanded list: stay small & fade to ultra-subtle watermark
      scale = Math.max(0.46, Math.min(0.62, (freeHeight - 8) / baseHeight));
      const t = (freeHeight - 40) / 92;
      opacity = 0.08 + 0.72 * Math.pow(t, 1.35);
    } else {
      scale = 0.46;
      opacity = 0;
    }

    mascotLayer.style.setProperty('--ag-mascot-avoid-scale', scale.toFixed(3));
    mascotLayer.style.setProperty('--ag-mascot-avoid-opacity', Math.max(0, Math.min(1, opacity)).toFixed(3));
  }

  function scheduleSidebarMascotAvoidance() {
    if (typeof requestAnimationFrame !== 'function') {
      updateSidebarMascotAvoidance();
      return;
    }
    if (window.__ag_mascot_raf) return;
    window.__ag_mascot_raf = requestAnimationFrame(() => {
      window.__ag_mascot_raf = 0;
      updateSidebarMascotAvoidance();
    });
  }

  function ensureSidebarMascotAvoidance(outerSidebar, mascotLayer) {
    if (!outerSidebar || typeof outerSidebar.querySelector !== 'function') return;
    const scrollBox =
      outerSidebar.querySelector('[data-testid="conversation-list-sidebar"]') ||
      outerSidebar.querySelector('.overscroll-none') ||
      outerSidebar.querySelector('.overflow-y-auto') ||
      outerSidebar;
    if (window.__ag_mascot_avoid_root === outerSidebar && window.__ag_mascot_avoid_scroll === scrollBox) {
      return;
    }
    if (typeof window.__ag_mascot_avoid_teardown === 'function') {
      try { window.__ag_mascot_avoid_teardown(); } catch (e) {}
    }

    let ro = null;
    let mo = null;
    const onResize = () => scheduleSidebarMascotAvoidance();
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onResize);
    }
    if (scrollBox && typeof scrollBox.addEventListener === 'function') {
      scrollBox.addEventListener('scroll', onResize, { passive: true });
    }
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(onResize);
      try {
        ro.observe(outerSidebar);
        if (scrollBox && scrollBox !== outerSidebar) ro.observe(scrollBox);
        if (scrollBox && scrollBox.firstElementChild) ro.observe(scrollBox.firstElementChild);
        if (mascotLayer) ro.observe(mascotLayer);
      } catch (e) {}
    }
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(() => {
        if (ro && scrollBox && scrollBox.firstElementChild) {
          try { ro.observe(scrollBox.firstElementChild); } catch (e) {}
        }
        onResize();
      });
      try {
        mo.observe(scrollBox || outerSidebar, { childList: true, subtree: false, attributes: false });
      } catch (e) {}
    }

    const teardown = () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onResize);
      }
      if (scrollBox && typeof scrollBox.removeEventListener === 'function') {
        scrollBox.removeEventListener('scroll', onResize);
      }
      if (ro) try { ro.disconnect(); } catch (e) {}
      if (mo) try { mo.disconnect(); } catch (e) {}
      if (window.__ag_mascot_raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(window.__ag_mascot_raf);
        window.__ag_mascot_raf = 0;
      }
      window.__ag_mascot_avoid_root = null;
      window.__ag_mascot_avoid_scroll = null;
    };

    window.__ag_mascot_avoid_root = outerSidebar;
    window.__ag_mascot_avoid_scroll = scrollBox;
    window.__ag_mascot_avoid_teardown = teardown;
    if (Array.isArray(window.__ag_cleanup_fns)) {
      window.__ag_cleanup_fns.push(teardown);
    }
  }

  function updateContentLeftMascotLayout() {
    const mascotLayer = document.getElementById('ag-anime-mascot-layer');
    if (!mascotLayer || !mascotLayer.style) return;
    if (normalizeMascotPos(MASCOT_POSITION) !== 'content-left') return;

    const mainEl =
      typeof document.querySelector === 'function'
        ? document.querySelector('[data-main-content-body]') || document.querySelector('main')
        : null;
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    const chatHost =
      typeof document.querySelector === 'function'
        ? document.querySelector('[data-autoscroll-overlay-host="true"]')
        : null;

    if (mainEl && !inputBox && !chatHost) {
      if (mascotLayer.__ag_layout_sig !== 'hidden') {
        mascotLayer.__ag_layout_sig = 'hidden';
        mascotLayer.style.setProperty('--ag-mascot-avoid-opacity', '0');
      }
      return;
    }

    const vw = typeof window.innerWidth === 'number' && window.innerWidth > 0 ? window.innerWidth : 1440;
    const vh = typeof window.innerHeight === 'number' && window.innerHeight > 0 ? window.innerHeight : 900;
    const mr =
      mainEl && typeof mainEl.getBoundingClientRect === 'function'
        ? mainEl.getBoundingClientRect()
        : null;
    const outerSidebar = findOuterSidebar();
    const sr =
      !mr && outerSidebar && typeof outerSidebar.getBoundingClientRect === 'function'
        ? outerSidebar.getBoundingClientRect()
        : null;

    const gutterLeft = mr && mr.width > 0 ? Math.max(0, mr.left) : sr && sr.right > 0 ? sr.right : 252;
    const mainWidth = mr && mr.width > 0 ? mr.width : Math.max(0, vw - gutterLeft);

    let contentLeft = gutterLeft + Math.max(0, (mainWidth - 784) / 2);
    if (inputBox && typeof inputBox.getBoundingClientRect === 'function') {
      const br = inputBox.getBoundingClientRect();
      if (br && br.width > 160 && br.left >= gutterLeft) {
        contentLeft = Math.min(contentLeft, br.left);
      }
    }

    const headerEl =
      typeof document.querySelector === 'function'
        ? document.querySelector('[data-main-content-header="true"]')
        : null;
    const hr =
      headerEl && typeof headerEl.getBoundingClientRect === 'function'
        ? headerEl.getBoundingClientRect()
        : null;
    const topBound = hr && hr.bottom > 0 ? hr.bottom : 44;

    const sizeMode = MASCOT_SIZE === 'sm' ? 'sm' : MASCOT_SIZE === 'lg' ? 'lg' : 'md';
    const baseW = sizeMode === 'sm' ? 256 : sizeMode === 'lg' ? 368 : 316;
    const baseH = sizeMode === 'sm' ? 334 : sizeMode === 'lg' ? 480 : 412;

    const gutterWidth = Math.max(0, contentLeft - gutterLeft);
    const availW = Math.max(0, gutterWidth - 18);
    const availH = Math.max(0, vh - topBound - 36);

    const rawScale = Math.min(1, availW / baseW, availH / baseH);
    let scale = 1;
    let opacity = 1;
    if (availW >= 146 && rawScale >= 0.46) {
      scale = Math.max(0.46, Math.min(1, rawScale));
      opacity = scale >= 0.64 ? 1 : 0.64 + 0.36 * ((scale - 0.46) / 0.18);
    } else if (availW >= 92 && rawScale >= 0.34) {
      scale = Math.max(0.38, Math.min(0.52, rawScale));
      opacity = 0.16 + 0.48 * ((availW - 92) / 54);
    } else {
      scale = 0.38;
      opacity = 0;
    }

    const renderedW = baseW * scale;
    const extraW = Math.max(0, availW - renderedW);
    const rightEdge = Math.min(
      contentLeft - 10,
      Math.max(gutterLeft + 8 + renderedW, contentLeft - 14 - extraW * 0.32)
    );
    const leftEdge = Math.max(gutterLeft + 6, rightEdge - renderedW);
    const leftStr = `${Math.round(leftEdge)}px`;
    const scaleStr = scale.toFixed(3);
    const opacityStr = Math.max(0, Math.min(1, opacity)).toFixed(3);
    const nextSig = `${leftStr}|${scaleStr}|${opacityStr}`;
    if (mascotLayer.__ag_layout_sig === nextSig) return;
    mascotLayer.__ag_layout_sig = nextSig;

    mascotLayer.style.setProperty('--ag-mascot-left', leftStr);
    mascotLayer.style.setProperty('--ag-mascot-scale', scaleStr);
    mascotLayer.style.setProperty('--ag-mascot-avoid-opacity', opacityStr);
  }

  function scheduleContentLeftMascotLayout() {
    if (typeof requestAnimationFrame !== 'function') {
      updateContentLeftMascotLayout();
      return;
    }
    if (window.__ag_content_mascot_raf) return;
    window.__ag_content_mascot_raf = requestAnimationFrame(() => {
      window.__ag_content_mascot_raf = 0;
      updateContentLeftMascotLayout();
    });
  }

  function ensureContentLeftMascotObserver(mascotLayer) {
    const mainEl =
      typeof document.querySelector === 'function'
        ? document.querySelector('[data-main-content-body]') || document.querySelector('main')
        : null;
    const outerSidebar = findOuterSidebar();
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (
      window.__ag_content_mascot_ready &&
      window.__ag_content_mascot_main === mainEl &&
      window.__ag_content_mascot_box === inputBox
    ) {
      return;
    }
    if (typeof window.__ag_content_mascot_teardown === 'function') {
      try { window.__ag_content_mascot_teardown(); } catch (e) {}
    }

    let ro = null;
    const onLayout = () => scheduleContentLeftMascotLayout();
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onLayout);
    }
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(onLayout);
      try {
        if (document.body) ro.observe(document.body);
        if (mainEl) ro.observe(mainEl);
        if (outerSidebar) ro.observe(outerSidebar);
        if (inputBox) ro.observe(inputBox);
        if (mascotLayer) ro.observe(mascotLayer);
      } catch (e) {}
    }

    const teardown = () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onLayout);
      }
      if (ro) {
        try { ro.disconnect(); } catch (e) {}
      }
      if (window.__ag_content_mascot_raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(window.__ag_content_mascot_raf);
        window.__ag_content_mascot_raf = 0;
      }
      window.__ag_content_mascot_ready = false;
      window.__ag_content_mascot_main = null;
      window.__ag_content_mascot_box = null;
    };

    window.__ag_content_mascot_ready = true;
    window.__ag_content_mascot_main = mainEl;
    window.__ag_content_mascot_box = inputBox;
    window.__ag_content_mascot_teardown = teardown;
    if (Array.isArray(window.__ag_cleanup_fns)) {
      window.__ag_cleanup_fns.push(teardown);
    }
  }

  function syncThemePreset() {
    if (MODULES.theme === false) {
      document.documentElement.removeAttribute('data-ag-preset');
      document.documentElement.removeAttribute('data-ag-theme-mode');
      syncAnimeLayers();
      return;
    }
    try {
      const storedLight = Storage.prototype.getItem.call(localStorage, 'theme-preset-light');
      if (ALL_CUSTOM_PRESET_NAMES.has(storedLight)) {
        try { Storage.prototype.setItem.call(localStorage, 'theme-preset-light', 'Default Light'); } catch (e) {}
      }
      const storedDark = Storage.prototype.getItem.call(localStorage, 'theme-preset-dark');
      if (ALL_CUSTOM_PRESET_NAMES.has(storedDark)) {
        try { Storage.prototype.setItem.call(localStorage, 'theme-preset-dark', 'Default Dark'); } catch (e) {}
      }

      const bodyEl = document.body;
      const bodyExplicitDark = !!(
        bodyEl &&
        (bodyEl.classList.contains('dark') ||
          bodyEl.classList.contains('theme-dark') ||
          bodyEl.classList.contains('dark-theme'))
      );
      const bodyExplicitLight = !!(
        bodyEl &&
        (bodyEl.classList.contains('theme-light') ||
          bodyEl.classList.contains('light-theme') ||
          bodyEl.classList.contains('light'))
      );
      let storedThemeMode = null;
      try {
        storedThemeMode = Storage.prototype.getItem.call(localStorage, 'theme-mode');
      } catch (e) {}
      let isDark;
      if (IS_SWARM_PLUGIN_FRAME) {
        const hostMode = window.__ag_host_theme_mode;
        if (hostMode === 'dark' || hostMode === 'light') {
          isDark = hostMode === 'dark';
        } else {
          const docTheme = document.documentElement ? document.documentElement.getAttribute('data-theme') : '';
          isDark =
            docTheme === 'dark' ||
            bodyExplicitDark ||
            Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
      } else {
        isDark = bodyExplicitDark
          ? true
          : bodyExplicitLight || storedThemeMode === 'light'
          ? false
          : storedThemeMode === 'dark'
          ? true
          : !!(document.documentElement && document.documentElement.style.colorScheme === 'dark');
      }

      const targetMode = isDark ? 'dark' : 'light';
      const targetPreset = isDark ? PRESETS.STARLIGHT_DARK : PRESETS.STARLIGHT_LIGHT;

      const prevPreset = document.documentElement.getAttribute('data-ag-preset');
      if (prevPreset !== targetPreset) {
        document.documentElement.setAttribute('data-ag-preset', targetPreset);
      }
      const prevMode = document.documentElement.getAttribute('data-ag-theme-mode');
      if (prevMode !== targetMode || prevPreset !== targetPreset) {
        document.documentElement.setAttribute('data-ag-theme-mode', targetMode);
        if (IS_SWARM_PLUGIN_FRAME && document.documentElement) {
          document.documentElement.style.colorScheme = targetMode;
        }
        if (!IS_SWARM_PLUGIN_FRAME && typeof window.__agSyncHostThemeMode === 'function') {
          try {
            window.__agSyncHostThemeMode(targetMode);
          } catch (e) {}
        }
        try {
          const cs = getComputedStyle(document.body || document.documentElement);
          const sidebarBg = cs.getPropertyValue('--sidebar').trim() || (isDark ? '#100E1E' : '#F4EFFF');
          const fgColor = cs.getPropertyValue('--foreground').trim() || (isDark ? '#F5F3FF' : '#1B1530');
          window.electronNative?.setTitleBarOverlay?.({
            color: sidebarBg,
            symbolColor: fgColor
          });
        } catch (e) {}
      }
      syncAnimeLayers();
    } catch (e) {}
  }

  window.__ag_sync_preset_fn = syncThemePreset;
  window.__ag_set_host_theme_mode = function (mode) {
    if (mode !== 'dark' && mode !== 'light') return;
    window.__ag_host_theme_mode = mode;
    syncThemePreset();
  };

  if (MODULES.theme !== false) {
    if (DEFAULT_PRESET && window.__ag_last_boot_preset !== DEFAULT_PRESET) {
      window.__ag_last_boot_preset = DEFAULT_PRESET;
      try {
        Storage.prototype.setItem.call(localStorage, 'theme-color-flavor', DEFAULT_PRESET);
      } catch (e) {}
    }

    if (!window.__ag_preset_hook_installed) {
      window.__ag_preset_hook_installed = true;
      try {
        const origGetItem = localStorage.getItem.bind(localStorage);
        localStorage.getItem = function (key) {
          const val = origGetItem(key);
          if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) return 'Default Light';
          if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) return 'Default Dark';
          return val;
        };

        const origSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function (key, val) {
          if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) val = 'Default Light';
          if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) val = 'Default Dark';
          origSetItem(key, val);
          if (
            key === 'theme-preset-light' ||
            key === 'theme-preset-dark' ||
            key === 'theme-mode' ||
            key === 'theme-color-flavor'
          ) {
            setTimeout(() => {
              if (typeof window.__ag_sync_preset_fn === 'function') window.__ag_sync_preset_fn();
            }, 50);
          }
        };
      } catch (e) {}
    }

    if (typeof MutationObserver !== 'undefined') {
      try {
        const modeObs = new MutationObserver(() => {
          if (typeof window.__ag_sync_preset_fn === 'function') {
            window.__ag_sync_preset_fn();
          }
        });
        if (document.body) modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        if (document.documentElement) modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
        window.__ag_theme_mode_observer = modeObs;
      } catch (e) {}
    }
  }

  syncThemePreset();
  window.__ag_patch_version = PATCH_VERSION;
