import { useState } from "react";
import { fmt, tlColor } from "../lib/theme.js";

function scoreBand(v) {
  if (v >= 76) return { label: "Excellent", color: "#2e7d52" };
  if (v >= 51) return { label: "Good",      color: "#4a9060" };
  if (v >= 26) return { label: "Poor",      color: "#d97706" };
  return           { label: "Bad",       color: "#c0392b" };
}
const TIER_DOT = { avoid:"#c0392b", caution:"#d97706", sensitive:"#b8860b", cutback:"#7a8b3a", safe:"#2e7d52" };

function NutritionSafetyRows({ offData, aiSugarData, ratings, t }) {
  const [openRow, setOpenRow] = useState(null);
  if (!ratings?.safety) return null;
  const { safety } = ratings;
  const n = offData.nut || {};
  const totalSugars = n.sugars ?? aiSugarData?.total_sugars ?? null;
  const hasSrv = !!offData.servingSize;
  const kcal = hasSrv && n.energy_srv != null ? n.energy_srv : n.energy_kcal;
  const kcalUnit = hasSrv && n.energy_srv != null ? `per serving (${offData.servingSize})` : "per 100g";
  const score = safety.unknown || safety.score == null ? null : Math.max(0, Math.min(100, Math.round(safety.score * 10)));
  const band = score == null ? null : scoreBand(score);

  const attrs = [];

  // Additives: always shown when the label declares any, because "unrated"
  // is information too (see cspiAssess) — it never gets folded into a green
  // "fine" the way an unexamined product would be.
  const additiveTotal = (safety.rated?.length || 0) + (safety.unrated?.length || 0);
  if (additiveTotal > 0) {
    const worst = safety.worstTier;
    attrs.push({
      key: "additives", icon: "⚗️", label: "Additives", value: String(additiveTotal), bucket: "neg",
      color: worst ? TIER_DOT[worst] : "#999",
      sub: worst
        ? (worst === "safe" ? "Additives with no known risk" : `Additives ${CSPI_TIERS[worst].label.toLowerCase()}`)
        : "Not in the curated safety list",
      detail: safety.rated?.length
        ? `Rated: ${safety.rated.map(r => r.name || r.additive).join(", ")}.`
        : "None of this product's declared additives are in the curated CSPI subset — coverage, not a clean bill.",
    });
  } else if (offData.ingredients) {
    attrs.push({ key:"additives", icon:"⚗️", label:"Additives", value:"0", bucket:"pos", color:"#2e7d52",
      sub:"No declared additives", detail:"No additives are declared in this product's ingredient list." });
  }

  const tl = (key, icon, label, v, negWording, posWording) => {
    if (v == null) return;
    const c = tlColor(key, v);
    attrs.push({ key, icon, label, value:`${fmt(v)}g`, bucket: c === "#2e7d52" ? "pos" : "neg", color:c,
      sub: c === "#c0392b" ? negWording[0] : c === "#2e7d52" ? posWording : negWording[1],
      detail: `${fmt(v)}g per 100g.` });
  };
  tl("fat",    "🥑", "Fat",           n.fat,        ["High in fat","A bit fatty"],   "Low in fat");
  tl("satfat", "💧", "Saturated fat", n.saturated,  ["Too fatty","A bit fatty"], "Low in saturated fat");
  tl("sugars", "🧊", "Sugar",         totalSugars,  ["Too sweet","A bit sweet"], "Low in sugar");

  if (kcal != null) {
    const c = kcal >= 400 ? "#c0392b" : kcal >= 150 ? "#d97706" : "#2e7d52";
    attrs.push({ key:"calories", icon:"🔥", label:"Calories", value:`${Math.round(kcal)} Cal`,
      bucket: c === "#2e7d52" ? "pos" : "neg", color:c,
      sub: c === "#c0392b" ? "A bit too caloric" : c === "#d97706" ? "Moderately caloric" : "Reasonably caloric",
      detail: `${Math.round(kcal)} kcal ${kcalUnit}.` });
  }
  if (n.protein > 0) {
    attrs.push({ key:"protein", icon:"🐟", label:"Protein", value:`${fmt(n.protein)}g`, bucket:"pos", color:"#2e7d52",
      sub: n.protein >= 8 ? "Good source of protein" : "Some protein", detail:`${fmt(n.protein)}g protein per 100g.` });
  }
  if (n.fiber > 0) {
    attrs.push({ key:"fiber", icon:"🌾", label:"Fiber", value:`${fmt(n.fiber)}g`, bucket:"pos", color:"#2e7d52",
      sub: n.fiber >= 3 ? "Good source of fiber" : "Some fiber", detail:`${fmt(n.fiber)}g dietary fibre per 100g.` });
  }
  if (n.salt != null) {
    const c = tlColor("salt", n.salt);
    const mg = Math.round(n.salt * 400);
    attrs.push({ key:"sodium", icon:"🧂", label:"Sodium", value:`${mg}mg`, bucket: c === "#2e7d52" ? "pos" : "neg", color:c,
      sub: c === "#c0392b" ? "High sodium" : c === "#2e7d52" ? "Low sodium" : "Moderate sodium",
      detail: `${fmt(n.salt)}g salt per 100g (≈ ${mg}mg sodium).` });
  }

  const negatives = attrs.filter(a => a.bucket === "neg");
  const positives = attrs.filter(a => a.bucket === "pos");
  if (!negatives.length && !positives.length && score == null) return null;

  const Row = ({ a, last }) => (
    <div>
      <div onClick={() => setOpenRow(o => o === a.key ? null : a.key)}
        style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",cursor:"pointer",
          borderBottom: last && openRow !== a.key ? "none" : `1px solid ${t.border}`}}>
        <span style={{fontSize:15,width:20,textAlign:"center",flexShrink:0}}>{a.icon}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:600,color:t.text}}>{a.label}</div>
          <div style={{fontSize:10,color:t.textSub,marginTop:1}}>{a.sub}</div>
        </div>
        <div style={{fontSize:12,color:t.textSub,fontWeight:600,whiteSpace:"nowrap"}}>{a.value}</div>
        <div style={{width:9,height:9,borderRadius:"50%",background:a.color,flexShrink:0}}/>
        <span style={{fontSize:9,color:t.textMuted,flexShrink:0,transform:openRow===a.key?"rotate(180deg)":"none",transition:"transform 0.15s"}}>▾</span>
      </div>
      {openRow === a.key && (
        <div style={{padding:"2px 16px 12px 46px",fontSize:11,color:t.textSub,lineHeight:1.6,
          borderBottom: last ? "none" : `1px solid ${t.border}`, background:t.bgSub}}>
          {a.detail}
        </div>
      )}
    </div>
  );

  // No outer card here on purpose — this is embedded as the lead content of
  // the Nutrition Facts card in OFFCard, not a card of its own (see header
  // comment above). The score sits as a slim row rather than a big badge with
  // its own product image/name, since the card around it already has both.
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:`1px solid ${t.border}`,background:t.bgSub}}>
        {band && <div style={{width:9,height:9,borderRadius:"50%",background:band.color,flexShrink:0}}/>}
        <div style={{fontSize:11,fontWeight:600,color:t.textSub,flex:1}}>Safety score</div>
        <div style={{fontSize:15,fontWeight:800,color:band?band.color:t.textMuted,lineHeight:1}}>
          {score == null ? "—" : score}<span style={{fontSize:10,fontWeight:600,color:t.textMuted}}>/100</span>
        </div>
        {band && <span style={{fontSize:10,fontWeight:600,color:band.color}}>{band.label}</span>}
      </div>

      {safety.unknown && (
        <div style={{margin:"10px 16px",fontSize:11,color:"#c0392b",background:"rgba(192,57,43,0.07)",border:"1px solid rgba(192,57,43,0.3)",borderRadius:8,padding:"9px 11px",lineHeight:1.6}}>
          No ingredient list on record, so nothing could be scored. That is not the same as a clean label.
        </div>
      )}

      {negatives.length > 0 && (
        <div>
          <div style={{padding:"10px 16px 6px",fontSize:11,fontWeight:700,color:t.text}}>Negatives</div>
          {negatives.map((a,i) => <Row key={a.key} a={a} last={i===negatives.length-1 && !positives.length}/>)}
        </div>
      )}
      {positives.length > 0 && (
        <div>
          <div style={{padding:"12px 16px 6px",fontSize:11,fontWeight:700,color:t.text}}>Positives</div>
          {positives.map((a,i) => <Row key={a.key} a={a} last={i===positives.length-1}/>)}
        </div>
      )}
    </div>
  );
}


export { scoreBand, TIER_DOT, NutritionSafetyRows };
