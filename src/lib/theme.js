import { DOMAIN } from "./config.js";

// Small building blocks used everywhere: score/tier colour tables, number
// formatting, and the light/dark theme object.
// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const RISK_CFG = {
  high:   { fg:"#c0392b", bg:"rgba(192,57,43,0.08)",   border:"rgba(192,57,43,0.18)"   },
  medium: { fg:"#b07d2b", bg:"rgba(176,125,43,0.08)",  border:"rgba(176,125,43,0.18)"  },
  low:    { fg:"#2e7d52", bg:"rgba(46,125,82,0.08)",   border:"rgba(46,125,82,0.18)"   },
  none:   { fg:"#3d6b99", bg:"rgba(61,107,153,0.08)",  border:"rgba(61,107,153,0.18)"  },
};
const DIET_CFG = {
  vegan:       { label:"Vegan",       icon:"🌱", fg:"#2d7a45", bg:"rgba(45,122,69,0.09)",  border:"rgba(45,122,69,0.22)"  },
  vegetarian:  { label:"Vegetarian",  icon:"🥦", fg:"#4a8c2a", bg:"rgba(74,140,42,0.08)",  border:"rgba(74,140,42,0.2)"   },
  pescatarian: { label:"Pescatarian", icon:"🐟", fg:"#1a6e8a", bg:"rgba(26,110,138,0.08)", border:"rgba(26,110,138,0.2)"  },
  meat:        { label:"Meat-based",  icon:"🥩", fg:"#8a3a1a", bg:"rgba(138,58,26,0.08)",  border:"rgba(138,58,26,0.2)"   },
  unknown:     { label:"Unknown",     icon:"❓", fg:"#7a7670", bg:"rgba(122,118,112,0.06)",border:"rgba(122,118,112,0.15)" },
};
const NS_COLOR   = { a:"#2e7d52", b:"#4a9060", c:"#b07d2b", d:"#a0622a", e:"#c0392b" };
const NOVA_COLOR = { 1:"#2e7d52", 2:"#4a9060", 3:"#b07d2b", 4:"#c0392b" };
const NOVA_LABEL = { 1:"Unprocessed", 2:"Culinary ingredients", 3:"Processed", 4:"Ultra-processed" };

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function tlColor(type, v) {
  if (v == null) return "#999";
  const T = { fat:[17.5,3], satfat:[5,1.5], sugars:[22.5,11.25], salt:[1.5,0.75] };
  const [hi, med] = T[type] || [999, 999];
  return v >= hi ? "#c0392b" : v >= med ? "#b07d2b" : "#2e7d52";
}
function tlLabel(type, v) {
  if (v == null) return "";
  const T = { fat:[17.5,3], satfat:[5,1.5], sugars:[22.5,11.25], salt:[1.5,0.75] };
  const [hi, med] = T[type] || [999, 999];
  return v >= hi ? "High" : v >= med ? "Medium" : "Low";
}
function fmt(v, d = 1) {
  if (v == null) return "—";
  return typeof v === "number" ? v.toFixed(v < 0.1 ? 2 : d) : String(v);
}
function getRisk(subs) {
  if (!subs || subs.length === 0) return null;
  if (subs.some(s => s.risk === "high"))   return "high";
  if (subs.some(s => s.risk === "medium")) return "medium";
  return "low";
}
function normKey(str) {
  const base = str.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").slice(0, 80);
  // Namespace cosmetic keys so a shampoo and a soup of the same name cannot
  // collide in the shared database.
  return DOMAIN === "cosmetics" ? "cos:" + base : base;
}
function lastText(d) {
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).reverse()[0] || "";
}

// ─── THEME ─────────────────────────────────────────────────────────────────────
function makeTheme(dark) {
  return dark ? {
    bg:"#111213", bgSub:"#161819", surface:"#1c1e21", surfaceHov:"#202226",
    border:"#2a2d33", borderMed:"#353840", text:"#e8e9eb", textSub:"#8a8f9a", textMuted:"#555b68",
    accent:"#6b7cff", accentFg:"#fff", header:"#161819", tabBg:"#161819",
    leftBg:"#161819", rightBg:"#111213", inputBg:"#1c1e21", inputBorder:"#2a2d33", inputText:"#e8e9eb",
    cardBg:"#1c1e21", cardBorder:"#2a2d33", cardSel:"#1e2028", cardSelBorder:"#6b7cff",
    tableTh:"#1a1c20", tableBorder:"#252830", pill:"#222530", pillText:"#6e7585",
  } : {
    bg:"#f6f5f3", bgSub:"#f0eeec", surface:"#fff", surfaceHov:"#fafaf9",
    border:"#e8e6e2", borderMed:"#d4d0cb", text:"#1a1917", textSub:"#6b6760", textMuted:"#a09c97",
    accent:"#3d52c4", accentFg:"#fff", header:"#fff", tabBg:"#fff",
    leftBg:"#fff", rightBg:"#f6f5f3", inputBg:"#fff", inputBorder:"#e0ddd8", inputText:"#1a1917",
    cardBg:"#fafaf9", cardBorder:"#e8e6e2", cardSel:"#f8f7ff", cardSelBorder:"#3d52c4",
    tableTh:"#f4f2ef", tableBorder:"#ece9e4", pill:"#eeecea", pillText:"#7a7670",
  };
}

// ─── API HELPERS ───────────────────────────────────────────────────────────────

export { RISK_CFG, DIET_CFG, NS_COLOR, NOVA_COLOR, NOVA_LABEL, tlColor, tlLabel, fmt, getRisk, normKey, lastText, makeTheme };
