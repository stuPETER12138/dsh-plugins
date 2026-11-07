/**
 * Host half of the Sticky Wall bundle.
 *
 * The notes live in the browser (the Client module owns the sidebar entry,
 * the wall panel, and its local storage). Installing the package only needs a
 * Loader row so the Client module system publishes the browser bundle; this
 * half therefore has nothing to register.
 *
 * @module @local/dsh-sticky-wall
 */

/** Activate the Host row; all behavior is in `./client`. */
export function apply() {}
