function Disclaimer({ t, variant = "full" }) {
  const box = {
    fontSize: 10, color: t.textSub, lineHeight: 1.65,
    background: t.bgSub, border: `1px solid ${t.border}`,
    borderRadius: 8, padding: "10px 12px", marginTop: 10,
  };
  if (variant === "compact") {
    return (
      <div style={{ ...box, fontSize: 9.5, color: t.textMuted }}>
        Suggestions, not recommendations. “Pure”, “natural” or “organic” describes how
        something was made — not whether it suits you.
      </div>
    );
  }
  return (
    <div style={box}>
      <strong style={{ color: t.text, fontWeight: 700 }}>Choose wisely.</strong>{" "}
      This is a suggestion to help you decide, not a verdict. Labels like “pure”, “natural”,
      “organic” or “vegan” describe how something was made — not whether it is safe for
      <em> you</em>. Something entirely pure can still harm someone sensitive to it.
      <br /><br />
      Data can also be incomplete or out of date, and formulations differ by country. The pack
      in your hand is the authority — and for any diagnosed condition or allergy, your clinician
      comes first.
    </div>
  );
}

// ─── NUTRITION & SAFETY (embedded in the Nutrition Facts card) ─────────────
// A single score, a colour, and two short "Negatives"/"Positives" lists — the
// layout readers already know from the popular ingredient-scanner apps.
// Deliberately NOT a separate card: an earlier version sat this above the
// Nutrition Facts card as its own block, which put two cards on screen
// covering half the same ground (saturated fat, sugar, salt appeared in
// both) — confusing rather than helpful. This renders as the lead content of
// the Nutrition Facts card instead — one list, not two.
//
// The number is the existing Safety score (CSPI additive tiers), not a new
// blended metric: ratings.js deliberately never averages Safety, Expert and
// Community together (see RatingsPanel), and Safety is already the headline
// of the three, so it is what a single "score out of 100" can honestly mean
// here. Every row reads off figures already computed for the Nutrition
// Facts table and the CSPI assessment — a second view of existing data, not
// a new source of truth.

export { Disclaimer };
