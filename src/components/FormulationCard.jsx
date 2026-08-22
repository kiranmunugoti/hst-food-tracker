// ─── FORMULATION CARD (cosmetics) ──────────────────────────────────────────────
// The four things the cosmetics engine assesses: the formulation as a whole,
// the pH it must sit at, how actives are delivered, and what stabilises it.
function FormulationCard({ analysis, t, dark }) {
  const form = analysis?.formulation;
  const { ph, delivery, stabilisers } = analysis || {};
  if (!form && !ph && !delivery?.length && !stabilisers) return null;

  const sec = { padding:"13px 20px", borderTop:`1px solid ${t.border}` };
  const hdr = { fontSize:10, fontWeight:600, color:t.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7 };
  const warn = (level) => ({
    marginTop:7, padding:"8px 11px",
    background: level==="high" ? (dark?"rgba(192,57,43,0.1)":"rgba(192,57,43,0.06)") : t.bgSub,
    border:`1px solid ${level==="high"?"rgba(192,57,43,0.3)":t.border}`,
    borderRadius:7, fontSize:11, color: level==="high"?"#c0392b":t.textSub, lineHeight:1.6,
  });

  return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      {/* Overall formulation */}
      {form && (
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Overall formulation</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:7}}>
            <span style={{fontSize:15,fontWeight:700,color:t.text}}>{form.base}</span>
            <span style={{fontSize:10,fontWeight:600,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"2px 8px",borderRadius:5}}>{form.complexity} complexity</span>
            <span style={{fontSize:10,color:t.textMuted}}>{form.total} ingredients</span>
          </div>
          <div style={{fontSize:11,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>{form.note}</div>
          {form.leading?.length > 0 && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:form.flaggedLeading?.length?8:0}}>
              {form.leading.map((x,i) => (
                <span key={i} style={{fontSize:10,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"3px 9px",borderRadius:5,overflowWrap:"anywhere"}}>{i+1}. {x}</span>
              ))}
            </div>
          )}
          {form.flaggedLeading?.length > 0 && (
            <div style={warn("high")}>
              {form.flaggedLeading.length} restricted ingredient{form.flaggedLeading.length!==1?"s":""} appear{form.flaggedLeading.length===1?"s":""} in the first five entries, so {form.flaggedLeading.length===1?"it is":"they are"} present at a meaningful concentration: {form.flaggedLeading.map(h=>h.name||h.inci).join(", ")}.
            </div>
          )}
          {form.allergens?.length > 0 && (
            <div style={{marginTop:8,fontSize:11,color:t.textSub,lineHeight:1.6}}>
              <span style={{fontWeight:600}}>{form.allergens.length} declarable fragrance allergen{form.allergens.length!==1?"s":""}:</span> {form.allergens.slice(0,6).join(", ")}{form.allergens.length>6?` +${form.allergens.length-6}`:""}
            </div>
          )}
        </div>
      )}

      {/* pH */}
      {ph && (
        <div style={sec}>
          <div style={hdr}>pH requirement</div>
          {ph.known ? (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:9,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontSize:17,fontWeight:800,color:t.text,fontFamily:"monospace"}}>{ph.range}</span>
                {ph.classification && <span style={{fontSize:11,fontWeight:600,color:t.textSub}}>{ph.classification}</span>}
              </div>
              <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{ph.note}</div>
              <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginTop:6}}>
                Inferred from the actives present — pH is almost never printed on a pack. Skin's own surface sits around 4.7–5.75.
              </div>
              {(ph.conflicts||[]).map((c,i) => <div key={i} style={warn("high")}>{c.detail}</div>)}
              {(ph.incompatibilities||ph.pairs||[]).map((c,i) => <div key={"p"+i} style={warn("high")}>{c}</div>)}
            </>
          ) : (
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{ph.note}</div>
          )}
        </div>
      )}

      {/* Delivery */}
      {delivery?.length > 0 && (
        <div style={sec}>
          <div style={hdr}>Delivery system</div>
          {delivery.map((d,i) => (
            <div key={i} style={{marginBottom:i===delivery.length-1?0:9}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text}}>{d.name}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55}}>{d.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stabilisers */}
      {stabilisers && (
        <div style={sec}>
          <div style={hdr}>Stabiliser system</div>
          {stabilisers.present?.length > 0 ? stabilisers.present.map((x,i) => (
            <div key={i} style={{marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text}}>{x.name}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55}}>{x.note}</div>
            </div>
          )) : (
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>No stabiliser classes were identified in the ingredient list.</div>
          )}
          {(stabilisers.gaps||[]).map((g,i) => <div key={i} style={warn("high")}>{g}</div>)}
        </div>
      )}

      <div style={{padding:"10px 20px",borderTop:`1px solid ${t.border}`,background:t.bgSub,fontSize:10,color:t.textMuted,lineHeight:1.6}}>
        Assessed against <a href="https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en" target="_blank" rel="noopener noreferrer" style={{color:t.accent,textDecoration:"none"}}>SCCS</a> Opinions, which are binding in the EU, and <a href="https://www.cir-safety.org/" target="_blank" rel="noopener noreferrer" style={{color:t.accent,textDecoration:"none"}}>CIR</a> conclusions, which are advisory. These limits describe skin contact only and say nothing about ingestion. Educational purposes — not a substitute for a dermatologist.
      </div>
    </div>
  );
}


export { FormulationCard };
