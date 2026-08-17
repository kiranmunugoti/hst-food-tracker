// Single source of truth for the app's name.
//
// It previously appeared in five places with four different values: the browser
// tab said "Food Safety Monitor", the PWA manifest said "Hazard Substance
// Tracker", the Capacitor config said "HST Food Safety", the header said
// "Safety Monitor", and the iOS home-screen title said "HST". Renaming meant
// finding all of them, which is why they drifted apart.
//
// Change the values here. The Vite plugin in vite.config.js injects them into
// index.html and rewrites the manifest at build time, so the tab title, the
// install prompt and the home-screen icon all follow automatically.
//
// The one exception is capacitor.config.json — native app stores read that at
// package time, not build time, so it must be edited by hand if you ship a
// native build.
export const APP_NAME  = "HST — Ingredient Tracker";  // full name: tab title, PWA install prompt
export const APP_SHORT = "HST";                      // home-screen icon label (keep under ~12 chars)
export const APP_TITLE_LEAD = "Ingredient";           // header, first word
export const APP_TITLE_ACCENT = "Tracker";            // header, coloured word
export const APP_DESCRIPTION =
  "Scan food and cosmetic products for hazardous additives, contaminants and undeclared substances.";
