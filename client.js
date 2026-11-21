/**
 * Chat mode: embed the official DeepSeek web chat instead of spending API credit.
 *
 * The free web product is chat.deepseek.com, so the honest implementation is to
 * render that page rather than to imitate it. Switching to Work mode returns to
 * the Harness conversation, its tools and its views, which bill the API model.
 *
 * How the embed is possible. `chat.deepseek.com` sends
 * `content-security-policy: frame-ancestors 'none'`, so a plain `<iframe>` is
 * refused by the browser. The Desktop shell creates its primary window with
 * `webviewTag: true` and ships an Electron webview guest manager
 * (`dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-browser`). A webview guest
 * is a top-level browsing context, not a frame, so `frame-ancestors` does not
 * apply to it.
 *
 * The guest is not free-form: the main process only attaches a webview carrying a
 * lease it issued over `dsh-desktop:browser-acquire`, matched by the
 * `about:blank#<lease>` bootstrap URL and the partition name. This plugin takes
 * exactly that documented path through `window.dshDesktop.browser` — the same
 * bridge the shipped sidebar browser uses — and never bypasses main-process
 * policy.
 *
 * Sign-in lifetime, and the snapshot that extends it. The shell caches one storage
 * partition per identity string for the lifetime of the process, so the stable
 * BROWSER_IDENTITY below keeps the web session across every Chat ↔ Work switch and
 * every remount of the panel. The shell names that partition with a random UUID and
 * never persists it, so on its own a full app restart begins with a fresh sign-in.
 *
 * The web app carries its login in `localStorage`, not in an HttpOnly cookie: the
 * bundle reads a `userToken` storage handle and sends it as `Authorization: Bearer`.
 * Both facts matter here. An HttpOnly cookie could not be read from page script, so
 * no snapshot would be possible at all; but localStorage is page-readable, so the
 * signed-in keys can be copied out before the guest dies and written back into the
 * next guest. That is what `snapshotScript` / `restoreScript` do, and it is why a
 * sign-in now survives a restart.
 *
 * The restore needs one reload. The page reads its token during boot, which has
 * already happened by the time page script may run, so writing the snapshot there is
 * too late for that load: the plugin writes it, reloads once, and the next boot finds
 * it in place. `restored` bounds that to a single reload so a stale snapshot can never
 * loop.
 *
 * What the snapshot deliberately does NOT do: forge an identity, alter a UA, or
 * pre-seed anything the server did not itself issue. It copies the exact values the
 * web app stored for this user in this app and puts them back. If they expire, the
 * page asks for a sign-in like any normal session would.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-mode',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'chatMode';
    const STORAGE_KEY = 'dsh-chat-mode.mode';
    const PANEL_KEY = 'chat-mode-web';
    const CHAT_URL = 'https://chat.deepseek.com/';
    /** Origin prefix, used to tell the real page from the about:blank bootstrap. */
    const CHAT_ORIGIN = 'https://chat.deepseek.com';
    const CHAT_HOSTS = ['chat.deepseek.com'];
    const CHAT = 'chat';
    const WORK = 'work';
    const MODES = [CHAT, WORK];
    /**
     * Storage identity for the guest partition.
     *
     * `DesktopBrowserGuests.acquire` caches one partition per identity for the
     * process lifetime, so a stable string is what makes the web sign-in survive
     * navigating away and back. See the module comment for the restart boundary.
     */
    const BROWSER_IDENTITY = 'dsh-chat-mode/chat.deepseek.com';

    /**
     * localStorage key holding the saved web session.
     *
     * It lives in the Harness page's own origin storage, so it is per app install
     * and per OS user, the same place this plugin already keeps the mode.
     */
    const SESSION_KEY = 'dsh-chat-mode.web-session';
    /**
     * localStorage keys of the web app that carry identity.
     *
     * Discovered in the shipped bundle: `userToken` is the bearer token handle and
     * `__appKit_userInfo` caches the profile beside it. Deliberately an allowlist —
     * copying all of localStorage would drag across UI preferences and per-tab
     * state that should not travel.
     */
    const SESSION_FIELDS = ['userToken', '__appKit_userInfo'];

    const dicts = {
      en: {
        'mode.chat': 'Chat',
        'mode.work': 'Work',
        'mode.chatHint': 'Chat mode: the free web chat, embedded from chat.deepseek.com',
        'mode.workHint': 'Work mode: the Harness conversation, tools and views (billed to your API model)',
        'switch.aria': 'Conversation mode',
        'panel.title': 'Web chat',
        'panel.failed': 'The embedded chat could not start.',
        'panel.desktopOnly': 'The embedded web chat needs the Desktop app, which provides the Electron webview surface. In a browser, open chat.deepseek.com in a tab instead.',
        'panel.retry': 'Try again',
        'panel.openExternal': 'Open in browser',
        'panel.note': 'Uses your DeepSeek web account, not API credit. The sign-in is remembered across restarts and is stored on this device only.',
        'panel.forget': 'Forget saved sign-in',
      },
      zh: {
        'mode.chat': '聊天',
        'mode.work': '工作',
        'mode.chatHint': '对话模式：内嵌 chat.deepseek.com 官方网页版，不消耗 API 余额',
        'mode.workHint': '工作模式：Harness 会话、工具与视图（走你的 API 模型计费）',
        'switch.aria': '对话模式切换',
        'panel.title': '网页版对话',
        'panel.failed': '内嵌对话启动失败。',
        'panel.desktopOnly': '内嵌网页版需要桌面端提供的 Electron webview。在浏览器里请直接新开标签页访问 chat.deepseek.com。',
        'panel.retry': '重试',
        'panel.openExternal': '在浏览器打开',
        'panel.note': '使用你的 DeepSeek 网页版账号，不消耗 API 余额。登录态会被记住（仅存于本机），重启后无需重登。',
        'panel.forget': '清除已保存的登录',
      },
    };

    // ── mode state ────────────────────────────────────────────────────────────
    function readMode() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (MODES.includes(stored)) return stored;
      } catch {
        /* storage unavailable: keep the in-memory default */
      }
      return CHAT;
    }

    let mode = readMode();
    const listeners = new Set();

    function setMode(next) {
      if (!MODES.includes(next) || next === mode) return;
      mode = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      for (const listener of [...listeners]) listener(next);
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function useMode() {
      const [current, setCurrent] = React.useState(mode);
      React.useEffect(() => subscribe((next) => setCurrent(next)), []);
      return current;
    }

    // ── locale ────────────────────────────────────────────────────────────────
    let translate = (key) => dicts.en[key] ?? key;
    let localeFace;

    function useLocaleRevision() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const face = localeFace;
        if (face === undefined) return undefined;
        return face.subscribe(() => bump((value) => value + 1));
      }, []);
    }

    function t(key) {
      try {
        const text = translate(key);
        return typeof text === 'string' && text !== '' ? text : (dicts.en[key] ?? key);
      } catch {
        return dicts.en[key] ?? key;
      }
    }

    // ── desktop bridge ────────────────────────────────────────────────────────
    /**
     * The bridge the Desktop preload exposes on the application document.
     *
     * Absent in a browser or on an older shell, which is not an error: the panel
     * then explains that the embed needs the desktop app and offers the link out.
     */
    function desktopBridge() {
      try {
        const carrier = globalThis.dshDesktop;
        if (carrier === undefined || carrier === null) return undefined;
        if (carrier.protocolVersion !== 1) return undefined;
        return carrier.browser;
      } catch {
        return undefined;
      }
    }

    function openExternal(url) {
      try {
        // The shell turns window.open on an http(s) target into the system
        // browser (its setWindowOpenHandler forwards and denies the new window),
        // so no extra bridge is needed for the fallback link.
        window.open(url, '_blank', 'noopener');
      } catch {
        /* nothing else to try */
      }
    }

    // ── web session snapshot ─────────────────────────────────────────────────
    //
    // The guest's partition dies with the process, so the only durable place to
    // keep a sign-in is this page's own localStorage. These two functions read the
    // web app's identity keys out of the guest before it goes, and write them back
    // into the next guest before the app boots.

    /** Read the saved snapshot, or null. Never throws on malformed data. */
    function readSnapshot() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return null;
        const values = parsed.values;
        if (values === null || typeof values !== 'object') return null;
        const out = {};
        for (const field of SESSION_FIELDS) {
          const value = values[field];
          if (typeof value === 'string' && value !== '') out[field] = value;
        }
        return Object.keys(out).length === 0 ? null : { values: out, savedAt: Number(parsed.savedAt) || 0 };
      } catch {
        return null;
      }
    }

    function writeSnapshot(values) {
      try {
        const clean = {};
        for (const field of SESSION_FIELDS) {
          const value = values[field];
          if (typeof value === 'string' && value !== '') clean[field] = value;
        }
        if (Object.keys(clean).length === 0) return;
        localStorage.setItem(SESSION_KEY, JSON.stringify({ values: clean, savedAt: Date.now() }));
      } catch {
        /* storage full or unavailable: the session simply is not remembered */
      }
    }

    function forgetSnapshot() {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch {
        /* nothing to do */
      }
    }

    /**
     * Copy the guest's identity keys into the snapshot.
     *
     * Runs in the guest, so it must be a self-contained expression string — it
     * cannot close over anything in this module. Returns the values it found.
     */
    function snapshotScript(fields) {
      return `(() => {
        const want = ${JSON.stringify(fields)};
        const out = {};
        try {
          for (const key of want) {
            const value = window.localStorage.getItem(key);
            if (typeof value === 'string' && value !== '') out[key] = value;
          }
        } catch (error) {
          return { ok: false, error: String(error) };
        }
        return { ok: true, values: out };
      })()`;
    }

    /**
     * Write the snapshot into a guest that has not booted the app yet.
     *
     * This runs on the lease's `about:blank#<lease>` bootstrap document, which is
     * same-originless, so it cannot touch the chat origin's localStorage. It is
     * therefore injected on `dom-ready` of the real page instead, before the app's
     * own boot script has finished restoring state.
     */
    function restoreScript(values) {
      return `(() => {
        const values = ${JSON.stringify(values)};
        try {
          for (const [key, value] of Object.entries(values)) {
            window.localStorage.setItem(key, value);
          }
        } catch (error) {
          return { ok: false, error: String(error) };
        }
        return { ok: true, wrote: Object.keys(values) };
      })()`;
    }

    // ── the frame the shell builds around every panel ────────────────────────
    /**
     * The AppFrame element: the grid that owns the sidebar track.
     *
     * Found through the shell's own stable hook rather than a class name: the frame
     * renders `<div data-shell-overlay>` as a direct child, so the frame is that
     * element's parent. (`data-shell-overlay` is the wrapper around the
     * `shell.overlay` slot; the slot anchor itself sits one level deeper.)
     * Returns null outside the shell.
     */
    function frameElement() {
      try {
        const layer = document.querySelector('[data-shell-overlay]');
        return layer?.parentElement ?? null;
      } catch {
        return null;
      }
    }

    /** Whether the shell currently reports the sidebar collapsed; undefined when unknown. */
    function sidebarCollapsed() {
      const frame = frameElement();
      if (frame === null) return undefined;
      return frame.hasAttribute('data-sidebar-collapsed');
    }

    // ── the embedded page ─────────────────────────────────────────────────────
    /**
     * Set when the user asks to forget the saved sign-in.
     *
     * Every teardown captures, so without this a forget would be undone a moment
     * later by the still-signed-in guest's pending capture. The flag suppresses
     * that capture; the remount which follows clears it again. Process-wide rather
     * than component state so the cleanup closure, which outlives the render, still
     * sees it.
     */
    let forgetRequested = false;

    /**
     * Owns one webview guest: acquires a lease, builds the guest with the exact
     * bootstrap the main process accepts, plants the saved sign-in before the page
     * boots, mirrors identity changes back to the snapshot while it runs, and
     * releases the lease on unmount. The partition behind the stable identity is
     * reused, so a remount resumes the same session without a round trip.
     */
    function EmbeddedChat() {
      useLocaleRevision();
      const hostRef = React.useRef(null);
      // Bumping this remounts the whole component, which re-runs the attach
      // effect from scratch: the only reliable retry, because a failed attach
      // may have already consumed its lease.
      const [attempt, retry] = React.useReducer((value) => value + 1, 0);
      const [state, setState] = React.useState('connecting');
      // The snapshot is a credential on disk, so its presence is shown and it can
      // be deleted from here rather than only by clearing site storage by hand.
      const [hasSnapshot, setHasSnapshot] = React.useState(() => readSnapshot() !== null);

      React.useEffect(() => {
        const bridge = desktopBridge();
        if (bridge === undefined) {
          setState('unsupported');
          return undefined;
        }
        const host = hostRef.current;
        if (host === null) return undefined;

        let cancelled = false;
        let lease;
        let element;
        let disposeOpen;
        let snapshotTimer;
        let restored = false;

        // A forget consumed the one suppressed teardown it was set for; from here on
        // this fresh guest is signed out and must be able to capture a new sign-in.
        forgetRequested = false;

        /**
         * Copy the guest's identity keys out; called while the guest is alive.
         *
         * Electron throws SYNCHRONOUSLY from `executeJavaScript` when the guest is
         * not attached or has not emitted dom-ready, so the call itself is guarded
         * and not merely its promise. That matters most on teardown: this runs from
         * an effect cleanup, and a synchronous throw there propagates out of React's
         * unmount and tears down the whole frame — which shows up as a blank page
         * after switching back to Work.
         */
        const capture = () => {
          if (element === undefined || cancelled || forgetRequested) return;
          let pending;
          try {
            pending = element.executeJavaScript(snapshotScript(SESSION_FIELDS), false);
          } catch {
            return;
          }
          Promise.resolve(pending)
            .then((result) => {
              if (cancelled || forgetRequested) return;
              if (result === null || typeof result !== 'object' || result.ok !== true) return;
              writeSnapshot(result.values ?? {});
            })
            .catch(() => {
              /* the guest may be navigating; the next tick retries */
            });
        };

        const start = async () => {
          try {
            const reservation = await bridge.acquire(BROWSER_IDENTITY);
            if (cancelled) {
              await bridge.release(reservation.lease);
              return;
            }
            lease = reservation.lease;
            element = document.createElement('webview');
            element.className = 'dcx-web';
            element.setAttribute('name', reservation.lease);
            element.setAttribute('partition', reservation.partition);
            element.setAttribute('allowpopups', '');
            element.setAttribute('src', `about:blank#${reservation.lease}`);
            element.setAttribute('aria-label', t('panel.title'));

            // dom-ready fires repeatedly: once for the about:blank bootstrap, once
            // per real page load, and again after the restore reload below. The
            // bootstrap navigates; a real page either plants the snapshot once or
            // starts the capture timer, and the timer starts at most once.
            element.addEventListener('dom-ready', () => {
              if (cancelled || element === undefined) return;
              let current = '';
              try {
                current = element.getURL();
              } catch {
                /* mid-navigation */
              }
              if (!current.startsWith(CHAT_ORIGIN)) {
                setState('ready');
                let navigating;
                try {
                  navigating = element.loadURL(CHAT_URL);
                } catch {
                  setState('failed');
                  return;
                }
                Promise.resolve(navigating).catch(() => {
                  if (!cancelled) setState('failed');
                });
                return;
              }

              const beginCapture = () => {
                if (cancelled || snapshotTimer !== undefined) return;
                snapshotTimer = setInterval(capture, 4000);
              };

              // The app reads its token during boot, which has already happened by
              // dom-ready, so planting the snapshot now would be too late: write it,
              // reload once, and let the next boot find it already present.
              const saved = restored ? null : readSnapshot();
              if (saved === null) {
                beginCapture();
                return;
              }
              restored = true;
              // Same synchronous-throw hazard as in capture(): guard the call
              // itself, not only the promise it returns.
              let restoring;
              try {
                restoring = element.executeJavaScript(restoreScript(saved.values), false);
              } catch {
                beginCapture();
                return;
              }
              Promise.resolve(restoring)
                .then(() => {
                  if (cancelled || element === undefined) return undefined;
                  try {
                    return element.reload();
                  } catch {
                    return undefined;
                  }
                })
                .then(() => {
                  beginCapture();
                })
                .catch(() => {
                  // A failed restore must never wedge the panel: carry on to the
                  // signed-out page, where the user can sign in normally.
                  beginCapture();
                });
            });

            // Guests cannot open windows: the main process intercepts every
            // popup and reports it here instead, so links out stay in-app-safe.
            disposeOpen = bridge.onOpenRequested(reservation.lease, (url) => {
              try {
                if (!URL.canParse(url)) return;
                if (!CHAT_HOSTS.includes(new URL(url).hostname)) openExternal(url);
              } catch {
                /* ignore malformed targets */
              }
            });

            host.appendChild(element);
          } catch (error) {
            if (cancelled) return;
            console.error('[dsh-chat-mode] embedded chat failed to attach:', error);
            setState('failed');
          }
        };

        start();

        return () => {
          // Capture before teardown: after `remove()` the guest is gone and its
          // localStorage with it.
          capture();
          cancelled = true;
          if (snapshotTimer !== undefined) clearInterval(snapshotTimer);
          snapshotTimer = undefined;
          try {
            disposeOpen?.();
          } catch {
            /* already detached */
          }
          try {
            element?.remove();
          } catch {
            /* already detached */
          }
          if (lease !== undefined) {
            Promise.resolve(bridge.release(lease)).catch(() => {
              /* the window is closing; the main process releases it anyway */
            });
          }
        };
      }, [attempt]);

      const message =
        state === 'unsupported' ? t('panel.desktopOnly') : state === 'failed' ? t('panel.failed') : undefined;

      return h(
        'div',
        { className: 'dcx-web-panel', 'data-dcx-web-panel': '' },
        h(
          'div',
          { className: 'dcx-web-panel__bar' },
          // The mode switch lives here as well as in the Conversation header:
          // selecting this panel replaces the Conversation, so the header copy
          // unmounts with it and this is the only way back to Work mode.
          h(ModeSwitch),
          h('span', { className: 'dcx-web-panel__note' }, t('panel.note')),
          hasSnapshot
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dcx-web-panel__action',
                  onClick: () => {
                    // Set before teardown so the cleanup's capture is suppressed.
                    forgetRequested = true;
                    forgetSnapshot();
                    setHasSnapshot(false);
                    // Remount so the guest drops its still-live session too, not
                    // just the copy on disk.
                    retry();
                  },
                },
                t('panel.forget'),
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'dcx-web-panel__action', onClick: () => openExternal(CHAT_URL) },
            t('panel.openExternal'),
          ),
        ),
        h(
          'div',
          { className: 'dcx-web-panel__body' },
          message === undefined
            ? null
            : h(
                'div',
                { className: 'dcx-web-panel__notice' },
                h('p', { className: 'dcx-web-panel__noticeText' }, message),
                h('button', { type: 'button', className: 'dcx-web-panel__action', onClick: retry }, t('panel.retry')),
              ),
          h('div', { className: 'dcx-web-panel__host', ref: hostRef }),
        ),
      );
    }

    // ── the switch ────────────────────────────────────────────────────────────
    /**
     * Chat / Work segmented control.
     *
     * Rendered in two places — the Conversation header's leading seat and the
     * embedded panel's toolbar — because exactly one of the two panels is mounted
     * at any time, so only one copy is ever visible.
     */
    function ModeSwitch() {
      useLocaleRevision();
      const current = useMode();
      return h(
        'div',
        {
          className: 'dcx-switch',
          role: 'group',
          'aria-label': t('switch.aria'),
          'data-dsh-chat-mode-switch': '',
        },
        MODES.map((entry) =>
          h(
            'button',
            {
              key: entry,
              type: 'button',
              className: 'dcx-switch__btn',
              'aria-pressed': current === entry,
              title: t(entry === CHAT ? 'mode.chatHint' : 'mode.workHint'),
              onClick: () => setMode(entry),
            },
            t(entry === CHAT ? 'mode.chat' : 'mode.work'),
          ),
        ),
      );
    }

    // ── stylesheet ────────────────────────────────────────────────────────────
    const CSS = `
/* ── the switch, shown in both modes ─────────────────────────────────────── */
.dcx-switch{
  display:inline-flex;align-items:center;gap:2px;padding:3px;flex:none;
  border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);
  pointer-events:auto;-webkit-app-region:no-drag;
}
.dcx-switch__btn{
  appearance:none;border:0;margin:0;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;
  line-height:20px;padding:4px 20px;border-radius:999px;white-space:nowrap;
  transition:background-color .15s var(--ds-ease-in-out),color .15s var(--ds-ease-in-out);
}
.dcx-switch__btn:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  outline-offset:1px;
}
@media (hover:hover){
  .dcx-switch__btn[aria-pressed="false"]:hover{color:var(--dsw-alias-label-primary)}
}
.dcx-switch__btn[aria-pressed="true"]{
  background:var(--dsw-specific-input-major);
  color:var(--dsw-alias-label-primary);
  box-shadow:var(--dsw-elevation-stroke),0 1px 2px 0 #0000000f;
}

/* ── the embedded page ───────────────────────────────────────────────────── */
.dcx-web-panel{
  display:flex;flex-direction:column;flex:1;height:100%;min-height:0;min-width:0;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
}
.dcx-web-panel__bar{
  flex:none;display:flex;align-items:center;gap:14px;
  padding:8px 16px;
  border-bottom:.5px solid var(--dsw-alias-border-l3);
}
.dcx-web-panel__note{
  min-width:0;flex:1;
  color:var(--dsw-alias-label-tertiary);
  font-size:12px;line-height:18px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dcx-web-panel__action{
  appearance:none;flex:none;cursor:pointer;
  border:.5px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-md);
  background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:12px;line-height:18px;padding:4px 10px;
  transition:background-color .15s var(--ds-ease-in-out);
}
@media (hover:hover){
  .dcx-web-panel__action:hover{background:var(--dsw-alias-interactive-bg-hover)}
}
.dcx-web-panel__action:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  outline-offset:1px;
}
.dcx-web-panel__body{
  position:relative;display:flex;flex-direction:column;flex:1;min-height:0;
}
.dcx-web-panel__host{
  display:flex;flex:1;min-height:0;min-width:0;
}
.dcx-web{
  display:flex;flex:1;width:100%;height:100%;border:0;
}
.dcx-web-panel__notice{
  position:absolute;inset:0;z-index:2;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:32px;text-align:center;
  background:var(--dsw-alias-bg-base);
}
.dcx-web-panel__noticeText{
  max-width:52ch;margin:0;
  color:var(--dsw-alias-label-secondary);
  font-size:14px;line-height:22px;
}
@media (prefers-reduced-motion:reduce){
  .dcx-switch__btn,.dcx-web-panel__action{transition:none}
}
`;

    function insertStyles() {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-chat-mode';
      tag.dataset.pluginCss = 'dsh-chat-mode/surface.css';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        try {
          tag.remove();
        } catch {
          /* already detached */
        }
      };
    }

    // ── mode ↔ shell sync ─────────────────────────────────────────────────────
    /**
     * Show the embedded chat panel.
     *
     * Guarded because `selectPanel` throws when the requested key is not
     * registered, which happens while a reload is still settling.
     */
    function showChatPanel(layout) {
      if (layout === undefined || typeof layout.selectPanel !== 'function') return;
      try {
        layout.selectPanel(PANEL_KEY);
      } catch (error) {
        console.warn('[dsh-chat-mode] panel navigation deferred:', error);
      }
    }

    /**
     * Return to the Conversation.
     *
     * Always on leaving chat mode rather than guarded by "is the chat panel really
     * showing": the user just pressed Work, so the Harness conversation is what
     * they asked for. A guard would have to observe panel mounts, and any mount
     * failure (a broken guest, a slow reload) would then strand them on a panel
     * they did not choose.
     */
    function restoreConversation(layout) {
      if (layout === undefined || typeof layout.selectPanel !== 'function') return;
      try {
        layout.selectPanel(null);
      } catch (error) {
        console.warn('[dsh-chat-mode] conversation restore deferred:', error);
      }
    }

    /**
     * Collapse the sidebar while the web chat is on screen, and put it back after.
     *
     * Uses the documented `layout.toggleSidebar()`, so this is the shell's own
     * collapsed state rather than a CSS trick, and it is reversible. Only a
     * sidebar this plugin closed is reopened: if it was already collapsed when
     * chat mode began, the user's own choice is left alone.
     */
    function syncSidebar(layout, next) {
      if (layout === undefined || typeof layout.toggleSidebar !== 'function') return;
      const collapsed = sidebarCollapsed();
      if (collapsed === undefined) return;
      if (next === CHAT) {
        if (collapsed) {
          sidebarHiddenByUs = false;
          return;
        }
        sidebarHiddenByUs = true;
        try {
          layout.toggleSidebar();
        } catch (error) {
          console.warn('[dsh-chat-mode] sidebar could not collapse:', error);
        }
        return;
      }
      if (!sidebarHiddenByUs) return;
      sidebarHiddenByUs = false;
      try {
        layout.toggleSidebar();
      } catch (error) {
        console.warn('[dsh-chat-mode] sidebar could not restore:', error);
      }
    }

    /** Whether this plugin collapsed the sidebar for chat mode. */
    let sidebarHiddenByUs = false;

    // ── plugin entry ──────────────────────────────────────────────────────────
    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const slots = ctx.get('slots');
        if (slots === undefined || typeof slots.inject !== 'function') return;
        const layout = ctx.get('layout');

        const locale = ctx.get('locale');
        if (locale !== undefined && typeof locale.bind === 'function') {
          translate = locale.bind(NS);
          localeFace = {
            getSnapshot: () => locale.getSnapshot(),
            subscribe: (listener) => locale.subscribe(listener),
          };
          ctx.effect(() => {
            try {
              return locale.register(NS, dicts);
            } catch (error) {
              console.warn('[dsh-chat-mode] dictionaries not re-registered:', error);
              return undefined;
            }
          }, 'chat-mode: dictionaries');
        }

        ctx.effect(() => insertStyles(), 'chat-mode: surface styles');

        const register = (key, options, component) => {
          try {
            return slots.inject(key, () => slots.register(options, component));
          } catch (error) {
            console.error(`[dsh-chat-mode] ${key} slot failed to register:`, error);
            return undefined;
          }
        };

        register('conversation.header.leading', { name: 'conversation.header.leading', locale: NS }, ModeSwitch);
        register('main', { name: 'main', key: PANEL_KEY, locale: NS }, EmbeddedChat);

        // The panel must be registered before it can be selected, so this runs
        // after registration. Entering chat mode navigates and collapses the
        // sidebar; leaving it restores both, but only the parts this plugin
        // changed — a sidebar the user had already collapsed stays collapsed, and
        // a Conversation the user navigated away from is not re-selected.
        ctx.effect(() => {
          if (mode === CHAT) {
            showChatPanel(layout);
            syncSidebar(layout, CHAT);
          }
          return subscribe((next) => {
            if (next === CHAT) {
              showChatPanel(layout);
              syncSidebar(layout, CHAT);
              return;
            }
            syncSidebar(layout, WORK);
            restoreConversation(layout);
          });
        }, 'chat-mode: shell sync');
      },
    };
  },
});
