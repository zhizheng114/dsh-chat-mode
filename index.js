/**
 * Host half of the chat-mode bundle.
 *
 * The delivered capability is entirely browser-side: the mode switch renders in
 * the Conversation header seat, and chat mode selects a `main` panel that embeds
 * chat.deepseek.com through the Desktop shell's own Electron webview bridge
 * (`window.dshDesktop.browser`). No Host event, service, tool, or persisted
 * document is involved, so this half only has to exist for the bundle row.
 *
 * Deliberately no Host-side network code, and no Host-side credential storage: the
 * web session lives in the guest page's own localStorage, and the copy that carries
 * it across restarts is written by the Client half into the application origin's
 * storage, on this device only. Nothing here reads or proxies the official site.
 */
export function apply() {}
