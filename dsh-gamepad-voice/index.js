/**
 * Host half of the Controller & voice bundle.
 *
 * Everything this plugin does runs in the browser: the left-sidebar entry, the
 * controller page, the global gamepad loop, the microphone capture, and the
 * dictation HUD. The transcript itself comes from DSH's own experimental
 * `remote.speech` browser Remote (mounted by the optional Voice input bundle),
 * so this half only needs a Loader row to publish the browser module.
 *
 * @module @local/dsh-gamepad-voice
 */

/** Activate the Host row; all behavior is in `./client`. */
export function apply() {}
