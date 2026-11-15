/**
 * Style Studio — the browser half of `@local/dsh-style-studio`.
 *
 * Two registrations, both made through slot declarations so they survive the
 * sidebar or layout re-declaring its slots:
 *  - `sidebar.panellist` — the left-sidebar row and its palette glyph;
 *  - `main` (key `style-studio`) — the Style Studio page itself.
 *
 * The page switches one of six application-wide styles and owns the frosted
 * glass theme's backdrop: a custom image (or a built-in gradient) painted on
 * the body's `::before`, blurred, with a haze layer above it. Reskinning rides
 * the supported theme seam: one `ctx.theme.overrideTokens` layer maps host
 * tokens onto `--dsh-style-*` palette variables, which the plugin stylesheet
 * declares per `body[data-dsh-style="<id>"]` (light), `[data-ds-dark-theme]`
 * (dark), and an optional per-style dark elevation block. Translucent palette
 * colors let the frosted glass style show the backdrop through the surfaces.
 *
 * The wallpaper image lives in this browser's IndexedDB (its `Blob`, so the
 * 5 MB localStorage limit does not apply); the tuning values and the chosen
 * style live in localStorage. Nothing here talks to the Host.
 *
 * Bundle format: the client module system executes only the factory below and
 * materializes it lazily. React comes from the platform module table, so this
 * file requires nothing else and declares no `dsh.client.external`.
 *
 * @module @local/dsh-style-studio/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-style-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'styleStudio'
    /** Panel id: sidebar row id and the layout's main-slot key. */
    const PANEL_ID = 'style-studio'
    /** Override-layer identity; one layer per source. */
    const STYLE_SOURCE = '@local/dsh-style-studio'
    /** Body attribute selecting the active palette variables. */
    const STYLE_ATTR = 'data-dsh-style'
    /** Body attribute selecting the built-in backdrop gradient. */
    const BG_ATTR = 'data-dss-bg'
    /** Browser-local selection key. */
    const STORAGE_KEY = 'dsh.style-studio.v1'
    /** Browser-local backdrop tuning key. */
    const GLASS_KEY = 'dsh.style-studio.glass.v1'
    /** Body custom property carrying the uploaded image. */
    const IMAGE_VAR = '--dss-glass-image'
    /** Body custom property carrying the backdrop blur radius. */
    const BLUR_VAR = '--dss-glass-blur'
    /** Body custom property carrying the haze opacity. */
    const HAZE_VAR = '--dss-glass-haze'
    /** Body custom property scaling every translucent glass fill. */
    const DENSITY_VAR = '--dss-glass-alpha'
    /** IndexedDB identity of the uploaded wallpaper. */
    const DB_NAME = 'dsh-style-studio'
    const DB_VERSION = 1
    const DB_STORE = 'wallpaper'
    const DB_KEY = 'current'
    /** Largest wallpaper the page accepts. */
    const MAX_IMAGE_BYTES = 24 * 1024 * 1024
    /** How long a status message stays visible. */
    const STATUS_MS = 4200
    /** How long a removed wallpaper is held for undo. */
    const UNDO_MS = 8000

    // ── copy ──────────────────────────────────────────────────────────────

    const zh = {
      panel: '视觉风格',
      title: '视觉风格',
      subtitle: '为整个 DeepSeek Harness 换一张皮，点选立即生效。浅色 / 深色仍由「设置 → 外观」决定，风格会自动适配。',
      sectionTheme: '主题',
      sectionThemeDesc: '六套手工调色板，覆盖面板、会话气泡、代码块、菜单与输入框。',
      sectionBackdrop: '毛玻璃背景',
      sectionBackdropDesc: '选一张自己的图片铺在底层，磨砂面板会浮在上面。面板浓度越高面板越实、文字越清晰；图片只保存在这台电脑的浏览器里。',
      reset: '恢复默认外观',
      resetBackdrop: '恢复默认背景',
      glassOnlyHint: '背景参数只在「毛玻璃」主题下生效。',
      useGlass: '切换到毛玻璃',
      chooseImage: '选择图片',
      replaceImage: '更换图片',
      removeImage: '移除图片',
      dropHint: '拖入图片，或点击选择',
      dropActive: '松开即可设为背景',
      replaceHint: '点击更换，或拖入新的图片',
      noImage: '还没有自定义图片，当前使用下面的内置渐变。',
      gradientsLabel: '内置渐变',
      gradientsHint: '没有图片时使用',
      gradientsInactiveHint: '移除图片后使用',
      blurLabel: '背景模糊',
      hazeLabel: '雾面浓度',
      densityLabel: '面板浓度',
      privacy: '图片存在本机 IndexedDB 中，不会上传，也不写任何文件。',
      processing: '正在处理图片…',
      applied: '背景已更新',
      appliedSwitched: '背景已更新，并切换到毛玻璃主题',
      appliedUnstored: '背景已更新，但浏览器拒绝持久保存，本次会话内有效',
      imageRemoved: '已移除背景图片',
      undo: '撤销',
      undoDone: '已恢复背景图片',
      resetDone: '背景已恢复默认',
      notImage: '请选择图片文件（PNG、JPEG、WebP、GIF 或 AVIF）',
      tooLarge: '图片太大了，请选择 24 MB 以内的图片',
      readFailed: '这张图片读不出来，请换一张',
      'style.glass.name': '毛玻璃',
      'style.glass.desc': '现代简约的磨砂玻璃：半透明面板、柔和的圆角与细描边，配一张自己的图片，界面悬浮在模糊的背景之上。',
      'style.ink.name': '水墨书画',
      'style.ink.desc': '宣纸暖白与墨色文字，朱砂、石绿、赭石相间，通篇霞鹜文楷；深色是砚池夜墨，象牙色字与低饱和朱砂，安静而克制。',
      'style.midnight.name': '深空极夜',
      'style.midnight.desc': '幽蓝深底与冷冽星辉，玻璃质感与柔光，适合夜间长谈。',
      'style.forest.name': '苔原森野',
      'style.forest.desc': '苔绿与奶油的自然配色，圆润柔和的边界，像一本林间手账。',
      'style.pixel.name': '像素街机',
      'style.pixel.desc': '8-bit 街机配色：霓虹洋红与青蓝、直角边框与硬边投影，像一台老式游戏机的界面。',
      'style.mono.name': '石墨黑白',
      'style.mono.desc': '纯黑白灰与利落直角，高对比的极简编辑部风格。',
      'gradient.aurora': '极光',
      'gradient.sand': '暖沙',
      'gradient.dusk': '暮色',
    }

    const en = {
      panel: 'Style Studio',
      title: 'Style Studio',
      subtitle: 'Reskin the whole DeepSeek Harness; pick one to apply instantly. Light and dark stay with Settings → Appearance, and every style adapts to both.',
      sectionTheme: 'Themes',
      sectionThemeDesc: 'Six hand-tuned palettes covering panels, message bubbles, code, menus, and inputs.',
      sectionBackdrop: 'Glass backdrop',
      sectionBackdropDesc: "Set your own photo underneath and let the frosted panels float above it. Higher panel density makes panels more solid and text easier to read; the image stays in this computer's browser.",
      reset: 'Reset to default',
      resetBackdrop: 'Reset backdrop',
      glassOnlyHint: 'These settings apply while the Frosted Glass theme is active.',
      useGlass: 'Use Frosted Glass',
      chooseImage: 'Choose image',
      replaceImage: 'Replace image',
      removeImage: 'Remove image',
      dropHint: 'Drop an image, or click to choose',
      dropActive: 'Release to use this image',
      replaceHint: 'Click to replace, or drop a new image',
      noImage: 'No custom image yet — one of the built-in gradients is showing.',
      gradientsLabel: 'Built-in gradients',
      gradientsHint: 'Used when no image is set',
      gradientsInactiveHint: 'Used once the image is removed',
      blurLabel: 'Backdrop blur',
      hazeLabel: 'Haze',
      densityLabel: 'Panel density',
      privacy: 'The image is stored in this browser (IndexedDB). Nothing is uploaded and no file is written.',
      processing: 'Processing image…',
      applied: 'Backdrop updated',
      appliedSwitched: 'Backdrop updated and Frosted Glass applied',
      appliedUnstored: 'Backdrop updated, but this browser refused to store it — it applies to this session only',
      imageRemoved: 'Backdrop image removed',
      undo: 'Undo',
      undoDone: 'Backdrop image restored',
      resetDone: 'Backdrop reset',
      notImage: 'Choose an image file (PNG, JPEG, WebP, GIF, or AVIF)',
      tooLarge: 'That image is too large — pick one under 24 MB',
      readFailed: 'That image could not be read — please try another',
      'style.glass.name': 'Frosted Glass',
      'style.glass.desc': 'Modern minimal glass: translucent panels, soft rounded corners, and hairline borders. Add a photo and the interface floats above a blurred backdrop.',
      'style.ink.name': 'Ink & Brush',
      'style.ink.desc': 'Rice-paper warmth and ink-black type set in LXGW WenKai, with cinnabar, malachite, and ochre accents. Its night mode is inkstone black, ivory text, and muted cinnabar — quiet and restrained.',
      'style.midnight.name': 'Midnight Sky',
      'style.midnight.desc': 'Deep navy grounds, cool starlight blues, glassy surfaces, and a soft glow for long nights.',
      'style.forest.name': 'Moss & Meadow',
      'style.forest.desc': 'Moss green and cream, softly rounded edges — the calm of a field notebook.',
      'style.pixel.name': 'Pixel Arcade',
      'style.pixel.desc': '8-bit arcade colors: neon magenta and cyan, square corners, and hard pixel shadows — an old game console, rebuilt.',
      'style.mono.name': 'Graphite Mono',
      'style.mono.desc': 'Pure black, white, and gray with crisp square corners — editorial minimalism.',
      'gradient.aurora': 'Aurora',
      'gradient.sand': 'Warm sand',
      'gradient.dusk': 'Dusk',
    }

    // ── palette vocabulary ────────────────────────────────────────────────

    /** Palette keys in declaration order; each becomes `--dsh-style-<kebab>`. */
    const COLOR_KEYS = [
      'paper', 'surface', 'surface2', 'surface3', 'overlay', 'platform',
      'sidebar', 'sidebarActive', 'sidebarHover', 'ink', 'ink2', 'ink3', 'ink4',
      'line1', 'line2', 'line3', 'line4', 'brand', 'brandHover', 'onBrand',
      'accent', 'accentStrong', 'accentSoft', 'code', 'inline', 'bubble',
      'bubbleStrong', 'input', 'menu', 'hover', 'success', 'warn', 'error',
      'toastBg', 'toastFg', 'thumb',
    ]

    /** Mode-independent keys: typography, corner, and elevation language. */
    const COMMON_KEYS = [
      'fontText', 'fontCode', 'fontBrand',
      'radiusXs', 'radiusSm', 'radiusMd', 'radiusLg', 'radiusXl', 'radiusPanel',
      'shadow1', 'shadow2', 'shadow3', 'menuBackdrop',
    ]

    /** `surface2` → `surface-2`, `onBrand` → `on-brand`. */
    const kebab = (key) => key.replace(/([A-Z0-9])/g, '-$1').toLowerCase()
    /** Palette/common key → CSS custom property. */
    const varName = (key) => '--dsh-style-' + kebab(key)
    /** Palette/common key → `var(...)` reference for the token layer. */
    const V = (key) => 'var(' + varName(key) + ')'
    /** A `color-mix` of one palette color with an alpha percentage, or with another key. */
    const mix = (a, pct, b) => 'color-mix(in srgb, ' + V(a) + ' ' + pct + '%, ' + (b === undefined ? 'transparent' : V(b)) + ')'

    const COLOR_VARS = Object.fromEntries(COLOR_KEYS.map((key) => [key, varName(key)]))
    const COMMON_VARS = Object.fromEntries(COMMON_KEYS.map((key) => [key, varName(key)]))

    // ── typography ────────────────────────────────────────────────────────

    const SANS_TEXT_FONT =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
    const SANS_CODE_FONT =
      '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"'
    const BRAND_FONT = '"Montserrat", ' + SANS_TEXT_FONT
    /**
     * LXGW WenKai (霞鹜文楷) — the literary Kai face installed on this machine,
     * with the serif/Songti stacks as the fallback on other machines. The Mono
     * variant carries code blocks so the Chinese style stays typographically
     * coherent; a user-chosen font in Settings still wins.
     */
    const WENKAI_TEXT_FONT =
      '"霞鹜文楷", "LXGW WenKai", "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", STSong, SimSun, serif'
    const WENKAI_BRAND_FONT =
      '"霞鹜文楷", "LXGW WenKai", "STKaiti", "KaiTi", "Kaiti SC", "Songti SC", serif'
    const WENKAI_CODE_FONT =
      '"霞鹜文楷等宽", "LXGW WenKai Mono", "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"'
    const PIXEL_TEXT_FONT =
      '"Cascadia Mono", "SF Mono", Consolas, "PingFang SC", "Microsoft YaHei", monospace'
    const PIXEL_CODE_FONT =
      '"Cascadia Code", "Cascadia Mono", Consolas, "SF Mono", "Fira Code", monospace'
    const PIXEL_BRAND_FONT = '"Cascadia Mono", Consolas, "PingFang SC", "Microsoft YaHei", monospace'
    /** Glass keeps the platform UI face: no display fonts, tight and neutral. */
    const GLASS_TEXT_FONT =
      '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
    const GLASS_CODE_FONT =
      '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, "Fira Code", "Liberation Mono", Menlo, monospace'
    const GLASS_BRAND_FONT =
      '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif'

    // ── the six styles ────────────────────────────────────────────────────

    /** Typography, corner, and elevation defaults every style starts from. */
    const BASE_COMMON = {
      fontText: SANS_TEXT_FONT,
      fontCode: SANS_CODE_FONT,
      fontBrand: BRAND_FONT,
      radiusXs: '4px',
      radiusSm: '8px',
      radiusMd: '12px',
      radiusLg: '16px',
      radiusXl: '20px',
      radiusPanel: '28px',
      shadow1: '0 2px 4px 0 rgb(16 16 20 / 5%)',
      shadow2: '0 4px 12px 0 rgb(16 16 20 / 6%), 0 2px 8px 0 rgb(16 16 20 / 4%)',
      shadow3: '0 12px 32px 0 rgb(16 16 20 / 10%), 0 4px 10px 0 rgb(16 16 20 / 6%)',
      menuBackdrop: 'blur(40px) saturate(150%)',
    }

    /**
     * One translucent glass fill. The base alpha is the value at 100% panel
     * density; the page's "panel density" slider scales it, so users can trade
     * backdrop visibility for readability without a second palette.
     */
    const glassFill = (base) => ' / calc(' + base + ' * var(--dss-glass-alpha, 1))'

    /**
     * Style specs: original palettes for both schemes plus the mode-independent
     * language. A style may add `commonDark` for elevation that only fits the
     * dark scheme. Declarations are validated at load.
     */
    const PRESET_SPECS = [
      {
        id: 'glass',
        nameKey: 'style.glass.name',
        descKey: 'style.glass.desc',
        light: {
          paper: 'rgb(247 249 253' + glassFill('0.48') + ')', surface: 'rgb(255 255 255' + glassFill('0.94') + ')',
          surface2: 'rgb(255 255 255' + glassFill('0.88') + ')', surface3: 'rgb(255 255 255' + glassFill('0.97') + ')',
          overlay: 'rgb(253 254 255' + glassFill('0.98') + ')', platform: 'rgb(255 255 255' + glassFill('0.85') + ')',
          sidebar: 'rgb(252 253 255' + glassFill('0.93') + ')', sidebarActive: 'rgb(255 255 255' + glassFill('0.97') + ')',
          sidebarHover: 'rgb(255 255 255' + glassFill('0.86') + ')', ink: '#161A21', ink2: '#3C4655',
          ink3: '#657082', ink4: '#6F7A89', line1: 'rgb(16 22 34 / 8%)',
          line2: 'rgb(16 22 34 / 12%)', line3: 'rgb(16 22 34 / 18%)',
          line4: 'rgb(16 22 34 / 26%)', brand: '#161A21', brandHover: '#262B35',
          onBrand: '#F7F9FD', accent: '#3D63DD', accentStrong: '#2C4FC0',
          accentSoft: 'rgb(61 99 221 / 14%)', code: 'rgb(255 255 255' + glassFill('0.94') + ')',
          inline: 'rgb(255 255 255' + glassFill('0.88') + ')', bubble: 'rgb(255 255 255' + glassFill('0.92') + ')',
          bubbleStrong: 'rgb(255 255 255' + glassFill('0.96') + ')', input: 'rgb(255 255 255' + glassFill('0.96') + ')',
          menu: 'rgb(252 253 255' + glassFill('0.98') + ')', hover: 'rgb(16 22 34 / 6%)',
          success: '#177F5B', warn: '#9A6B12', error: '#C23A4B',
          toastBg: 'rgb(18 22 30 / 94%)', toastFg: '#F7F9FD', thumb: '#FFFFFF',
        },
        dark: {
          paper: 'rgb(11 13 17' + glassFill('0.62') + ')', surface: 'rgb(26 30 37' + glassFill('0.95') + ')',
          surface2: 'rgb(32 37 45' + glassFill('0.9') + ')', surface3: 'rgb(42 48 58' + glassFill('0.97') + ')',
          overlay: 'rgb(20 24 30' + glassFill('0.98') + ')', platform: 'rgb(16 19 24' + glassFill('0.86') + ')',
          sidebar: 'rgb(13 16 21' + glassFill('0.94') + ')', sidebarActive: 'rgb(52 59 70' + glassFill('0.97') + ')',
          sidebarHover: 'rgb(32 37 45' + glassFill('0.87') + ')', ink: '#EDF1F7', ink2: '#C2CAD6',
          ink3: '#94A0B1', ink4: '#6D7889', line1: 'rgb(237 241 247 / 10%)',
          line2: 'rgb(237 241 247 / 15%)', line3: 'rgb(237 241 247 / 22%)',
          line4: 'rgb(237 241 247 / 30%)', brand: '#F1F5FA', brandHover: '#FFFFFF',
          onBrand: '#11151B', accent: '#8FA9FF', accentStrong: '#B3C6FF',
          accentSoft: 'rgb(143 169 255 / 18%)', code: 'rgb(20 24 30' + glassFill('0.95') + ')',
          inline: 'rgb(26 30 37' + glassFill('0.89') + ')', bubble: 'rgb(28 33 40' + glassFill('0.93') + ')',
          bubbleStrong: 'rgb(38 44 53' + glassFill('0.96') + ')', input: 'rgb(22 26 32' + glassFill('0.97') + ')',
          menu: 'rgb(22 26 33' + glassFill('0.98') + ')', hover: 'rgb(237 241 247 / 8%)',
          success: '#4FC397', warn: '#E8BE63', error: '#FF7C88',
          toastBg: 'rgb(240 244 250 / 94%)', toastFg: '#11151B', thumb: '#B9C2CF',
        },
        common: {
          fontText: GLASS_TEXT_FONT, fontCode: GLASS_CODE_FONT, fontBrand: GLASS_BRAND_FONT,
          radiusXs: '5px', radiusSm: '9px', radiusMd: '13px', radiusLg: '18px',
          radiusXl: '24px', radiusPanel: '28px', shadow1: '0 1px 2px 0 rgb(15 23 42 / 5%)',
          shadow2: '0 8px 24px 0 rgb(15 23 42 / 9%), 0 1px 2px 0 rgb(15 23 42 / 6%)',
          shadow3: '0 24px 56px 0 rgb(15 23 42 / 16%), 0 3px 10px 0 rgb(15 23 42 / 8%)',
          menuBackdrop: 'blur(28px) saturate(180%)',
        },
        commonDark: {
          shadow1: '0 1px 2px 0 rgb(0 0 0 / 36%)',
          shadow2: '0 10px 28px 0 rgb(0 0 0 / 42%), 0 1px 3px 0 rgb(0 0 0 / 26%)',
          shadow3: '0 26px 64px 0 rgb(0 0 0 / 52%), 0 4px 14px 0 rgb(0 0 0 / 28%)',
        },
      },
      {
        id: 'ink',
        nameKey: 'style.ink.name',
        descKey: 'style.ink.desc',
        light: {
          paper: '#F7F3EA', surface: '#FDFBF5', surface2: '#F2ECE0', surface3: '#EAE2D2',
          overlay: '#FFFDF8', platform: '#F0E9DB', sidebar: '#F4EEE2', sidebarActive: '#EAE0CD',
          sidebarHover: '#EFE7D7', ink: '#23201B', ink2: '#4A443A', ink3: '#6F6657',
          ink4: '#8B806E', line1: '#23201B12', line2: '#23201B22', line3: '#23201B33',
          line4: '#23201B45', brand: '#2A2620', brandHover: '#3D372D', onBrand: '#FBF7EE',
          accent: '#9C3B30', accentStrong: '#83302A', accentSoft: '#EFDBD3', code: '#F3EDE1',
          inline: '#F0E8DA', bubble: '#EDE5D6', bubbleStrong: '#F6F0E4', input: '#FFFDF7',
          menu: '#FBF7EE', hover: '#23201B0A', success: '#4C7248', warn: '#8F651F',
          error: '#A3352B', toastBg: '#2A2620', toastFg: '#F7F2E6', thumb: '#FFFFFF',
        },
        dark: {
          paper: '#121311', surface: '#191A18', surface2: '#202220', surface3: '#282B28',
          overlay: '#1D1F1C', platform: '#151714', sidebar: '#0F100F', sidebarActive: '#262924',
          sidebarHover: '#1C1E1B', ink: '#E8E2D4', ink2: '#BFB6A5', ink3: '#948B7B',
          ink4: '#6E675A', line1: '#E8E2D40F', line2: '#E8E2D41F', line3: '#E8E2D42E',
          line4: '#E8E2D43D', brand: '#D9CFBC', brandHover: '#E8DFCC', onBrand: '#14150F',
          accent: '#C86A56', accentStrong: '#DA7E69', accentSoft: '#3A2520', code: '#161816',
          inline: '#1E201D', bubble: '#22231D', bubbleStrong: '#2C2D26', input: '#191B18',
          menu: '#1E201C', hover: '#FFFFFF0F', success: '#7FA97E', warn: '#C9A25C',
          error: '#DE7A6B', toastBg: '#2A2C26', toastFg: '#EFE8DA', thumb: '#A8A090',
        },
        common: {
          fontText: WENKAI_TEXT_FONT, fontCode: WENKAI_CODE_FONT, fontBrand: WENKAI_BRAND_FONT,
          radiusXs: '2px', radiusSm: '6px', radiusMd: '10px',
          radiusLg: '14px', radiusXl: '18px', radiusPanel: '22px', shadow1: '0 1px 2px 0 rgb(32 26 18 / 8%)',
          shadow2: '0 6px 18px 0 rgb(32 26 18 / 10%), 0 1px 3px 0 rgb(32 26 18 / 6%)',
          shadow3: '0 20px 48px 0 rgb(32 26 18 / 14%), 0 3px 10px 0 rgb(32 26 18 / 8%)',
          menuBackdrop: 'blur(20px) saturate(120%)',
        },
        commonDark: {
          shadow1: '0 2px 6px 0 rgb(0 0 0 / 40%)',
          shadow2: '0 10px 28px 0 rgb(0 0 0 / 46%), 0 2px 6px 0 rgb(0 0 0 / 24%)',
          shadow3: '0 24px 64px 0 rgb(0 0 0 / 55%), 0 4px 14px 0 rgb(0 0 0 / 30%)',
        },
      },
      {
        id: 'midnight',
        nameKey: 'style.midnight.name',
        descKey: 'style.midnight.desc',
        light: {
          paper: '#F3F6FC', surface: '#FBFDFF', surface2: '#EEF3FB', surface3: '#E4EBF7',
          overlay: '#FDFEFF', platform: '#EDF2FA', sidebar: '#F1F5FC', sidebarActive: '#E3EBF9',
          sidebarHover: '#E9EFFA', ink: '#101A2C', ink2: '#3A4A63', ink3: '#5F7291',
          ink4: '#7989A5', line1: '#101A2C0F', line2: '#101A2C1F', line3: '#101A2C29',
          line4: '#101A2C38', brand: '#24407A', brandHover: '#1B3263', onBrand: '#F3F8FF',
          accent: '#2E63D9', accentStrong: '#1F4FBF', accentSoft: '#DCE8FF', code: '#EDF2FB',
          inline: '#E9EFFA', bubble: '#E6EEFB', bubbleStrong: '#F1F6FF', input: '#FCFEFF',
          menu: '#F8FBFF', hover: '#101A2C0D', success: '#26735A', warn: '#946418',
          error: '#C33B49', toastBg: '#17233B', toastFg: '#F2F7FF', thumb: '#FFFFFF',
        },
        dark: {
          paper: '#070C16', surface: '#0D1524', surface2: '#121C30', surface3: '#17233A',
          overlay: '#101A2C', platform: '#0A1120', sidebar: '#080E1A', sidebarActive: '#142138',
          sidebarHover: '#0F1A2C', ink: '#E7F0FF', ink2: '#B9CAE6', ink3: '#8CA1C2',
          ink4: '#66799A', line1: '#E7F0FF0F', line2: '#E7F0FF1F', line3: '#E7F0FF2E',
          line4: '#E7F0FF3D', brand: '#C9DBFF', brandHover: '#E2ECFF', onBrand: '#08101E',
          accent: '#6AA0FF', accentStrong: '#8CB8FF', accentSoft: '#15294A', code: '#0B1322',
          inline: '#111B2D', bubble: '#101C33', bubbleStrong: '#16243F', input: '#0C1424',
          menu: '#0E1728', hover: '#FFFFFF10', success: '#4CC79A', warn: '#F2BE5C',
          error: '#FF7285', toastBg: '#1B2942', toastFg: '#EAF2FF', thumb: '#8CA1C2',
        },
        common: {
          radiusXs: '6px', radiusSm: '10px', radiusMd: '14px', radiusLg: '18px', radiusXl: '24px',
          radiusPanel: '30px', shadow1: '0 1px 2px 0 rgb(5 12 30 / 14%)',
          shadow2: '0 6px 18px 0 rgb(5 12 30 / 22%), 0 0 0 0.5px rgb(120 170 255 / 10%)',
          shadow3: '0 16px 40px 0 rgb(5 12 30 / 38%), 0 0 24px 0 rgb(90 150 255 / 12%)',
          menuBackdrop: 'blur(32px) saturate(150%)',
        },
      },
      {
        id: 'forest',
        nameKey: 'style.forest.name',
        descKey: 'style.forest.desc',
        light: {
          paper: '#F4F3E7', surface: '#FCFBF2', surface2: '#EEEDDD', surface3: '#E5E4D0',
          overlay: '#FDFCF4', platform: '#EDECDC', sidebar: '#F1F0E1', sidebarActive: '#E1E3CD',
          sidebarHover: '#E8E9D7', ink: '#1F2A1C', ink2: '#45543F', ink3: '#6B7A5F',
          ink4: '#7E8A6B', line1: '#1F2A1C0F', line2: '#1F2A1C1F', line3: '#1F2A1C29',
          line4: '#1F2A1C38', brand: '#35502C', brandHover: '#2A4023', onBrand: '#F7F9EC',
          accent: '#4C6B38', accentStrong: '#3F5A2D', accentSoft: '#DFE9D0', code: '#F0EFDF',
          inline: '#ECEBDA', bubble: '#E9E8D5', bubbleStrong: '#F3F2E3', input: '#FDFCF5',
          menu: '#F9F8EC', hover: '#1F2A1C0D', success: '#4F7A3E', warn: '#86601F',
          error: '#A94A3C', toastBg: '#26331F', toastFg: '#F3F5E6', thumb: '#FFFFFF',
        },
        dark: {
          paper: '#10150D', surface: '#161D13', surface2: '#1C2518', surface3: '#232E1D',
          overlay: '#1A2215', platform: '#121810', sidebar: '#0E130C', sidebarActive: '#202B1A',
          sidebarHover: '#182112', ink: '#E6EED9', ink2: '#C0CCB0', ink3: '#97A786',
          ink4: '#6F7E60', line1: '#E6EED90F', line2: '#E6EED91F', line3: '#E6EED92E',
          line4: '#E6EED93D', brand: '#D7E5C2', brandHover: '#E8F1D8', onBrand: '#131A0F',
          accent: '#9CC77E', accentStrong: '#B4D99A', accentSoft: '#25331C', code: '#141B10',
          inline: '#1A2315', bubble: '#1C2716', bubbleStrong: '#24321C', input: '#151D11',
          menu: '#192214', hover: '#FFFFFF10', success: '#8CBB70', warn: '#DDB264',
          error: '#E28872', toastBg: '#2A3721', toastFg: '#EDF3E1', thumb: '#97A786',
        },
        common: {
          radiusXs: '6px', radiusSm: '12px', radiusMd: '18px', radiusLg: '24px', radiusXl: '30px',
          radiusPanel: '36px', shadow1: '0 1px 3px 0 rgb(28 42 22 / 10%)',
          shadow2: '0 5px 16px 0 rgb(28 42 22 / 13%), 0 1px 3px 0 rgb(28 42 22 / 7%)',
          shadow3: '0 14px 36px 0 rgb(28 42 22 / 18%)', menuBackdrop: 'blur(24px) saturate(130%)',
        },
      },
      {
        id: 'pixel',
        nameKey: 'style.pixel.name',
        descKey: 'style.pixel.desc',
        light: {
          paper: '#FFF8E7', surface: '#FFFFFF', surface2: '#F6EED8', surface3: '#EDE2C6',
          overlay: '#FFFDF4', platform: '#F3EBD5', sidebar: '#F8F1DD', sidebarActive: '#F0DFC0',
          sidebarHover: '#F5EDD8', ink: '#1A1A24', ink2: '#3D3D52', ink3: '#64647C',
          ink4: '#8C8CA6', line1: '#1A1A2414', line2: '#1A1A2429', line3: '#1A1A2440',
          line4: '#1A1A2459', brand: '#1A1A24', brandHover: '#32324A', onBrand: '#FFF8E7',
          accent: '#C21E5B', accentStrong: '#9E1449', accentSoft: '#F9D7E4', code: '#F4ECD9',
          inline: '#EFE5CF', bubble: '#FCE1EB', bubbleStrong: '#FFF0F6', input: '#FFFFFF',
          menu: '#FFFBEF', hover: '#1A1A240D', success: '#1B7F45', warn: '#966000',
          error: '#C81E1E', toastBg: '#1A1A24', toastFg: '#FFF8E7', thumb: '#FFFFFF',
        },
        dark: {
          paper: '#0B0B14', surface: '#131322', surface2: '#1B1B33', surface3: '#24244A',
          overlay: '#16162A', platform: '#10101E', sidebar: '#090911', sidebarActive: '#24244A',
          sidebarHover: '#16162B', ink: '#F4F2E6', ink2: '#C9C7DA', ink3: '#9C9AB5',
          ink4: '#6E6C8A', line1: '#F4F2E60F', line2: '#F4F2E61F', line3: '#F4F2E62E',
          line4: '#F4F2E63D', brand: '#4DE1FF', brandHover: '#8AEBFF', onBrand: '#08121A',
          accent: '#FF4D9D', accentStrong: '#FF7FBD', accentSoft: '#3A1B33', code: '#0E0E1E',
          inline: '#16162E', bubble: '#1C1B36', bubbleStrong: '#24224A', input: '#121224',
          menu: '#141428', hover: '#FFFFFF12', success: '#4DE38A', warn: '#FFC94D',
          error: '#FF5C5C', toastBg: '#24244A', toastFg: '#F4F2E6', thumb: '#C9C7DA',
        },
        common: {
          fontText: PIXEL_TEXT_FONT, fontCode: PIXEL_CODE_FONT, fontBrand: PIXEL_BRAND_FONT, radiusXs: '0px',
          radiusSm: '0px', radiusMd: '0px', radiusLg: '0px', radiusXl: '0px', radiusPanel: '0px',
          shadow1: '2px 2px 0 0 color-mix(in srgb, var(--dsh-style-ink) 20%, transparent)',
          shadow2: '3px 3px 0 0 color-mix(in srgb, var(--dsh-style-ink) 26%, transparent)',
          shadow3: '4px 4px 0 0 color-mix(in srgb, var(--dsh-style-ink) 34%, transparent)', menuBackdrop: 'none',
        },
      },
      {
        id: 'mono',
        nameKey: 'style.mono.name',
        descKey: 'style.mono.desc',
        light: {
          paper: '#FFFFFF', surface: '#FAFAFA', surface2: '#F2F2F2', surface3: '#E9E9E9',
          overlay: '#FEFEFE', platform: '#F6F6F6', sidebar: '#FAFAFA', sidebarActive: '#ECECEC',
          sidebarHover: '#F1F1F1', ink: '#101010', ink2: '#404040', ink3: '#6B6B6B',
          ink4: '#8A8A8A', line1: '#0000000F', line2: '#0000001F', line3: '#00000029',
          line4: '#00000038', brand: '#111111', brandHover: '#2C2C2C', onBrand: '#FFFFFF',
          accent: '#111111', accentStrong: '#000000', accentSoft: '#E8E8E8', code: '#F5F5F5',
          inline: '#F2F2F2', bubble: '#EDEDED', bubbleStrong: '#F7F7F7', input: '#FFFFFF',
          menu: '#FCFCFC', hover: '#0000000D', success: '#2E7D32', warn: '#8A590F',
          error: '#C62828', toastBg: '#111111', toastFg: '#FFFFFF', thumb: '#FFFFFF',
        },
        dark: {
          paper: '#0A0A0A', surface: '#141414', surface2: '#1C1C1C', surface3: '#252525',
          overlay: '#1B1B1B', platform: '#101010', sidebar: '#0C0C0C', sidebarActive: '#242424',
          sidebarHover: '#191919', ink: '#F5F5F5', ink2: '#CFCFCF', ink3: '#A3A3A3',
          ink4: '#787878', line1: '#FFFFFF0F', line2: '#FFFFFF1F', line3: '#FFFFFF2E',
          line4: '#FFFFFF3D', brand: '#F5F5F5', brandHover: '#FFFFFF', onBrand: '#0A0A0A',
          accent: '#F5F5F5', accentStrong: '#FFFFFF', accentSoft: '#2E2E2E', code: '#141414',
          inline: '#1B1B1B', bubble: '#1F1F1F', bubbleStrong: '#2A2A2A', input: '#141414',
          menu: '#171717', hover: '#FFFFFF10', success: '#7CC47F', warn: '#D9A64A',
          error: '#F07A72', toastBg: '#EDEDED', toastFg: '#111111', thumb: '#A3A3A3',
        },
        common: {
          radiusXs: '2px', radiusSm: '6px', radiusMd: '8px', radiusLg: '10px', radiusXl: '12px',
          radiusPanel: '14px', shadow1: '0 1px 0 0 rgb(0 0 0 / 6%)',
          shadow2: '0 2px 6px 0 rgb(0 0 0 / 10%), 0 1px 0 0 rgb(0 0 0 / 6%)',
          shadow3: '0 8px 24px 0 rgb(0 0 0 / 16%)', menuBackdrop: 'none',
        },
      },
    ]

    const PRESETS = PRESET_SPECS.map((spec) => ({
      ...spec,
      common: { ...BASE_COMMON, ...spec.common },
    }))

    // ── backdrop gradients ────────────────────────────────────────────────

    /**
     * Built-in backdrops used while no image is set. They are artwork, so they
     * carry their own colors instead of theme tokens; each one has a light and
     * a dark rendering chosen by `data-ds-dark-theme`.
     */
    const GRADIENTS = [
      {
        id: 'aurora',
        nameKey: 'gradient.aurora',
        light:
          'radial-gradient(90% 80% at 12% 0%, #DCE8FF 0%, rgb(220 232 255 / 0%) 62%),' +
          'radial-gradient(80% 70% at 88% 6%, #FCE3F1 0%, rgb(252 227 241 / 0%) 58%),' +
          'radial-gradient(90% 90% at 50% 100%, #DFF6EC 0%, rgb(223 246 236 / 0%) 62%),' +
          'linear-gradient(165deg, #F6F9FE 0%, #EDF2FA 100%)',
        dark:
          'radial-gradient(90% 80% at 12% 0%, #1D3357 0%, rgb(29 51 87 / 0%) 64%),' +
          'radial-gradient(80% 70% at 88% 6%, #3A2040 0%, rgb(58 32 64 / 0%) 60%),' +
          'radial-gradient(90% 90% at 50% 100%, #123733 0%, rgb(18 55 51 / 0%) 62%),' +
          'linear-gradient(165deg, #0A0E15 0%, #0D121B 100%)',
      },
      {
        id: 'sand',
        nameKey: 'gradient.sand',
        light:
          'radial-gradient(85% 75% at 8% 4%, #FCEFD9 0%, rgb(252 239 217 / 0%) 60%),' +
          'radial-gradient(80% 70% at 92% 0%, #F6E2DA 0%, rgb(246 226 218 / 0%) 58%),' +
          'radial-gradient(95% 90% at 60% 100%, #EFF3E2 0%, rgb(239 243 226 / 0%) 62%),' +
          'linear-gradient(160deg, #FBF7F0 0%, #F4EDE2 100%)',
        dark:
          'radial-gradient(85% 75% at 8% 4%, #4A3520 0%, rgb(74 53 32 / 0%) 62%),' +
          'radial-gradient(80% 70% at 92% 0%, #4A2B26 0%, rgb(74 43 38 / 0%) 58%),' +
          'radial-gradient(95% 90% at 60% 100%, #2A3322 0%, rgb(42 51 34 / 0%) 60%),' +
          'linear-gradient(160deg, #15110C 0%, #191410 100%)',
      },
      {
        id: 'dusk',
        nameKey: 'gradient.dusk',
        light:
          'radial-gradient(90% 80% at 10% 0%, #E6E2FF 0%, rgb(230 226 255 / 0%) 62%),' +
          'radial-gradient(85% 75% at 90% 8%, #FFE1E8 0%, rgb(255 225 232 / 0%) 58%),' +
          'radial-gradient(95% 90% at 45% 100%, #DCEBFB 0%, rgb(220 235 251 / 0%) 62%),' +
          'linear-gradient(160deg, #F8F6FE 0%, #EEF0FA 100%)',
        dark:
          'radial-gradient(90% 80% at 10% 0%, #2F264F 0%, rgb(47 38 79 / 0%) 62%),' +
          'radial-gradient(85% 75% at 90% 8%, #4A2333 0%, rgb(74 35 51 / 0%) 58%),' +
          'radial-gradient(95% 90% at 45% 100%, #13293F 0%, rgb(19 41 63 / 0%) 60%),' +
          'linear-gradient(160deg, #0B0D16 0%, #0E1018 100%)',
      },
    ]

    /** Backdrop defaults: a soft aurora, medium blur, readable haze, solid panels. */
    const DEFAULT_GLASS = { gradient: 'aurora', blur: 18, haze: 38, density: 100 }

    // ── token layer ───────────────────────────────────────────────────────

    /** Host token → palette key (direct `var()` projection). */
    const DIRECT_TOKENS = {
      '--dsw-alias-bg-base': 'paper',
      '--dsw-alias-bg-layer-1': 'surface',
      '--dsw-alias-bg-layer-2': 'surface2',
      '--dsw-alias-bg-layer-3': 'surface3',
      '--dsw-alias-bg-overlay': 'overlay',
      '--dsw-alias-bg-module-platform': 'platform',
      '--dsw-alias-bg-multi-select': 'platform',
      '--dsw-alias-border-l1': 'line1',
      '--dsw-alias-border-l2': 'line2',
      '--dsw-alias-border-l3': 'line3',
      '--dsw-alias-border-l4': 'line4',
      '--dsw-alias-border-l2-darkmode-thin': 'line1',
      '--dsw-alias-label-primary': 'ink',
      '--dsw-alias-label-primary-dimmed': 'ink',
      '--dsw-alias-label-primary-bluish': 'ink',
      '--dsw-alias-label-secondary': 'ink2',
      '--dsw-alias-label-tertiary': 'ink3',
      '--dsw-alias-label-caption': 'ink4',
      '--dsw-alias-label-primary-foreground': 'onBrand',
      '--dsw-alias-label-primary-inverted': 'paper',
      '--dsw-alias-label-document-preview': 'ink2',
      '--dsw-alias-label-deep-diving': 'accent',
      '--dsw-alias-menu-icon': 'ink2',
      '--dsw-alias-link': 'accent',
      '--dsw-alias-brand-primary': 'brand',
      '--dsw-alias-brand-text': 'brand',
      '--dsw-alias-brand-primary-invert': 'onBrand',
      '--dsw-alias-button-primary-fill': 'brand',
      '--dsw-alias-button-primary-hover': 'brandHover',
      '--dsw-alias-button-elevated-fill': 'surface',
      '--dsw-alias-button-floating-fill': 'surface',
      '--dsw-alias-button-floating-hover': 'surface2',
      '--dsw-alias-button-ghost-active-fill': 'surface2',
      '--dsw-alias-button-ghost-active-hover': 'surface3',
      '--dsw-alias-button-ghost-active-border': 'ink3',
      '--dsw-alias-button-contrast-fill': 'ink2',
      '--dsw-alias-button-info-fill': 'accent',
      '--dsw-alias-button-info-hover': 'accentStrong',
      '--dsw-alias-state-business-primary': 'accent',
      '--dsw-alias-state-business-tertiary': 'accentSoft',
      '--dsw-alias-state-error-primary': 'error',
      '--dsw-alias-state-warn-primary': 'warn',
      '--dsw-alias-state-success-primary': 'success',
      '--dsw-alias-interactive-bg-hover': 'hover',
      '--dsw-alias-interactive-bg-hover-solid': 'surface2',
      '--dsw-alias-markdown-code-block': 'code',
      '--dsw-alias-markdown-code-segment-selected': 'surface',
      '--dsw-alias-markdown-code-segment-unselected': 'code',
      '--dsw-alias-markdown-inline-code': 'inline',
      '--dsw-alias-markdown-citation': 'surface2',
      '--dsw-alias-markdown-placeholder': 'surface2',
      '--dsw-alias-markdown-tag': 'surface2',
      '--dsw-alias-turn-trigger-bg': 'code',
      '--dsw-alias-turn-trigger-bg-hover': 'hover',
      '--dsw-specific-bubble': 'bubble',
      '--dsw-specific-bubble-highlight': 'bubbleStrong',
      '--dsw-specific-input-major': 'input',
      '--dsw-specific-login-input': 'input',
      '--dsw-specific-selector': 'surface2',
      '--dsw-specific-tip': 'surface2',
      '--dsw-specific-sidebar-fill': 'sidebar',
      '--dsw-specific-sidebar-nav-item-active': 'sidebarActive',
      '--dsw-specific-sidebar-nav-item-active-accent': 'accentSoft',
      '--dsw-specific-sidebar-nav-item-hover': 'sidebarHover',
      '--dsw-alias-toast-bg': 'toastBg',
      '--dsw-alias-toast-label': 'toastFg',
      '--dsw-alias-switch-thumb': 'thumb',
      '--dsw-alias-brand-primary-new-colorprimary-new-color': 'accent',
    }

    /** Host token → composed value over palette variables. */
    const COMPUTED_TOKENS = {
      '--dsw-alias-bg-document-preview': mix('paper', 92, 'ink'),
      '--dsw-alias-bg-document-selection': mix('accent', 32),
      '--dsw-alias-bg-skeleton': mix('ink', 7),
      '--dsw-alias-border-inverted': mix('ink', 6),
      '--dsw-alias-border-inverted2': mix('ink', 8),
      '--dsw-alias-label-dimmed': mix('ink4', 72, 'surface'),
      '--dsw-alias-label-shimmer': mix('ink', 28),
      '--dsw-alias-label-deep-diving-shimmer': mix('accent', 45),
      '--dsw-alias-button-primary-dimmed': mix('brand', 14, 'surface'),
      '--dsw-alias-state-error-secondary': mix('error', 68, 'surface'),
      '--dsw-alias-state-warn-secondary': mix('warn', 66, 'surface'),
      '--dsw-alias-state-warn-tertiary': mix('warn', 16, 'surface'),
      '--dsw-alias-state-warn-label': mix('warn', 78, 'ink'),
      '--dsw-alias-state-success-secondary': mix('success', 66, 'surface'),
      '--dsw-alias-state-success-tertiary': mix('success', 16, 'surface'),
      '--dsw-alias-state-idle-primary': mix('ink', 20, 'surface'),
      '--dsw-alias-interactive-bg-active': mix('ink', 10),
      '--dsw-alias-interactive-bg-hover-accent': mix('accent', 16),
      '--dsw-alias-interactive-bg-hover-danger': mix('error', 12),
      '--dsw-alias-markdown-code-block-banner': mix('code', 94, 'ink'),
      '--dsw-alias-scrollbar-bg-l1': mix('ink', 20),
      '--dsw-alias-scrollbar-bg-l2': mix('ink', 20),
      '--dsw-alias-scrollbar-hover-l1': mix('ink', 34),
      '--dsw-alias-scrollbar-hover-l2': mix('ink', 34),
      '--dsw-menu-surface-fill': mix('menu', 84),
      '--dsw-specific-menu': mix('menu', 84),
      '--dsw-alias-menu-group-header-fill': mix('menu', 94),
      // thinking fades read the surface instead of the stock white/charcoal glow
      '--dsw-linear-gradient-think': 'linear-gradient(180deg, ' + V('paper') + ' 20.19%, transparent 100%)',
      '--dsw-linear-think-select': 'linear-gradient(180deg, ' + V('surface2') + ' 20.19%, transparent 100%)',
      // a user-chosen font in Settings still wins over the style's typeface
      '--dsw-font-family': 'var(--dsh-font-family-text, ' + V('fontText') + ')',
      '--ds-font-family-code': 'var(--dsh-font-family-code, ' + V('fontCode') + ')',
      '--dsw-font-family-brand': V('fontBrand'),
      '--dsw-radius-xs': V('radiusXs'),
      '--dsw-radius-sm': V('radiusSm'),
      '--dsw-radius-md': V('radiusMd'),
      '--dsw-radius-lg': V('radiusLg'),
      '--dsw-radius-xl': V('radiusXl'),
      '--dsw-radius-panel': V('radiusPanel'),
      '--dsw-shadow-lv1': V('shadow1'),
      '--dsw-shadow-lv2': V('shadow2'),
      '--dsw-shadow-lv3': V('shadow3'),
      '--dsw-menu-backdrop-filter': V('menuBackdrop'),
    }

    const TOKEN_FORMULAS = {
      ...Object.fromEntries(Object.entries(DIRECT_TOKENS).map(([token, key]) => [token, V(key)])),
      ...COMPUTED_TOKENS,
    }

    /** Each token carries the same expression for both schemes; the palette vars decide. */
    const TOKEN_LAYER = Object.fromEntries(
      Object.entries(TOKEN_FORMULAS).map(([token, value]) => [token, { light: value, dark: value }]),
    )

    // ── stylesheet ────────────────────────────────────────────────────────

    /** Render one set of palette values as a declaration block (no braces). */
    function declarations(values, vars) {
      const parts = []
      for (const [key, name] of Object.entries(vars)) {
        const value = values[key]
        if (typeof value === 'string' && value !== '') parts.push(name + ':' + value)
      }
      return parts.join(';')
    }

    /** Fail loudly on an incomplete style instead of silently corrupting the palette. */
    function assertPreset(preset) {
      const missing = []
      for (const key of COLOR_KEYS) {
        if (typeof preset.light[key] !== 'string' || typeof preset.dark[key] !== 'string') {
          missing.push('light/dark.' + key)
        }
      }
      for (const key of COMMON_KEYS) {
        if (typeof preset.common[key] !== 'string') missing.push('common.' + key)
      }
      if (preset.commonDark !== undefined) {
        for (const key of Object.keys(preset.commonDark)) {
          if (typeof preset.commonDark[key] !== 'string') missing.push('commonDark.' + key)
        }
      }
      if (missing.length > 0) {
        throw new Error('[style-studio] preset "' + preset.id + '" is incomplete: ' + missing.join(', '))
      }
    }

    /**
     * The frosted-glass backdrop: two fixed pseudo layers behind every column.
     * The first paints the image (or gradient) and blurs it; the second is the
     * scheme-aware haze that keeps text readable. The plugin stylesheet's
     * `background-blur`/`haze` variables come from the page's two sliders.
     */
    const GLASS_LAYER_CSS = `
body[${STYLE_ATTR}="glass"]::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:var(${IMAGE_VAR},var(--dss-glass-gradient));background-position:center;background-size:cover;background-repeat:no-repeat;filter:blur(var(${BLUR_VAR},18px)) saturate(1.06);transform:scale(1.06);transform-origin:center}
body[${STYLE_ATTR}="glass"]::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:rgb(247 250 254 / var(${HAZE_VAR},40%))}
body[${STYLE_ATTR}="glass"][data-ds-dark-theme]::before{filter:blur(var(${BLUR_VAR},18px)) saturate(1.02) brightness(.6)}
body[${STYLE_ATTR}="glass"][data-ds-dark-theme]::after{background:rgb(8 10 14 / var(${HAZE_VAR},40%))}
`

    /** Page chrome; every color is a host token so it follows the chosen style. */
    const PAGE_CSS = `
.sss-page{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6}
.sss-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.sss-content{max-width:920px;margin:0 auto;padding:0 clamp(20px,3.4vw,40px) 72px}
.sss-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px;padding:30px 0 20px}
[data-platform=darwin] .sss-head{padding-top:calc(30px + var(--dsh-frame-top-clearance,0px))}
.sss-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.sss-subtitle{max-width:64ch;margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.sss-card{padding:18px;margin-bottom:14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1)}
.sss-card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 14px;margin-bottom:14px}
.sss-card-title{margin:0;font-size:14px;font-weight:600;line-height:20px}
.sss-card-desc{max-width:62ch;margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.sss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
.sss-style{position:relative;display:flex;flex-direction:column;gap:10px;padding:9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s,transform .15s}
.sss-style:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4);transform:translateY(-1px)}
.sss-style.is-active{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.sss-style:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sss-thumb-wrap{position:relative;display:block;height:74px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm)}
.sss-thumb{position:absolute;inset:0;display:flex;padding:7px;background-size:cover;background-position:center}
.sss-thumb-dark{display:none}
body[data-ds-dark-theme] .sss-thumb-light{display:none}
body[data-ds-dark-theme] .sss-thumb-dark{display:flex}
.sss-thumb-win{position:relative;display:flex;flex:1;min-width:0;overflow:hidden;border:.5px solid;border-radius:var(--dsw-radius-xs)}
.sss-thumb-rail{flex:none;width:24%;border-right:.5px solid var(--dsw-alias-border-l1)}
.sss-thumb-main{display:flex;flex:1;flex-direction:column;justify-content:center;gap:4px;min-width:0;padding:8px 7px}
.sss-thumb-line{display:block;height:3px;border-radius:2px;opacity:.85}
.sss-thumb-pill{display:block;width:22px;height:6px;margin-top:2px;border-radius:3px}
.sss-style-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.sss-style-name{padding-right:18px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}
.sss-style-desc{display:-webkit-box;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.sss-style-check{position:absolute;top:12px;right:12px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}
.sss-button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .15s,border-color .15s,color .15s,opacity .15s}
.sss-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
.sss-button:disabled{opacity:.45;cursor:default}
.sss-button.is-danger:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l3));color:var(--dsw-alias-state-error-primary)}
.sss-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sss-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;font-weight:500;line-height:18px;cursor:pointer}
.sss-link:hover{text-decoration:underline}
.sss-link:disabled{opacity:.45;cursor:default;text-decoration:none}
.sss-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}
.sss-hintbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;margin:0 0 14px;padding:8px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sss-bg-art{position:relative;isolation:isolate;display:flex;align-items:flex-end;width:100%;height:172px;padding:0;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.sss-bg-art:hover{border-color:var(--dsw-alias-border-l4)}
.sss-bg-art.is-dragging{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.sss-bg-art:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sss-bg-art:disabled{opacity:.62;cursor:default}
.sss-bg-image{position:absolute;inset:-6%;z-index:-2;background-image:var(${IMAGE_VAR},var(--dss-glass-gradient));background-position:center;background-size:cover;filter:blur(var(${BLUR_VAR},18px)) saturate(1.04);transform:scale(1.04)}
.sss-bg-haze{position:absolute;inset:0;z-index:-1;background:rgb(247 250 254 / var(${HAZE_VAR},40%))}
body[data-ds-dark-theme] .sss-bg-haze{background:rgb(8 10 14 / var(${HAZE_VAR},40%))}
.sss-bg-hint{display:inline-flex;align-items:center;gap:6px;max-width:calc(100% - 24px);margin:12px;padding:6px 12px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 88%,transparent);color:var(--dsw-alias-label-secondary);box-shadow:var(--dsw-shadow-lv1);font-size:12px;line-height:18px;backdrop-filter:blur(12px)}
.sss-bg-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.sss-meta{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.sss-actions{display:flex;flex-wrap:wrap;gap:8px}
.sss-field{margin-top:16px}
.sss-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}
.sss-field-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.sss-field-value{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.sss-range{display:block;width:100%;height:20px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.sss-range:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:4px;border-radius:var(--dsw-radius-sm)}
.sss-gradients{display:flex;flex-wrap:wrap;gap:8px}
.sss-gradient{width:62px;height:38px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background-position:center;background-size:cover;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.sss-gradient:hover{border-color:var(--dsw-alias-border-l4)}
.sss-gradient.is-active{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}
.sss-gradient:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sss-note{margin:14px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.sss-status{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-height:18px;margin:12px 0 0;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px}
.sss-status.is-error{color:var(--dsw-alias-state-error-primary)}
@media (width<=760px){.sss-content{padding-bottom:48px}.sss-grid{grid-template-columns:repeat(auto-fill,minmax(152px,1fr))}.sss-bg-art{height:142px}}
@media (prefers-reduced-motion:reduce){.sss-style,.sss-button,.sss-bg-art,.sss-gradient{transition:none}.sss-style:hover{transform:none}}
`

    /** One rule pair per style (plus optional dark elevation) and gradient set, then the page chrome. */
    function buildStylesheet() {
      const rules = []
      for (const preset of PRESETS) {
        assertPreset(preset)
        const selector = 'body[' + STYLE_ATTR + '="' + preset.id + '"]'
        rules.push(selector + '{' + declarations(preset.common, COMMON_VARS) + ';' + declarations(preset.light, COLOR_VARS) + '}')
        rules.push(
          selector + '[data-ds-dark-theme]{' +
            declarations(preset.dark, COLOR_VARS) +
            (preset.commonDark === undefined ? '' : ';' + declarations(preset.commonDark, COMMON_VARS)) +
            '}',
        )
      }
      for (const gradient of GRADIENTS) {
        rules.push('body[' + BG_ATTR + '="' + gradient.id + '"]{--dss-glass-gradient:' + gradient.light + '}')
        rules.push('body[' + BG_ATTR + '="' + gradient.id + '"][data-ds-dark-theme]{--dss-glass-gradient:' + gradient.dark + '}')
      }
      rules.push(GLASS_LAYER_CSS)
      return rules.join('\n') + '\n' + PAGE_CSS
    }

    const STYLESHEET = buildStylesheet()

    // ── selection state ───────────────────────────────────────────────────

    /** The theme service, bound in `apply`. */
    let themeApi = null
    /** The active style id, or `null` for the stock appearance. */
    let activeStyleId = null
    /** Backdrop tuning: gradient id, blur radius, haze opacity. */
    let glassSettings = { ...DEFAULT_GLASS }
    /** Object URL of the stored wallpaper, when one is applied. */
    let wallpaperUrl = null
    /** The applied wallpaper record, kept so removal can be undone. */
    let wallpaperRecord = null
    /** Display metadata of the stored wallpaper, when one exists. */
    let wallpaperInfo = null
    /** A removal awaiting undo: `{ record, timer }`. */
    let pendingRemoval = null
    /** Debounce handle for slider persistence. */
    let persistTimer = null
    /** Disposer of the registered override layer. */
    let overrideDisposer = null
    /** Section instances observing the selection. */
    const subscribers = new Set()

    const isKnownStyle = (id) => typeof id === 'string' && PRESETS.some((preset) => preset.id === id)
    const isKnownGradient = (id) => typeof id === 'string' && GRADIENTS.some((gradient) => gradient.id === id)
    const toClamped = (value, min, max, fallback) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

    const snapshot = () => ({
      activeId: activeStyleId,
      glass: { ...glassSettings },
      wallpaper: wallpaperInfo === null ? null : { ...wallpaperInfo },
    })

    /** Read the persisted selection, ignoring unreadable or stale values. */
    function readStoredStyle() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return isKnownStyle(raw) ? raw : null
      } catch (_error) {
        return null
      }
    }

    /** Persist the selection; a blocked storage keeps the session usable. */
    function writeStoredStyle(id) {
      try {
        if (id === null) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, id)
      } catch (_error) {
        /* the style still applies for this session */
      }
    }

    /** Read the persisted backdrop tuning, falling back field by field. */
    function readStoredGlass() {
      try {
        const raw = window.localStorage.getItem(GLASS_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        return {
          gradient: isKnownGradient(parsed.gradient) ? parsed.gradient : DEFAULT_GLASS.gradient,
          blur: toClamped(parsed.blur, 0, 40, DEFAULT_GLASS.blur),
          haze: toClamped(parsed.haze, 0, 80, DEFAULT_GLASS.haze),
          density: toClamped(parsed.density, 60, 100, DEFAULT_GLASS.density),
        }
      } catch (_error) {
        return null
      }
    }

    /** Persist the backdrop tuning. */
    function writeStoredGlass() {
      try {
        window.localStorage.setItem(GLASS_KEY, JSON.stringify(glassSettings))
      } catch (_error) {
        /* the tuning still applies for this session */
      }
    }

    function notifySubscribers() {
      for (const subscriber of subscribers) subscriber()
    }

    /** Observe the active selection; returns the unsubscribe. */
    function subscribeActive(subscriber) {
      subscribers.add(subscriber)
      return () => {
        subscribers.delete(subscriber)
      }
    }

    /**
     * (Re)register the shared override layer. Re-registering the same source
     * replaces its layer and publishes one `theme/change`, so JavaScript theme
     * consumers and the theme-color metadata follow a style switch too.
     */
    function registerOverrides() {
      if (themeApi === null) return
      overrideDisposer = themeApi.overrideTokens(STYLE_SOURCE, TOKEN_LAYER)
    }

    /** Release the override layer, restoring the stock host tokens. */
    function releaseOverrides() {
      if (overrideDisposer === null) return
      const dispose = overrideDisposer
      overrideDisposer = null
      dispose()
    }

    /** Write the backdrop tuning to the body; the stylesheet turns it into layers. */
    function applyGlassVars() {
      if (typeof document === 'undefined' || document.body === null) return
      const body = document.body
      body.setAttribute(BG_ATTR, glassSettings.gradient)
      body.style.setProperty(BLUR_VAR, glassSettings.blur + 'px')
      body.style.setProperty(HAZE_VAR, glassSettings.haze + '%')
      body.style.setProperty(DENSITY_VAR, String(glassSettings.density / 100))
    }

    /** Remove every body-side trace of the backdrop. */
    function clearGlassVars() {
      if (typeof document === 'undefined' || document.body === null) return
      const body = document.body
      body.removeAttribute(BG_ATTR)
      body.style.removeProperty(BLUR_VAR)
      body.style.removeProperty(HAZE_VAR)
      body.style.removeProperty(DENSITY_VAR)
      body.style.removeProperty(IMAGE_VAR)
    }

    /**
     * Apply one style to the whole application.
     * @param id - a preset id, or `null` to restore the stock appearance.
     * @param persist - whether the choice is a user gesture to remember.
     */
    function applyStyle(id, persist = true) {
      const next = isKnownStyle(id) ? id : null
      activeStyleId = next
      if (typeof document !== 'undefined' && document.body !== null) {
        if (next === null) {
          document.body.removeAttribute(STYLE_ATTR)
          releaseOverrides()
        } else {
          document.body.setAttribute(STYLE_ATTR, next)
          registerOverrides()
        }
      } else if (next !== null) {
        registerOverrides()
      }
      if (persist) writeStoredStyle(next)
      notifySubscribers()
    }

    /** Persist the tuning shortly after the last slider tick. */
    function scheduleGlassPersist() {
      if (typeof window === 'undefined') return
      if (persistTimer !== null) window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(() => {
        persistTimer = null
        writeStoredGlass()
      }, 300)
    }

    /** Merge backdrop tuning, apply it, and tell the page. */
    function updateGlass(patch) {
      glassSettings = { ...glassSettings, ...patch }
      applyGlassVars()
      scheduleGlassPersist()
      notifySubscribers()
    }

    // ── wallpaper storage ────────────────────────────────────────────────

    /**
     * Open (and on first use create) the wallpaper database. A browser that
     * blocks IndexedDB rejects here and the page keeps working in memory.
     */
    function openWallpaperDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('indexedDB unavailable'))
          return
        }
        let request
        try {
          request = indexedDB.open(DB_NAME, DB_VERSION)
        } catch (error) {
          reject(error)
          return
        }
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
        request.onblocked = () => reject(new Error('indexedDB blocked'))
      })
    }

    /** Run one transaction against the wallpaper store and close the database. */
    async function runWallpaperStore(mode, action) {
      const db = await openWallpaperDb()
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction(DB_STORE, mode)
          const request = action(transaction.objectStore(DB_STORE))
          let result
          if (request !== undefined) {
            request.onsuccess = () => {
              result = request.result
            }
            request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
          }
          transaction.oncomplete = () => resolve(result)
          transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB transaction failed'))
          transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB transaction aborted'))
        })
      } finally {
        db.close()
      }
    }

    /** Read the stored wallpaper record, or `null`. */
    async function readWallpaperRecord() {
      const record = await runWallpaperStore('readonly', (store) => store.get(DB_KEY))
      if (record === null || typeof record !== 'object' || !(record.blob instanceof Blob)) return null
      return record
    }

    /** Store one wallpaper record. */
    async function writeWallpaperRecord(record) {
      await runWallpaperStore('readwrite', (store) => store.put(record, DB_KEY))
    }

    /** Delete the stored wallpaper record. */
    async function removeWallpaperRecord() {
      await runWallpaperStore('readwrite', (store) => store.delete(DB_KEY))
    }

    /** Release the current object URL, if any. */
    function releaseWallpaperUrl() {
      if (wallpaperUrl === null) return
      const url = wallpaperUrl
      wallpaperUrl = null
      try {
        URL.revokeObjectURL(url)
      } catch (_error) {
        /* an already-revoked URL is harmless */
      }
    }

    /** Paint the current record's object URL, or clear the variable when there is none. */
    function renderWallpaper() {
      if (typeof document !== 'undefined' && document.body !== null) {
        document.body.style.removeProperty(IMAGE_VAR)
      }
      releaseWallpaperUrl()
      wallpaperInfo = null
      if (wallpaperRecord === null) return
      try {
        wallpaperUrl = URL.createObjectURL(wallpaperRecord.blob)
      } catch (_error) {
        wallpaperUrl = null
        return
      }
      if (typeof document !== 'undefined' && document.body !== null) {
        document.body.style.setProperty(IMAGE_VAR, 'url("' + wallpaperUrl + '")')
      }
      wallpaperInfo = {
        name: typeof wallpaperRecord.name === 'string' ? wallpaperRecord.name : '',
        size: typeof wallpaperRecord.size === 'number' ? wallpaperRecord.size : 0,
        width: typeof wallpaperRecord.width === 'number' ? wallpaperRecord.width : 0,
        height: typeof wallpaperRecord.height === 'number' ? wallpaperRecord.height : 0,
      }
    }

    /** Point the stylesheet at one record and tell the page. */
    function useWallpaperRecord(record) {
      wallpaperRecord = record
      renderWallpaper()
      notifySubscribers()
    }

    /** Drop the current wallpaper image from the document. */
    function clearWallpaperImage() {
      wallpaperRecord = null
      renderWallpaper()
    }

    /** Delete the stored record; a blocked store leaves the page usable. */
    async function deleteStoredWallpaper() {
      try {
        await removeWallpaperRecord()
      } catch (_error) {
        /* nothing stored, or IndexedDB is blocked */
      }
    }

    /** Commit a pending removal now (used when replacing the image or disposing). */
    function flushPendingRemoval() {
      const entry = pendingRemoval
      if (entry === null) return
      pendingRemoval = null
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      void deleteStoredWallpaper()
    }

    /** Restore the record a removal is still holding for undo. */
    function undoRemoveWallpaper() {
      const entry = pendingRemoval
      if (entry === null) return false
      pendingRemoval = null
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      useWallpaperRecord(entry.record)
      return true
    }

    /** Restore the saved wallpaper on load; a missing or corrupt record is ignored. */
    async function loadWallpaper() {
      try {
        const record = await readWallpaperRecord()
        if (record !== null) useWallpaperRecord(record)
      } catch (_error) {
        /* no stored wallpaper, or IndexedDB is blocked */
      }
    }

    /** Read an image's pixel dimensions without keeping it in memory. */
    function measureImage(blob) {
      return new Promise((resolve) => {
        let url
        let timer
        const finish = (size) => {
          if (timer !== undefined) window.clearTimeout(timer)
          try {
            URL.revokeObjectURL(url)
          } catch (_error) {
            /* already revoked */
          }
          resolve(size)
        }
        try {
          url = URL.createObjectURL(blob)
        } catch (_error) {
          resolve(null)
          return
        }
        const image = new Image()
        image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => finish(null)
        timer = window.setTimeout(() => finish(null), 8000)
        image.src = url
      })
    }

    /**
     * Apply one picked image and remember it when storage allows.
     * @returns a status the page localizes: `{ ok, stored?, switched?, messageKey? }`.
     */
    async function setWallpaperFile(file) {
      if (!(file instanceof Blob) || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
        return { ok: false, messageKey: 'notImage' }
      }
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, messageKey: 'tooLarge' }
      const size = await measureImage(file)
      if (size === null) return { ok: false, messageKey: 'readFailed' }
      const record = {
        blob: file,
        name: typeof file.name === 'string' ? file.name : '',
        size: file.size,
        width: size.width,
        height: size.height,
        addedAt: Date.now(),
      }
      flushPendingRemoval()
      useWallpaperRecord(record)
      const switched = activeStyleId !== 'glass'
      if (switched) applyStyle('glass')
      let stored = true
      try {
        await writeWallpaperRecord(record)
      } catch (_error) {
        stored = false
      }
      return { ok: true, stored, switched }
    }

    /**
     * Drop the wallpaper image and hold the stored record briefly so the page
     * can offer an undo; once the window passes it is deleted for good.
     */
    async function removeWallpaperImage() {
      const record = wallpaperRecord
      flushPendingRemoval()
      clearWallpaperImage()
      notifySubscribers()
      if (record === null) {
        await deleteStoredWallpaper()
        return { undo: null }
      }
      const entry = { record, timer: null }
      entry.timer = window.setTimeout(() => {
        if (pendingRemoval === entry) pendingRemoval = null
        void deleteStoredWallpaper()
      }, UNDO_MS)
      pendingRemoval = entry
      return { undo: undoRemoveWallpaper }
    }

    /** Restore the default gradient, blur, and haze, and drop the image for good. */
    async function resetBackdrop() {
      flushPendingRemoval()
      glassSettings = { ...DEFAULT_GLASS }
      applyGlassVars()
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
        persistTimer = null
      }
      writeStoredGlass()
      const hadImage = wallpaperRecord !== null
      clearWallpaperImage()
      notifySubscribers()
      if (hadImage) await deleteStoredWallpaper()
    }

    // ── small helpers ─────────────────────────────────────────────────────

    /** Human-readable byte size. */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      const rounded = index === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1)
      return rounded + ' ' + units[index]
    }

    /** `1920 × 1080`, or an empty string when unknown. */
    function formatDimensions(info) {
      if (info === null || !info.width || !info.height) return ''
      return info.width + ' × ' + info.height
    }

    // ── icons ─────────────────────────────────────────────────────────────

    function svg(children, size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', flex: 'none' },
        },
        children,
      )
    }

    const STROKE = { stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' }

    /** The palette glyph the sidebar renders at 16px (18px when collapsed). */
    function StyleStudioIcon({ size = 16 }) {
      return svg(
        [
          h('path', {
            key: 'palette',
            d: 'M8 2.3c3.2 0 5.7 2.3 5.7 5.1 0 1.9-1.4 2.9-2.9 2.9h-1c-.8 0-1.4.6-1.4 1.3 0 .8.6 1.3.6 2.1 0 .8-.7 1.4-1.6 1.4-3.1 0-5.7-2.9-5.7-6.2C1.7 5 4.4 2.3 8 2.3Z',
            ...STROKE,
          }),
          h('circle', { key: 'a', cx: 5.7, cy: 7.4, r: 0.95, fill: 'currentColor' }),
          h('circle', { key: 'b', cx: 8.4, cy: 5.6, r: 0.95, fill: 'currentColor' }),
          h('circle', { key: 'c', cx: 11, cy: 7.6, r: 0.95, fill: 'currentColor' }),
        ],
        size,
      )
    }

    function CheckGlyph({ size = 14 }) {
      return svg([h('path', { key: 'p', d: 'M3 8.4l3.1 3.1L13 4.9', ...STROKE })], size)
    }

    function ImageGlyph({ size = 14 }) {
      return svg(
        [
          h('rect', { key: 'r', x: 2.3, y: 3.3, width: 11.4, height: 9.4, rx: 2, ...STROKE }),
          h('path', { key: 'm', d: 'M2.6 10.9l2.9-2.7 2.6 2.4 2.1-2 3.2 2.9', ...STROKE }),
          h('circle', { key: 'd', cx: 10.4, cy: 6.2, r: 0.9, fill: 'currentColor' }),
        ],
        size,
      )
    }

    // ── views ─────────────────────────────────────────────────────────────

    /** One style option: a split light/dark mini window, its name, and a short note. */
    function StyleCard({ preset, active, t, onPick }) {
      const thumb = (scheme) => {
        const palette = scheme === 'dark' ? preset.dark : preset.light
        return h(
          'span',
          {
            className: 'sss-thumb sss-thumb-' + scheme,
            style: {
              backgroundColor: palette.paper,
              backgroundImage: preset.id === 'glass' ? 'var(--dss-glass-image, var(--dss-glass-gradient))' : 'none',
            },
          },
          h(
            'span',
            { className: 'sss-thumb-win', style: { background: palette.surface, borderColor: palette.line2 } },
            h('span', { className: 'sss-thumb-rail', style: { background: palette.sidebar } }),
            h(
              'span',
              { className: 'sss-thumb-main' },
              h('span', { className: 'sss-thumb-line', style: { background: palette.ink, width: '46%' } }),
              h('span', { className: 'sss-thumb-line', style: { background: palette.ink3, width: '68%', opacity: 0.7 } }),
              h('span', { className: 'sss-thumb-pill', style: { background: palette.accent } }),
            ),
          ),
        )
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'sss-style' + (active ? ' is-active' : ''),
          'aria-pressed': active,
          title: t(preset.descKey),
          onClick: () => onPick(preset.id),
        },
        h('span', { className: 'sss-thumb-wrap', 'aria-hidden': 'true' }, thumb('light'), thumb('dark')),
        h(
          'span',
          { className: 'sss-style-text' },
          h('span', { className: 'sss-style-name' }, t(preset.nameKey)),
          h('span', { className: 'sss-style-desc' }, t(preset.descKey)),
        ),
        active ? h('span', { className: 'sss-style-check', 'aria-hidden': 'true' }, h(CheckGlyph, { size: 12 })) : null,
      )
    }

    /** One labelled range input with its current value. */
    function RangeField({ id, label, value, min, max, step, suffix, onChange }) {
      return h(
        'div',
        { className: 'sss-field' },
        h(
          'div',
          { className: 'sss-field-head' },
          h('label', { className: 'sss-field-label', htmlFor: id }, label),
          h('output', { className: 'sss-field-value', htmlFor: id }, value + suffix),
        ),
        h('input', {
          id,
          className: 'sss-range',
          type: 'range',
          min,
          max,
          step,
          value,
          'aria-label': label,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
      )
    }

    /**
     * The backdrop card: drop target, gradient fallback, blur and haze sliders.
     * It renders even for other styles so the choice can be prepared first.
     */
    function BackdropSection({ t, state, busy, status, onPickFile, onRemoveImage, onGradient, onBlur, onHaze, onDensity, onReset, onUseGlass }) {
      const inputRef = useRef(null)
      const [dragging, setDragging] = useState(false)
      const wallpaper = state.wallpaper
      const glassActive = state.activeId === 'glass'

      const metaParts = []
      if (wallpaper !== null) {
        if (wallpaper.name !== '') metaParts.push(wallpaper.name)
        const dimensions = formatDimensions(wallpaper)
        if (dimensions !== '') metaParts.push(dimensions)
        const bytes = formatBytes(wallpaper.size)
        if (bytes !== '') metaParts.push(bytes)
      }
      const hint = busy ? t('processing') : dragging ? t('dropActive') : wallpaper === null ? t('dropHint') : t('replaceHint')

      const openPicker = () => {
        if (busy) return
        if (inputRef.current !== null) inputRef.current.click()
      }

      return h(
        'section',
        {
          className: 'sss-card',
          'aria-labelledby': 'sss-backdrop-title',
          'aria-busy': busy ? 'true' : undefined,
        },
        h(
          'div',
          { className: 'sss-card-head' },
          h(
            'div',
            null,
            h('h2', { className: 'sss-card-title', id: 'sss-backdrop-title' }, t('sectionBackdrop')),
            h('p', { className: 'sss-card-desc' }, t('sectionBackdropDesc')),
          ),
          h('button', { type: 'button', className: 'sss-link', disabled: busy, onClick: onReset }, t('resetBackdrop')),
        ),
        glassActive
          ? null
          : h(
              'div',
              { className: 'sss-hintbar' },
              h('span', null, t('glassOnlyHint')),
              h('button', { type: 'button', className: 'sss-link', onClick: onUseGlass }, t('useGlass')),
            ),
        h(
          'button',
          {
            type: 'button',
            className: 'sss-bg-art' + (dragging ? ' is-dragging' : ''),
            'aria-label': wallpaper === null ? t('dropHint') : t('replaceHint'),
            disabled: busy,
            onClick: openPicker,
            onDragOver: (event) => {
              event.preventDefault()
              if (!busy && !dragging) setDragging(true)
            },
            onDragLeave: (event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return
              setDragging(false)
            },
            onDrop: (event) => {
              event.preventDefault()
              setDragging(false)
              if (busy) return
              const dropped = event.dataTransfer === null ? null : event.dataTransfer.files[0]
              if (dropped !== undefined && dropped !== null) onPickFile(dropped)
            },
          },
          h('span', { className: 'sss-bg-image', 'aria-hidden': 'true' }),
          h('span', { className: 'sss-bg-haze', 'aria-hidden': 'true' }),
          h('span', { className: 'sss-bg-hint' }, h(ImageGlyph, { size: 15 }), h('span', null, hint)),
        ),
        h(
          'input',
          {
            ref: inputRef,
            type: 'file',
            accept: 'image/*',
            tabIndex: -1,
            'aria-hidden': 'true',
            disabled: busy,
            style: { display: 'none' },
            onChange: (event) => {
              const chosen = event.target.files === null ? null : event.target.files[0]
              event.target.value = ''
              if (chosen !== undefined && chosen !== null) onPickFile(chosen)
            },
          },
        ),
        h(
          'div',
          { className: 'sss-bg-toolbar' },
          h('span', { className: 'sss-meta' }, metaParts.length === 0 ? t('noImage') : metaParts.join(' · ')),
          h(
            'div',
            { className: 'sss-actions' },
            h(
              'button',
              { type: 'button', className: 'sss-button', disabled: busy, onClick: openPicker },
              h(ImageGlyph, { size: 13 }),
              h('span', null, wallpaper === null ? t('chooseImage') : t('replaceImage')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sss-button is-danger',
                disabled: busy || wallpaper === null,
                onClick: onRemoveImage,
              },
              t('removeImage'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'sss-field' },
          h(
            'div',
            { className: 'sss-field-head' },
            h('span', { className: 'sss-field-label' }, t('gradientsLabel')),
            h('span', { className: 'sss-field-value' }, wallpaper === null ? t('gradientsHint') : t('gradientsInactiveHint')),
          ),
          h(
            'div',
            { className: 'sss-gradients', role: 'group', 'aria-label': t('gradientsLabel') },
            GRADIENTS.map((gradient) =>
              h('button', {
                key: gradient.id,
                type: 'button',
                className: 'sss-gradient' + (gradient.id === state.glass.gradient ? ' is-active' : ''),
                style: { backgroundImage: gradient.light },
                'aria-pressed': gradient.id === state.glass.gradient,
                'aria-label': t(gradient.nameKey),
                title: t(gradient.nameKey),
                onClick: () => onGradient(gradient.id),
              }),
            ),
          ),
        ),
        h(RangeField, {
          id: 'sss-blur',
          label: t('blurLabel'),
          value: state.glass.blur,
          min: 0,
          max: 40,
          step: 1,
          suffix: 'px',
          onChange: onBlur,
        }),
        h(RangeField, {
          id: 'sss-haze',
          label: t('hazeLabel'),
          value: state.glass.haze,
          min: 0,
          max: 80,
          step: 2,
          suffix: '%',
          onChange: onHaze,
        }),
        h(RangeField, {
          id: 'sss-density',
          label: t('densityLabel'),
          value: state.glass.density,
          min: 60,
          max: 100,
          step: 5,
          suffix: '%',
          onChange: onDensity,
        }),
        h('p', { className: 'sss-note' }, t('privacy')),
        status === null
          ? h('p', { className: 'sss-status', 'aria-live': 'polite' })
          : h(
              'p',
              { className: 'sss-status' + (status.error ? ' is-error' : ''), role: 'status', 'aria-live': 'polite' },
              h('span', null, status.text),
              status.action === undefined
                ? null
                : h('button', { type: 'button', className: 'sss-link', onClick: status.action.run }, status.action.label),
            ),
      )
    }

    /** The Style Studio page: theme grid, backdrop card, and the shared status line. */
    function StyleStudioPage({ t }) {
      const [state, setState] = useState(snapshot)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)

      useEffect(() => subscribeActive(() => setState(snapshot())), [])

      useEffect(() => {
        if (status === null) return undefined
        const delay = status.action === undefined ? STATUS_MS : UNDO_MS
        const timer = window.setTimeout(() => setStatus(null), delay)
        return () => window.clearTimeout(timer)
      }, [status])

      const pickFile = async (file) => {
        if (busy) return
        setBusy(true)
        setStatus({ text: t('processing'), error: false })
        try {
          const result = await setWallpaperFile(file)
          if (!result.ok) {
            setStatus({ text: t(result.messageKey), error: true })
            return
          }
          const key = result.stored ? (result.switched ? 'appliedSwitched' : 'applied') : 'appliedUnstored'
          setStatus({ text: t(key), error: false })
        } catch (_error) {
          setStatus({ text: t('readFailed'), error: true })
        } finally {
          setBusy(false)
        }
      }

      const removeImage = async () => {
        if (busy) return
        setBusy(true)
        try {
          const result = await removeWallpaperImage()
          if (result.undo === null) {
            setStatus({ text: t('imageRemoved'), error: false })
            return
          }
          setStatus({
            text: t('imageRemoved'),
            error: false,
            action: {
              label: t('undo'),
              run: () => {
                if (result.undo()) setStatus({ text: t('undoDone'), error: false })
              },
            },
          })
        } finally {
          setBusy(false)
        }
      }

      const resetBackground = async () => {
        if (busy) return
        setBusy(true)
        try {
          await resetBackdrop()
          setStatus({ text: t('resetDone'), error: false })
        } finally {
          setBusy(false)
        }
      }

      return h(
        'section',
        { className: 'sss-page' },
        h(
          'div',
          { className: 'sss-scroll' },
          h(
            'div',
            { className: 'sss-content' },
            h(
              'header',
              { className: 'sss-head' },
              h(
                'div',
                null,
                h('h1', { className: 'sss-title' }, t('title')),
                h('p', { className: 'sss-subtitle' }, t('subtitle')),
              ),
            ),
            h(
              'section',
              { className: 'sss-card', 'aria-labelledby': 'sss-theme-title' },
              h(
                'div',
                { className: 'sss-card-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'sss-card-title', id: 'sss-theme-title' }, t('sectionTheme')),
                  h('p', { className: 'sss-card-desc' }, t('sectionThemeDesc')),
                ),
                h(
                  'button',
                  { type: 'button', className: 'sss-button', disabled: state.activeId === null, onClick: () => applyStyle(null) },
                  t('reset'),
                ),
              ),
              h(
                'div',
                { className: 'sss-grid', role: 'group', 'aria-label': t('sectionTheme') },
                PRESETS.map((preset) =>
                  h(StyleCard, {
                    key: preset.id,
                    preset,
                    t,
                    active: preset.id === state.activeId,
                    onPick: (id) => applyStyle(id),
                  }),
                ),
              ),
            ),
            h(BackdropSection, {
              t,
              state,
              busy,
              status,
              onPickFile: (file) => {
                void pickFile(file)
              },
              onRemoveImage: () => {
                void removeImage()
              },
              onGradient: (id) => updateGlass({ gradient: id }),
              onBlur: (value) => updateGlass({ blur: value }),
              onHaze: (value) => updateGlass({ haze: value }),
              onDensity: (value) => updateGlass({ density: value }),
              onReset: () => {
                void resetBackground()
              },
              onUseGlass: () => applyStyle('glass'),
            }),
          ),
        ),
      )
    }

    // ── plugin ────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale', 'theme']

    /**
     * Contribute the sidebar entry, its page, the palette stylesheet, and the
     * theme-token layer; restore the saved selection and backdrop.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'style-studio: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'style-studio'
        style.textContent = STYLESHEET
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'style-studio: palette stylesheet')

      themeApi = ctx.theme

      const storedGlass = readStoredGlass()
      if (storedGlass !== null) glassSettings = storedGlass
      applyGlassVars()

      ctx.effect(
        () => () => {
          releaseOverrides()
          themeApi = null
          flushPendingRemoval()
          if (persistTimer !== null) {
            window.clearTimeout(persistTimer)
            persistTimer = null
            writeStoredGlass()
          }
          clearWallpaperImage()
          clearGlassVars()
          if (typeof document !== 'undefined' && document.body !== null) {
            document.body.removeAttribute(STYLE_ATTR)
          }
        },
        'style-studio: body state',
      )

      const stored = readStoredStyle()
      if (stored !== null) applyStyle(stored, false)
      void loadWallpaper()

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, locale: NS, label: () => t('panel') }, StyleStudioIcon),
      )

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, StyleStudioPage))
    }

    return { inject, apply }
  },
})
