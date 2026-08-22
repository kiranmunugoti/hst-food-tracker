// App-wide configuration: the shared database location, and the two runtime
// toggles (Enhanced-mode / domain) that many modules below read.
// ─── CONFIG ────────────────────────────────────────────────────────────────────
// The shared scan database lives in its OWN repository, separate from this
// source code. The app commits to it on every scan, so keeping it out of the
// code repo means your `git push` is never rejected by commits the app made.
// Create the repo (public, empty) and put its name here.
const GH_OWNER  = "kiranmunugoti";
const GH_REPO   = "hst-database";   // data only — NOT the source repo
const GH_BRANCH = "main";
const GH_FILE   = "db.json";
const GH_RAW    = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_FILE}`;
// Write access needs VITE_GH_TOKEN (Vercel env var, scoped to the database repo
// only). Reads are public and always work. __GH_TOKEN__ is injected at build
// time by Vite; the typeof guard keeps the app running where it is absent, with
// reads working and writes cleanly disabled.
const GH_TOKEN  = (typeof __GH_TOKEN__ !== "undefined" && __GH_TOKEN__) || "";

// ─── ANALYSIS MODE ─────────────────────────────────────────────────────────────
// false = STANDARD (default): deterministic engine + Open Food Facts + shared
//         database. No AI calls, so the marginal cost per scan is zero.
// true  = ENHANCED: layers extended research on top. Can only ADD to the
//         Standard baseline, so an unavailable response degrades silently.
//         Needs ANTHROPIC_API_KEY server-side on Vercel (see /api/claude).
// Toggleable at runtime from the header switch.
let AI_MODE = false;

// ─── DOMAIN ────────────────────────────────────────────────────────────────────
// "food"      → Open Food Facts + additive/contaminant engine, referenced to
//               EFSA and JECFA, the bodies that actually govern food additives.
// "cosmetics" → Open Beauty Facts + INCI formulation engine, referenced to CIR
//               and SCCS, the bodies that govern cosmetic ingredients.
// The two are kept strictly apart: a CIR conclusion is about skin contact and
// says nothing about ingestion, so limits must never be carried across.
let DOMAIN = "food";


// Setters, not raw mutable exports: AI_MODE and DOMAIN are read all over the
// app, but only the App component ever changes them (via the Enhanced-mode
// toggle and per-product domain detection). A module that imports a "let"
// binding can read live updates to it automatically, but cannot assign to it
// directly — these functions are that write path.
export function setAiModeFlag(v) { AI_MODE = v; }
export function setDomainFlag(v) { DOMAIN = v; }

export { GH_OWNER, GH_REPO, GH_BRANCH, GH_FILE, GH_RAW, GH_TOKEN, AI_MODE, DOMAIN };
