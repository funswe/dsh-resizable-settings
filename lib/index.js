/**
 * Host half of dsh-resizable-settings. Pure UI plugin: the empty apply exists so
 * the plugin appears in the Loader tree; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */

/** Host plugin body — no host-side behavior for this UI-only plugin. */
export function apply() {}
