import { useState } from "react";
import { searchCommonIngredients } from "../lib/commonIngredients.js";
import { usdaSearchGeneric } from "../api/usda.js";

// Calorie/macro calculator for home-cooked dishes — "a cup of rice with
// curry" has no barcode, so it can't be scanned or searched the way a
// packaged product can. This sums per-ingredient reference nutrition
// (weight × per-100g values) across everything in the dish. It does NOT run
// the additive/hazard safety analysis the rest of the app does for packaged
// products — that analysis reads a declared ingredients list and additive
// tags, neither of which a home recipe has. Scope here is calories and
// macros only, stated plainly rather than faked with a guessed score.

function fromUsda(p) {
  const n = p.nutriments || {};
  return {
    name: p.product_name,
    kcal: n["energy-kcal_100g"] ?? 0,
    protein: n["proteins_100g"] ?? 0,
    fat: n["fat_100g"] ?? 0,
    carbs: n["carbohydrates_100g"] ?? 0,
    sugar: n["sugars_100g"] ?? 0,
    fiber: n["fiber_100g"] ?? 0,
    sodium: (n["sodium_100g"] ?? 0) * 1000, // g → mg, to match the local table's unit
    source: "usda",
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

function DishBuilder({ t, isMobile }) {
  const [dishName, setDishName] = useState("");
  const [servings, setServings] = useState(2);
  const [rows, setRows] = useState([]);

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);       // {name,kcal,protein,fat,carbs,sugar,fiber,sodium,source}
  const [grams, setGrams] = useState("");
  const [usdaResults, setUsdaResults] = useState(null);
  const [usdaBusy, setUsdaBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualKcal, setManualKcal] = useState("");

  const localHits = !picked && !manual ? searchCommonIngredients(query) : [];

  async function runUsdaSearch() {
    if (!query.trim()) return;
    setUsdaBusy(true); setUsdaResults(null);
    try {
      const hits = await usdaSearchGeneric(query.trim(), 6);
      setUsdaResults(hits.map(fromUsda));
    } catch {
      setUsdaResults([]);
    } finally {
      setUsdaBusy(false);
    }
  }

  function resetForm() {
    setQuery(""); setPicked(null); setGrams(""); setUsdaResults(null); setManual(false); setManualKcal("");
  }

  function addRow() {
    const g = parseFloat(grams);
    if (!g || g <= 0) return;
    let src = picked;
    if (!src && manual) {
      const k = parseFloat(manualKcal);
      if (!Number.isFinite(k)) return;
      src = { name: query.trim() || "Custom ingredient", kcal: k, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, sodium: 0, source: "manual" };
    }
    if (!src) return;
    setRows(r => [...r, { id: Date.now() + Math.random(), ...src, grams: g }]);
    resetForm();
  }

  function removeRow(id) { setRows(r => r.filter(x => x.id !== id)); }

  const totals = rows.reduce((a, r) => {
    const f = r.grams / 100;
    a.grams += r.grams; a.kcal += r.kcal * f; a.protein += r.protein * f; a.fat += r.fat * f;
    a.carbs += r.carbs * f; a.sugar += r.sugar * f; a.fiber += r.fiber * f; a.sodium += r.sodium * f;
    return a;
  }, { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, sodium: 0 });
  const perServing = Math.max(1, Number(servings) || 1);

  const srcTag = { local: "Reference", usda: "USDA", manual: "Custom" };
  const srcColor = { local: t.accent, usda: "#4a9060", manual: t.textMuted };

  const inputStyle = { width: "100%", boxSizing: "border-box", fontSize: 12, padding: "8px 10px", borderRadius: 7,
    border: `1px solid ${t.border}`, background: t.bgSub, color: t.text };

  return (
    <div style={{overflowY:"auto",height:isMobile?"auto":"calc(100vh - 109px)",minHeight:isMobile?"calc(100vh - 109px)":undefined,background:t.bg,padding:isMobile?"16px 14px":"20px 24px"}}>
      <div style={{maxWidth:760,margin:"0 auto"}}>
        <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Home-cooked dishes have no barcode — add up what went in</div>
        <div style={{fontSize:19,fontWeight:800,color:t.text,letterSpacing:"-0.4px",marginBottom:14}}>Build a Dish</div>

        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input value={dishName} onChange={e=>setDishName(e.target.value)} placeholder="Dish name (e.g. Rice with curry)"
            style={{...inputStyle, flex:1}}/>
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <span style={{fontSize:11,color:t.textSub}}>Servings</span>
            <input type="number" min="1" value={servings} onChange={e=>setServings(e.target.value)}
              style={{...inputStyle, width:56, textAlign:"center"}}/>
          </div>
        </div>

        {/* ── add-ingredient form ── */}
        <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:12,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:t.text,marginBottom:8}}>Add an ingredient</div>

          <input value={query} placeholder="e.g. rice, onion, cooking oil…"
            onChange={e=>{ setQuery(e.target.value); setPicked(null); setUsdaResults(null); setManual(false); }}
            style={{...inputStyle, marginBottom:6}}/>

          {picked ? (
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:7,background:t.pill,marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:600,color:t.text,flex:1}}>{picked.name}</span>
              <span style={{fontSize:9,fontWeight:600,color:srcColor[picked.source]}}>{srcTag[picked.source]}</span>
              <span style={{fontSize:10,color:t.textMuted}}>{Math.round(picked.kcal)} kcal/100g</span>
              <button onClick={()=>setPicked(null)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:12}}>✕</button>
            </div>
          ) : manual ? (
            <div style={{marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:t.textSub}}>Calories per 100g</span>
                <input type="number" min="0" value={manualKcal} onChange={e=>setManualKcal(e.target.value)}
                  style={{...inputStyle, width:80}}/>
                <button onClick={()=>{setManual(false); setManualKcal("");}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:11}}>Cancel</button>
              </div>
              <div style={{fontSize:9.5,color:t.textMuted,marginTop:4}}>Other macros won't be counted for this entry — use Search for a fuller breakdown.</div>
            </div>
          ) : query.trim() ? (
            <div style={{marginBottom:8}}>
              {localHits.length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                  {localHits.map(h => (
                    <button key={h.name} onClick={()=>setPicked({...h, source:"local"})}
                      style={{fontSize:11,padding:"6px 10px",borderRadius:7,background:t.pill,color:t.text,border:`1px solid ${t.border}`,cursor:"pointer"}}>
                      {h.name} <span style={{color:t.textMuted}}>· {Math.round(h.kcal)} kcal/100g</span>
                    </button>
                  ))}
                </div>
              )}
              {usdaResults && usdaResults.length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                  {usdaResults.map((h,i) => (
                    <button key={i} onClick={()=>setPicked(h)}
                      style={{fontSize:11,padding:"6px 10px",borderRadius:7,background:t.pill,color:t.text,border:`1px solid ${t.border}`,cursor:"pointer"}}>
                      {h.name} <span style={{color:t.textMuted}}>· {Math.round(h.kcal)} kcal/100g</span>
                    </button>
                  ))}
                </div>
              )}
              {usdaResults?.length === 0 && (
                <div style={{fontSize:10.5,color:t.textMuted,marginBottom:6}}>No USDA match either.</div>
              )}
              <div style={{display:"flex",gap:10}}>
                <button onClick={runUsdaSearch} disabled={usdaBusy}
                  style={{fontSize:10.5,color:t.accent,background:"none",border:"none",cursor:usdaBusy?"default":"pointer",padding:0}}>
                  {usdaBusy ? "Searching USDA…" : "🔍 Not listed — search USDA database"}
                </button>
                <button onClick={()=>setManual(true)}
                  style={{fontSize:10.5,color:t.accent,background:"none",border:"none",cursor:"pointer",padding:0}}>
                  ✏️ Enter calories manually
                </button>
              </div>
            </div>
          ) : null}

          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="number" min="0" value={grams} onChange={e=>setGrams(e.target.value)} placeholder="grams"
              style={{...inputStyle, width:90}}/>
            <span style={{fontSize:9.5,color:t.textMuted,flex:1}}>{picked?.serving || "Tip: 1 cup cooked rice ≈ 195g · 1 tbsp oil ≈ 14g"}</span>
            <button onClick={addRow} disabled={!(picked || (manual && manualKcal)) || !grams}
              style={{padding:"8px 14px",fontSize:11,fontWeight:600,borderRadius:7,flexShrink:0,
                cursor:(picked||manual)&&grams?"pointer":"default",
                background:(picked||manual)&&grams?t.accent:t.pill,
                color:(picked||manual)&&grams?t.accentFg:t.textMuted,border:"none"}}>+ Add</button>
          </div>
        </div>

        {/* ── ingredient list ── */}
        {rows.length > 0 && (
          <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,overflow:"hidden",marginBottom:16}}>
            {rows.map((r,i) => (
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",
                borderBottom: i===rows.length-1?"none":`1px solid ${t.border}`}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,color:t.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                  <div style={{fontSize:9.5,color:t.textMuted}}>{r.grams}g · <span style={{color:srcColor[r.source]}}>{srcTag[r.source]}</span></div>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:t.text,whiteSpace:"nowrap"}}>{Math.round(r.kcal*r.grams/100)} Cal</div>
                <button onClick={()=>removeRow(r.id)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:13}}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ── totals ── */}
        {rows.length > 0 && (
          <div style={{background:t.surface,border:`1px solid ${t.accent}`,borderRadius:10,padding:14,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:t.text,marginBottom:8}}>{dishName.trim() || "This dish"} — {Math.round(totals.grams)}g total</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:10}}>
              {[
                ["Total", `${Math.round(totals.kcal)} Cal`],
                ["Per serving", `${Math.round(totals.kcal/perServing)} Cal`],
                ["Protein/serving", `${round1(totals.protein/perServing)}g`],
                ["Sugar/serving", `${round1(totals.sugar/perServing)}g`],
              ].map(([l,v]) => (
                <div key={l}>
                  <div style={{fontSize:15,fontWeight:800,color:t.text}}>{v}</div>
                  <div style={{fontSize:9,color:t.textMuted,marginTop:1}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:9.5,color:t.textMuted,marginTop:10,paddingTop:8,borderTop:`1px solid ${t.border}`,lineHeight:1.5}}>
              Totals from typical per-100g reference values, not a lab measurement of this exact
              dish. No safety/additive score is shown here — that analysis needs a declared
              ingredients list, which a home recipe doesn't have.
            </div>
          </div>
        )}

        {rows.length === 0 && (
          <div style={{textAlign:"center",padding:"32px 16px",color:t.textMuted,fontSize:12}}>
            Add each ingredient with its weight — totals appear here as you go.
          </div>
        )}
      </div>
    </div>
  );
}

export { DishBuilder };
