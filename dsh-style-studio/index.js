/**
 * Host half of the Style Studio bundle.
 *
 * Styling is a browser concern: the Client module owns the sidebar entry, the
 * style panel, and the theme-token override layer. Installing the package only
 * needs a Loader row so the Client module system publishes the browser bundle;
 * this half therefore registers nothing.
 *
 * @module @local/dsh-style-studio
 */

/** Activate the Host row; all behavior is in `./client`. */
export function apply() {}
