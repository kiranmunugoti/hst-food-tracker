import { useState } from "react";
import { fmt, tlColor, getRisk, NS_COLOR, NOVA_COLOR, NOVA_LABEL, RISK_CFG, DIET_CFG } from "../lib/theme.js";
import { DOMAIN, AI_MODE } from "../lib/config.js";
import { ProductCredibilityCard } from "./ProductCredibilityCard.jsx";
import { FormulationCard } from "./FormulationCard.jsx";
import { NutritionSafetyRows } from "./NutritionSafetyRows.jsx";
import { NRow } from "./NutritionRow.jsx";
import { Disclaimer } from "./Disclaimer.jsx";

function OFFCard({ offData, aiSugarData, substances, insight, insightLoading, brandCred, brandStat, brandCredLoading, alternatives, altLoading, diet, t, dark, onOpen, cosmeticAnalysis, ratings, ratingsPanel, onAddPhoto, photoBusy }) {
  const [showIngr, setShowIngr] = useState(false);
  const n = offData.nut;
  const hasSrv = !!offData.servingSize;
  const totalSugars   = n.sugars        ?? aiSugarData?.total_sugars   ?? null;
  const addedSugars   = n.added_sugars  ?? aiSugarData?.added_sugars   ?? null;
  const naturalSugars = (totalSugars != null && addedSugars != null) ? +(totalSugars - addedSugars).toFixed(1) : (aiSugarData?.natural_sugars ?? null);
  const riskLevel = getRisk(substances);
  const ns = offData.nutriScore;
  const dc = diet && diet !== "unknown" ? DIET_CFG[diet] : null;
  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:12, overflow:"hidden" };
  const sHdr = { padding:"12px 16px", borderBottom:`1px solid ${t.border}`, fontSize:11, fontWeight:600, color:t.textMuted, letterSpacing:"0.06em", textTransform:"uppercase" };
  // Mirrors NutritionSafetyRows' own "is there anything to show" check, so the
  // Nutrition Facts card still opens for a product that has a safety score or
  // an additives readout but literally no numeric nutrition facts declared —
  // a real case (small/imported brands often carry an ingredient list with no
  // nutrition panel), not just an edge case.
  const hasSafetyRows = DOMAIN !== "cosmetics" && !!ratings?.safety && (
    ratings.safety.unknown ||
    (ratings.safety.rated?.length || 0) + (ratings.safety.unrated?.length || 0) > 0 ||
    !!offData.ingredients ||
    n.saturated != null || n.fat != null || n.protein > 0 || n.fiber > 0 || n.salt != null
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* PRODUCT HEADER */}
      <div style={{...card}}>
        <div style={{display:"flex",flexWrap:"wrap"}}>
          <div style={{width:156,minHeight:156,background:dark?"#1a1c20":"#f8f7f5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,borderRight:`1px solid ${t.border}`,overflow:"hidden"}}>
            {offData.image && (offData.image.startsWith("data:image/") || offData.image.startsWith("http"))
              ? (
                <div style={{position:"relative",width:"100%",height:156}}>
                  <img src={offData.image} alt={offData.name} style={{width:"100%",height:156,objectFit:"contain",padding:10,boxSizing:"border-box"}}/>
                  {offData._localImage && (
                    <span style={{position:"absolute",left:6,bottom:6,fontSize:8,fontWeight:600,color:"#fff",
                      background:"rgba(217,119,6,0.9)",padding:"2px 6px",borderRadius:4}}>On this device only</span>
                  )}
                  <button onClick={onAddPhoto} disabled={photoBusy}
                    style={{position:"absolute",right:6,bottom:6,fontSize:9,fontWeight:600,padding:"3px 7px",
                      borderRadius:5,background:"rgba(0,0,0,0.55)",color:"#fff",border:"none",cursor:"pointer"}}>
                    {photoBusy ? "…" : "Replace"}
                  </button>
                </div>
              )
              : (
                // USDA records carry no photography at all and community records
                // start with none, so the empty state offers to fix itself
                // rather than just reporting the gap.
                <button onClick={onAddPhoto} disabled={photoBusy}
                  style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:14,textAlign:"center",
                    background:"none",border:"none",cursor:photoBusy?"default":"pointer",width:"100%",height:156,justifyContent:"center"}}>
                  <span style={{fontSize:30,opacity:0.25}}>📷</span>
                  <span style={{fontSize:9,color:t.textMuted,lineHeight:1.5}}>
                    {photoBusy ? "Saving…" : "No image\nAdd one"}
                  </span>
                </button>
              )
            }
          </div>
          <div style={{flex:1,padding:"16px 18px",minWidth:0}}>
            {offData.brand && <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:3}}>{offData.brand}</div>}
            <h2 style={{margin:"0 0 5px",fontSize:17,fontWeight:700,color:t.text,lineHeight:1.3,wordBreak:"break-word"}}>{offData.name}</h2>
            {offData.quantity && <div style={{fontSize:11,color:t.textSub}}>{offData.quantity}{offData.servingSize ? ` · Serving: ${offData.servingSize}` : ""}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:10,alignItems:"center"}}>
              <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>Open Food Facts</span>
              {riskLevel && <span style={{fontSize:9,fontWeight:600,color:RISK_CFG[riskLevel].fg,background:RISK_CFG[riskLevel].bg,border:`1px solid ${RISK_CFG[riskLevel].border}`,padding:"2px 8px",borderRadius:4}}>{riskLevel.charAt(0).toUpperCase()+riskLevel.slice(1)} Risk</span>}
              {offData.labels.slice(0,2).map(l => <span key={l} style={{fontSize:9,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"2px 8px",borderRadius:4,textTransform:"capitalize"}}>{l.replace(/-/g," ")}</span>)}
            </div>
            {dc && (
              <div style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:7,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:8,padding:"5px 12px"}}>
                <span style={{fontSize:15,lineHeight:1}}>{dc.icon}</span>
                <span style={{fontSize:11,fontWeight:700,color:dc.fg}}>{dc.label}</span>
                <span style={{fontSize:10,color:t.textSub}}>diet</span>
              </div>
            )}
            <div style={{display:"flex",gap:20,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
              {ns && (()=>{
                const grades = ["a","b","c","d","e"];
                return (
                  <div>
                    <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Nutri-Score</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:2}}>
                      {grades.map(g => { const active = g===ns; return <div key={g} style={{width:active?32:22,height:active?32:22,borderRadius:active?7:4,background:active?(NS_COLOR[g]||"#999"):(dark?"#2a2d33":"#e8e6e2"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:active?14:10,fontWeight:700,color:active?"#fff":(dark?"#555b68":"#a09c97"),marginBottom:active?0:4}}>{g.toUpperCase()}</div>; })}
                    </div>
                  </div>
                );
              })()}
              {offData.novaGroup && (
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>NOVA</div>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <div style={{width:30,height:30,borderRadius:"50%",background:NOVA_COLOR[offData.novaGroup]||"#999",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff"}}>{offData.novaGroup}</div>
                    <div style={{fontSize:11,color:t.textSub,maxWidth:120,lineHeight:1.4}}>{NOVA_LABEL[offData.novaGroup]}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* UNDECLARED SUBSTANCE WARNING */}
      {offData.ingredients && (() => {
        const und = substances.filter(s => s.ingredientConfirmed === false);
        if (und.length === 0) return null;
        return (
          <div style={{background:dark?"rgba(192,57,43,0.09)":"rgba(192,57,43,0.05)",border:"1.5px solid rgba(192,57,43,0.35)",borderRadius:12,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:15}}>⚠️</span>
              <span style={{fontSize:11,fontWeight:700,color:"#c0392b",letterSpacing:"0.06em",textTransform:"uppercase"}}>Substances not listed on the label</span>
            </div>
            <div style={{fontSize:12,color:t.textSub,lineHeight:1.7,marginBottom:10}}>
              {und.length} substance{und.length!==1?"s are":" is"} documented for this product{offData.brand?` by ${offData.brand}`:""} but do{und.length===1?"es":""} not appear in its declared ingredient list. This may indicate contamination, packaging migration, or incomplete labelling.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {und.map((s,i) => (
                <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:"#c0392b",background:"rgba(192,57,43,0.1)",border:"1px solid rgba(192,57,43,0.25)",padding:"4px 11px",borderRadius:6}}>
                  {s.name}{s.eNumber?` · ${s.eNumber}`:""}
                  <span style={{fontSize:9,fontWeight:500,color:t.textMuted}}>({s.risk} risk)</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* PRODUCT CREDIBILITY */}
      <ProductCredibilityCard cred={brandCred} brandStat={brandStat} brand={offData.brand} loading={brandCredLoading} enhanced={AI_MODE} t={t} dark={dark}/>

      {DOMAIN === "cosmetics" && <FormulationCard analysis={cosmeticAnalysis} t={t} dark={dark}/>}

      {/* NUTRITION */}
      {(n.energy_kcal != null || totalSugars != null || hasSafetyRows) && (
        <div style={{...card}}>
          <div style={{...sHdr,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Nutrition Facts</span>
            <span style={{fontSize:10,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>per 100g{hasSrv?` · per serving (${offData.servingSize})`:""}</span>
          </div>
          {/* Score + Negatives/Positives — the at-a-glance read of this same
              nutrition data, one list rather than a separate card duplicating
              the fat/sugar/salt figures the table below already has. */}
          {DOMAIN !== "cosmetics" && <NutritionSafetyRows offData={offData} aiSugarData={aiSugarData} ratings={ratings} t={t}/>}
          {totalSugars != null && (
            <div style={{display:"grid",gridTemplateColumns:addedSugars!=null&&naturalSugars!=null?"1fr 1fr 1fr":addedSugars!=null?"1fr 1fr":"1fr",gap:10,padding:"14px 16px",background:dark?"rgba(176,125,43,0.05)":"rgba(176,125,43,0.04)",borderBottom:`1px solid ${t.border}`}}>
              {[
                { label:"Total Sugars",   value:totalSugars,   col:tlColor("sugars",totalSugars) },
                addedSugars   != null && { label:"Added Sugars",   value:addedSugars,   col:tlColor("sugars",addedSugars) },
                naturalSugars != null && { label:"Natural Sugars",  value:naturalSugars, col:"#2e7d52" },
              ].filter(Boolean).map(item => (
                <div key={item.label} style={{background:t.surface,border:`1.5px solid ${item.col}30`,borderRadius:10,padding:"11px 12px",textAlign:"center"}}>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>{item.label}</div>
                  <div style={{fontSize:26,fontWeight:800,color:item.col,lineHeight:1,fontFamily:"monospace"}}>{fmt(item.value)}g</div>
                  <div style={{fontSize:10,color:t.textSub,marginTop:4}}>per 100g</div>
                </div>
              ))}
            </div>
          )}
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:t.tableTh,borderBottom:`2px solid ${t.border}`}}>
                {["Nutrient","Per 100g",hasSrv?"Per serving":null,"%RI"].filter(Boolean).map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:h==="Nutrient"?"left":"right",fontSize:10,fontWeight:600,color:t.textSub,letterSpacing:"0.04em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <NRow label="Energy"        val100={n.energy_kcal} valSrv={n.energy_srv}  unit=" kcal" ri={2000} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Fat"           val100={n.fat}         valSrv={n.fat_srv}     unit="g"     ri={70}  bold   hasSrv={hasSrv} t={t} type="fat"/>
              <NRow label="Saturated fat" val100={n.saturated}   valSrv={null}          unit="g"     ri={20}  indent hasSrv={hasSrv} t={t} type="satfat"/>
              <NRow label="Carbohydrates" val100={n.carbs}       valSrv={n.carbs_srv}   unit="g"     ri={260} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Sugars"        val100={totalSugars}   valSrv={n.sugars_srv}  unit="g"     ri={90}  indent hasSrv={hasSrv} t={t} type="sugars"/>
              {addedSugars != null && <NRow label="Added sugars" val100={addedSugars} valSrv={null} unit="g" ri={50} indent hasSrv={hasSrv} t={t} type="sugars"/>}
              <NRow label="Dietary fibre" val100={n.fiber}       valSrv={null}          unit="g"     ri={30}        hasSrv={hasSrv} t={t}/>
              <NRow label="Protein"       val100={n.protein}     valSrv={n.protein_srv} unit="g"     ri={50}  bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Salt"          val100={n.salt}        valSrv={n.salt_srv}    unit="g"     ri={6}   bold   hasSrv={hasSrv} t={t} type="salt"/>
            </tbody>
          </table>
          <div style={{padding:"8px 14px",fontSize:9,color:t.textMuted,borderTop:`1px solid ${t.border}`}}>* Reference intake for an average adult (2000 kcal)</div>
        </div>
      )}

      {/* ADDITIVES */}
      {offData.additives.length > 0 && (
        <div style={{...card}}>
          <div style={{...sHdr}}>Additives · {offData.additives.length} detected</div>
          <div style={{padding:"14px 16px",display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.additives.map(a => {
              const e = a.replace("en:","").toUpperCase();
              const flagged = substances.some(s => s.eNumber && s.eNumber.replace(/[-\/]/g,"").toLowerCase() === e.replace(/[-\/]/g,"").toLowerCase());
              return <span key={a} style={{fontSize:11,fontFamily:"monospace",background:flagged?RISK_CFG.high.bg:t.pill,color:flagged?RISK_CFG.high.fg:t.pillText,padding:"4px 10px",borderRadius:5,border:`1px solid ${flagged?RISK_CFG.high.border:t.border}`,fontWeight:flagged?600:400}}>{e}{flagged?" ⚠":""}</span>;
            })}
          </div>
        </div>
      )}

      {/* ALLERGENS */}
      {offData.allergens.length > 0 && (
        <div style={{background:dark?"rgba(176,125,43,0.07)":"rgba(176,125,43,0.05)",border:"1px solid rgba(176,125,43,0.22)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#b07d2b",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>Allergens</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.allergens.map(a => <span key={a} style={{fontSize:11,fontWeight:500,background:"rgba(176,125,43,0.1)",color:"#8a5e1a",padding:"4px 12px",borderRadius:5,border:"1px solid rgba(176,125,43,0.25)",textTransform:"capitalize"}}>{a.replace(/-/g," ")}</span>)}
          </div>
        </div>
      )}

      {/* INGREDIENTS */}
      {offData.ingredients && (
        <div style={{...card}}>
          <div style={{...sHdr}}>Ingredients</div>
          <div style={{padding:"14px 16px"}}>
            <p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.8,display:showIngr?"block":"-webkit-box",WebkitLineClamp:showIngr?undefined:4,WebkitBoxOrient:"vertical",overflow:showIngr?"visible":"hidden"}}>{offData.ingredients}</p>
            {offData.ingredients.length > 280 && <button onClick={() => setShowIngr(p=>!p)} style={{marginTop:8,background:"none",border:"none",color:t.accent,cursor:"pointer",fontSize:11,padding:0,fontFamily:"inherit",fontWeight:500}}>{showIngr?"Show less":"Show all"}</button>}
          </div>
        </div>
      )}

      {/* HAZARD ANALYSIS */}
      {substances.length > 0 && (()=>{
        const confirmed   = substances.filter(s => s.ingredientConfirmed !== false);
        const unconfirmed = substances.filter(s => s.ingredientConfirmed === false);
        return (
          <div style={{...card}}>
            <div style={{...sHdr,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6,color:confirmed.length>0?RISK_CFG.high.fg:t.textSub}}>
              <span>Hazard Analysis · {confirmed.length} confirmed{unconfirmed.length>0?`, ${unconfirmed.length} unverified`:""}</span>
              <span style={{fontSize:9,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>Confirmed = found in ingredient list</span>
            </div>
            {confirmed.map((s,i) => (
              <div key={i} style={{margin:"0 12px 8px",background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:`3px solid ${RISK_CFG[s.risk]?.fg||"#999"}`,borderRadius:7,padding:"11px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                  <div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                      {s.eNumber && <span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                      <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 6px",borderRadius:3}}>✓ In ingredients</span>
                      {s.foundInIngredient && <span style={{fontSize:9,color:t.textMuted}}>via "{s.foundInIngredient}"</span>}
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:t.text}}>{s.name}</div>
                    <div style={{fontSize:10,color:t.textMuted}}>{s.category}</div>
                  </div>
                  <span style={{fontSize:9,fontWeight:700,color:RISK_CFG[s.risk]?.fg,background:RISK_CFG[s.risk]?.bg,border:`1px solid ${RISK_CFG[s.risk]?.border}`,padding:"3px 9px",borderRadius:4,whiteSpace:"nowrap",flexShrink:0}}>{s.risk?.charAt(0).toUpperCase()+s.risk?.slice(1)}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11,marginBottom:s.sourceUrl?8:0}}>
                  <div style={{color:t.textSub,lineHeight:1.55}}>{s.effects}</div>
                  <div style={{color:t.textMuted,fontFamily:"monospace",fontSize:10}}>{s.limit}</div>
                </div>
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>↗ {s.sourceName||"View source"}</a>}
              </div>
            ))}
            {unconfirmed.length > 0 && (
              <div style={{padding:"8px 12px",borderTop:`1px solid ${t.border}`}}>
                <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8}}>Category-level (not confirmed in this product)</div>
                {unconfirmed.map((s,i) => (
                  <div key={i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderRadius:6,padding:"8px 12px",marginBottom:6,opacity:0.75}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        {s.eNumber && <span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                        <span style={{fontSize:12,fontWeight:500,color:t.textSub}}>{s.name}</span>
                        <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"1px 6px",borderRadius:3}}>Not confirmed</span>
                      </div>
                      <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"2px 8px",borderRadius:4}}>{s.risk} risk</span>
                    </div>
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.textMuted,textDecoration:"none",marginTop:5}}>↗ {s.sourceName||"Source"}</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* HEALTHIER ALTERNATIVES */}
      {ratingsPanel}

      {(altLoading || (alternatives && alternatives.length > 0)) && (
        <div style={{...card}}>
          <div style={{...sHdr,color:"#2e7d52"}}>Better Alternatives</div>
          {altLoading && !alternatives.length
            ? <div style={{padding:"18px 16px",display:"flex",alignItems:"center",gap:10,color:t.textSub,fontSize:12}}><span style={{display:"inline-block",width:12,height:12,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Finding better alternatives…</div>
            : <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                {alternatives.map((alt,i) => (
                  <div key={i} onClick={()=>onOpen?.(alt.name)} title={`Analyse ${alt.name}`} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:7,padding:"12px 14px",cursor:onOpen?"pointer":"default",transition:"background 0.15s"}} onMouseEnter={e=>{if(onOpen)e.currentTarget.style.background=t.surfaceHov;}} onMouseLeave={e=>{if(onOpen)e.currentTarget.style.background=t.bgSub;}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:5}}>
                      <div><div style={{fontSize:13,fontWeight:600,color:t.text}}>{alt.name}</div>{alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}</div>
                      <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                        {alt.nutriScore&&alt.nutriScore!=="unknown"&&<span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 7px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>}
                        {/* Labelled rather than hidden: a widened result is
                            still useful, but the reader should know it may not
                            be on a shelf near them. */}
                        {alt.elsewhere && <span style={{fontSize:9,fontWeight:600,color:"#d97706",background:"rgba(217,119,6,0.1)",padding:"2px 8px",borderRadius:4}}>Other market</span>}
                        <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"2px 8px",borderRadius:4}}>Better</span>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:t.textSub,lineHeight:1.6,marginBottom:6}}>{alt.reason}</div>
                    {alt.improvements?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:alt.sourceUrl?6:0}}>{alt.improvements.map((imp,j)=><span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {imp}</span>)}</div>}
                    {alt.sourceUrl&&<a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>↗ {alt.sourceName||"View"}</a>}
                  </div>
                ))}
                <Disclaimer t={t} variant="compact"/>
              </div>
          }
        </div>
      )}

      {/* AI SAFETY ANALYSIS */}
      <div style={{...card}}>
        <div style={{...sHdr}}>Safety Analysis</div>
        <div style={{padding:"14px 16px"}}>
          {insightLoading
            ? <div style={{color:t.textMuted,fontSize:12,fontStyle:"italic",animation:"pulse 1.4s ease infinite"}}>Generating analysis…</div>
            : insight ? <p style={{margin:0,fontSize:13,color:t.textSub,lineHeight:1.8}}>{insight}</p>
            : <div style={{color:t.textMuted,fontSize:12}}>Pending…</div>
          }
        </div>
      </div>
      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,padding:"8px 0 4px"}}>
        Data from Open Food Facts, USDA FoodData Central and Open Beauty Facts · {AI_MODE?"Extended brand research":"Built-in safety engine"} · Educational purposes only.
      </div>
    </div>
  );
}


export { OFFCard };
