'use strict';
// Lantern themes. One colour choice tints the browser frame, buttons, links, highlights and the
// ambient glow. Each theme has a light and a dark variant so contrast holds in both modes.
(() => {
  const PRESETS = {
    ember:    { name: 'Ember',    light: ['#d9650a', '#ff5f2e', '#ffc062', '#ff7a45'], dark: ['#ffa53a', '#ff7a45', '#ffc062', '#ff7a45'] },
    ocean:    { name: 'Ocean',    light: ['#2563eb', '#0891b2', '#93c5fd', '#60a5fa'], dark: ['#7aa7ff', '#38bdf8', '#93c5fd', '#3b82f6'] },
    forest:   { name: 'Forest',   light: ['#15803d', '#65a30d', '#86efac', '#4ade80'], dark: ['#4ade80', '#a3e635', '#86efac', '#22c55e'] },
    grape:    { name: 'Grape',    light: ['#7c3aed', '#db2777', '#c4b5fd', '#a78bfa'], dark: ['#b49cff', '#f472b6', '#c4b5fd', '#8b5cf6'] },
    rose:     { name: 'Rose',     light: ['#db2777', '#f43f5e', '#fbcfe8', '#fb7185'], dark: ['#ff7eb6', '#fb7185', '#fbcfe8', '#f43f5e'] },
    teal:     { name: 'Teal',     light: ['#0f766e', '#0891b2', '#99f6e4', '#2dd4bf'], dark: ['#2dd4bf', '#22d3ee', '#99f6e4', '#14b8a6'] },
    graphite: { name: 'Graphite', light: ['#374151', '#6b7280', '#d1d5db', '#9ca3af'], dark: ['#cbd5e1', '#94a3b8', '#e2e8f0', '#64748b'] },
    gold:     { name: 'Gold',     light: ['#b45309', '#d97706', '#fde68a', '#fbbf24'], dark: ['#fbbf24', '#f59e0b', '#fde68a', '#d97706'] },
  };
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let current = 'ember';
  let custom = null; // { light: {...}, dark: {...} } worked out by Lantern's Rust core

  function apply(key, palette) {
    if (palette && palette.light && palette.dark) custom = palette;
    current = PRESETS[key] || (key === 'custom' && custom) ? key : 'ember';
    const root = document.documentElement.style;
    const props = ['--accent', '--accent-2', '--glow-a', '--glow-b', '--accent-soft', '--link'];
    if (current === 'ember') { props.forEach((p) => root.removeProperty(p)); return; } // stylesheet defaults
    const v = current === 'custom' ? custom[dark.matches ? 'dark' : 'light'] : null;
    const [accent, accent2, glowA, glowB] = v ? [v.accent, v.accent2, v.glowA, v.glowB] : PRESETS[current][dark.matches ? 'dark' : 'light'];
    root.setProperty('--accent', accent);
    root.setProperty('--accent-2', accent2);
    root.setProperty('--glow-a', glowA);
    root.setProperty('--glow-b', glowB);
    root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} ${dark.matches ? 16 : 11}%, transparent)`);
    root.setProperty('--link', accent);
  }
  dark.addEventListener('change', () => apply(current));

  const swatch = (key) => (key === 'custom' ? (custom ? custom.light.accent : '#3b82f6') : (PRESETS[key] || PRESETS.ember).light[0]);
  window.LanternTheme = { PRESETS, apply, swatch, palette: () => custom };
  if (window.lantern && window.lantern.info) window.lantern.info().then((i) => apply(i.settings.themeColor, i.palette)).catch(() => {});
})();
