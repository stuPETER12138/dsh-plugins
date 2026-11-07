# Style Studio · 风格工作台

A DeepSeek Harness Web UI plugin that adds a **视觉风格 / Visual styles** row to
**Settings → General**, directly under the Appearance row. Pick one of five
hand-made visual styles to reskin the whole application:

| Style | Character |
| --- | --- |
| 水墨书画 · Ink & Brush | Rice-paper warmth and ink-black type set in LXGW WenKai (霞鹜文楷), with cinnabar, malachite, and ochre accents. Its night mode is inkstone black, ivory type, muted cinnabar, and a bespoke deep elevation scale. |
| 深空极夜 · Midnight Sky | Deep navy grounds, starlight blues, glassy surfaces, soft glow |
| 苔原森野 · Moss & Meadow | Moss green and cream, softly rounded edges, field-notebook calm |
| 像素街机 · Pixel Arcade | 8-bit arcade palette: neon magenta and cyan, square corners, hard pixel shadows, monospace UI type |
| 石墨黑白 · Graphite Mono | Pure black/white/gray, crisp square corners, editorial minimalism |

Each style ships a light and a dark palette, so the Appearance row above
(light / dark / system) keeps working; the style adapts automatically.

## Use

1. Install the bundle: `plugin_manager` → `install_bundle` with this directory.
2. Open **Settings** — the sidebar's bottom Settings control, or the Settings
   shortcut (`Ctrl/Cmd + ,` on Desktop, `Ctrl/Cmd + Alt + ,` in the browser).
3. In **General**, find the **视觉风格 / Visual styles** row under Appearance.
4. Click a style chip. The whole app — panels, conversation, composer, menus,
   dialogs, code blocks, and other plugins built on theme tokens — changes
   immediately. **恢复默认 / Reset to default** returns to the stock look; each
   chip's tooltip carries the style description.

The choice is stored in the browser's local storage (`dsh.style-studio.v1`), so
it survives reloads and restarts on that browser. The durable light/dark
preference stays owned by Settings.

## Why a General row instead of a Settings section

The Settings navigation shows one icon per section, chosen by the shell from the
section id; third-party section ids fall back to the same gear as General, so a
dedicated "Visual styles" section duplicated that icon. The plugin therefore
contributes a `settings.general.item` row — the same extension point the
Appearance row uses — and adds no navigation entry of its own.

## How it works

- **General row:** a `settings.general.item` registration (`id: visual-style`,
  order 12, copy from the `styleStudio` dictionary) renders below Appearance.
  The shell owns the dialog, padding, and scrolling; the row matches the
  General section's row rhythm (title, description, 16px vertical padding).
- **Row:** a React view with the five styles as compact chips — each chip shows a
  light/dark half swatch, an accent dot, and the localized style name; the active
  chip is marked with `aria-pressed`.
- **Structure:** the five styles are compact data (a 36-color palette per scheme
  plus the typography, corner, and elevation values that differ from
  `BASE_COMMON`). CSS variable names are derived from palette keys, and the
  110-token layer is built from a direct-projection table plus a small
  `color-mix()` composition table, so one palette value covers every host token
  that uses it. A style may add `commonDark` for elevation that only fits the
  dark scheme (the Ink style uses it for deep, soft shadows).
- **Reskinning:** one `ctx.theme.overrideTokens('@local/dsh-style-studio', …)`
  layer maps 110 host tokens (`--dsw-alias-*`, `--dsw-specific-*`,
  typography, radius, shadow, switch, thinking-fade, and menu-material tokens)
  to Style Studio palette variables. A plugin-owned stylesheet declares those
  variables under `body[data-dsh-style="<id>"]` (light) and
  `body[data-dsh-style="<id>"][data-ds-dark-theme]` (dark).
- **Switching** writes one body attribute and re-registers the layer, which
  emits a single `theme/change`. Nothing else in the host is touched, so
  uninstalling or disabling the plugin restores the stock appearance.

## Notes and limits

- A font chosen in Settings → Appearance still wins over a style's typeface;
  only the Ink and Pixel styles change the text/brand font when no custom font
  is set.
- The Ink style prefers **LXGW WenKai · 霞鹜文楷** for text and brand, and
  **LXGW WenKai Mono · 霞鹜文楷等宽** for code (both installed on this machine).
  The stack falls back to Songti/SimSun/serif on machines without it.
- The macOS desktop sidebar carries a hard-coded host gradient tint
  (`ui-layout`), which no theme token reaches; the rest of the UI is themed.
- On reload the first paint shows the stock palette for a moment before the
  client plugin re-applies the saved style; the host boot script cannot know
  about third-party palettes.
- The five palettes are original artwork (authored colors and CSS values);
  the plugin ships an original icon.
