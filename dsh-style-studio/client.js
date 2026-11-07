/**
 * Style Studio — the browser half of `@local/dsh-style-studio`.
 *
 * Adds a General-settings row (`settings.general.item`, id `visual-style`) that
 * switches one of five application-wide styles. It sits beside the Appearance
 * row, so the Settings navigation gains no extra entry (the shell owns nav icons
 * and would reuse the General gear for a third-party section). Reskinning rides
 * the supported theme seam: one `ctx.theme.overrideTokens` layer maps host tokens onto the
 * `--dsh-style-*` palette variables, which a plugin stylesheet declares per
 * `body[data-dsh-style="<id>"]` (light), `[data-ds-dark-theme]` (dark), and an
 * optional per-style dark elevation block. Switching writes that attribute and
 * re-registers the layer (one `theme/change`), so light/dark appearance keeps
 * working and disabling the plugin restores the stock look.
 *
 * @module @local/dsh-style-studio/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-style-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'styleStudio'
    /** General-settings row id. */
    const STYLE_ROW_ID = 'visual-style'
    /** Override-layer identity; one layer per source. */
    const STYLE_SOURCE = '@local/dsh-style-studio'
    /** Body attribute selecting the active palette variables. */
    const STYLE_ATTR = 'data-dsh-style'
    /** Browser-local selection key. */
    const STORAGE_KEY = 'dsh.style-studio.v1'

    // ── copy ──────────────────────────────────────────────────────────────

    const zh = {
      title: '视觉风格',
      description: '为整个 DeepSeek Harness 换一张皮，点选立即生效；浅色 / 深色外观仍由上方「外观」控制，风格会自动适配。',
      reset: '恢复默认',
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
    }

    const en = {
      title: 'Visual styles',
      description: 'Reskin the whole DeepSeek Harness; pick one to apply instantly. Light and dark stay with Appearance above — every style adapts to both.',
      reset: 'Reset to default',
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

    // ── the five styles ───────────────────────────────────────────────────

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
     * Style specs: original palettes for both schemes plus the mode-independent
     * language. A style may add `commonDark` for elevation that only fits the
     * dark scheme. Declarations are validated at load.
     */
    const PRESET_SPECS = [
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

    /** Row chrome; every color is a host token so it follows the chosen style. */
    const ROW_CSS = `
.sss-row{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.sss-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.sss-row-text{min-width:0}
.sss-row-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.sss-row-desc{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sss-reset{flex:none;padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:opacity .15s}
.sss-reset:hover:not(:disabled){text-decoration:underline}
.sss-reset:disabled{opacity:.45;cursor:default;text-decoration:none}
.sss-options{display:flex;flex-wrap:wrap;gap:8px}
.sss-chip{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
.sss-chip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
.sss-chip.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.sss-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sss-chip-swatch{position:relative;display:flex;flex:none;width:34px;height:22px;border-radius:5px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l4)}
.sss-chip-half{width:50%;height:100%}
.sss-chip-accent{position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-2)}
.sss-chip-name{white-space:nowrap}
@media (prefers-reduced-motion:reduce){.sss-chip,.sss-reset{transition:none}}
`

    /** One rule pair per style (plus optional dark elevation) followed by panel chrome. */
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
      return rules.join('\n') + '\n' + ROW_CSS
    }

    const STYLESHEET = buildStylesheet()

    // ── selection state ───────────────────────────────────────────────────

    /** The theme service, bound in `apply`. */
    let themeApi = null
    /** The active style id, or `null` for the stock appearance. */
    let activeStyleId = null
    /** Disposer of the registered override layer. */
    let overrideDisposer = null
    /** Section instances observing the selection. */
    const subscribers = new Set()

    const isKnownStyle = (id) => typeof id === 'string' && PRESETS.some((preset) => preset.id === id)
    const getActiveStyleId = () => activeStyleId

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

    // ── views ─────────────────────────────────────────────────────────────

    /** One style option: a light/dark half swatch plus the localized name. */
    function StyleChip(props) {
      const { preset, active, t, onPick } = props
      return h(
        'button',
        {
          type: 'button',
          className: 'sss-chip' + (active ? ' is-active' : ''),
          'aria-pressed': active,
          title: t(preset.descKey),
          onClick: () => onPick(preset.id),
        },
        h(
          'span',
          { className: 'sss-chip-swatch', 'aria-hidden': 'true' },
          h('span', { className: 'sss-chip-half', style: { background: preset.light.paper } }),
          h('span', { className: 'sss-chip-half', style: { background: preset.dark.paper } }),
          h('span', { className: 'sss-chip-accent', style: { background: preset.light.accent } }),
        ),
        h('span', { className: 'sss-chip-name' }, t(preset.nameKey)),
      )
    }

    /** The General-settings row: title, reset link, and the five style options. */
    function StyleStudioRow(props) {
      const t = props.t
      const [activeId, setActiveId] = useState(getActiveStyleId)
      useEffect(() => subscribeActive(() => setActiveId(getActiveStyleId())), [])
      return h(
        'div',
        { className: 'sss-row', 'data-style-studio': 'true' },
        h(
          'div',
          { className: 'sss-row-head' },
          h(
            'div',
            { className: 'sss-row-text' },
            h('div', { className: 'sss-row-title' }, t('title')),
            h('p', { className: 'sss-row-desc' }, t('description')),
          ),
          h(
            'button',
            { type: 'button', className: 'sss-reset', disabled: activeId === null, onClick: () => applyStyle(null) },
            t('reset'),
          ),
        ),
        h(
          'div',
          { className: 'sss-options', role: 'group', 'aria-label': t('title') },
          PRESETS.map((preset) =>
            h(StyleChip, { key: preset.id, preset, t, active: preset.id === activeId, onPick: applyStyle }),
          ),
        ),
      )
    }

    // ── plugin ────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale', 'theme']

    /**
     * Contribute the Settings section, the palette stylesheet, and the theme-token
     * layer, and restore the saved selection.
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

      ctx.effect(
        () => () => {
          releaseOverrides()
          themeApi = null
          if (typeof document !== 'undefined' && document.body !== null) {
            document.body.removeAttribute(STYLE_ATTR)
          }
        },
        'style-studio: token layer',
      )

      const stored = readStoredStyle()
      if (stored !== null) applyStyle(stored, false)

      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          { name: 'settings.general.item', id: STYLE_ROW_ID, order: 12, locale: NS, label: () => t('title') },
          StyleStudioRow,
        ),
      )
    }

    return { inject, apply }
  },
})
