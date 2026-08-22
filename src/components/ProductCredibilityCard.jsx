// ─── PRODUCT CREDIBILITY CARD ──────────────────────────────────────────────────
// Reports on THIS product: what it discloses, what it leaves out, and how
// complete the available data is. The brand's own score appears as a separate,
// stable figure so the two are never confused.
function ProductCredibilityCard({ cred, brandStat, brand, loading, enhanced, t, dark, onOpenBrand }) {
  if (loading) return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"18px 20px"}}>
      <div style={{fontSize:12,fontWeight:600,color:t.textSub,marginBottom:12}}>Product Credibility</div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <div style={{width:48,height:48,borderRadius:10,background:t.pill,animation:"shimmer 1.4s ease infinite"}}/>
        <div style={{flex:1}}><div style={{height:12,width:"60%",background:t.pill,borderRadius:4,marginBottom:6}}/><div style={{height:10,width:"40%",background:t.pill,borderRadius:4}}/></div>
      </div>
    </div>
  );
  if (!cred) return null;

  const sc = cred.score;
  const scoreColor = sc>=8?"#2e7d52":sc>=6?"#b07d2b":sc>=4?"#a0622a":"#c0392b";
  const arc = (sc / 10) * 251;
  const impactColor = { positive:"#2e7d52", negative:"#c0392b", neutral:t.textMuted };
  const impactMark  = { positive:"✓", negative:"✕", neutral:"•" };

  return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Product Credibility</div>
          <div style={{fontSize:16,fontWeight:700,color:scoreColor}}>{cred.verdict}</div>
          <div style={{fontSize:11,color:t.textSub,marginTop:2}}>
            Label transparency: {cred.transparency} · {cred.dataCompleteness}% of product data available
          </div>
        </div>
        <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
          <svg viewBox="0 0 90 90" width={64} height={64} style={{transform:"rotate(-90deg)"}}>
            <circle cx="45" cy="45" r="40" fill="none" stroke={t.border} strokeWidth="7"/>
            <circle cx="45" cy="45" r="40" fill="none" stroke={scoreColor} strokeWidth="7" strokeDasharray={`${arc} 251`} strokeLinecap="round"/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:16,fontWeight:800,color:scoreColor,lineHeight:1}}>{sc}</span>
            <span style={{fontSize:8,color:t.textMuted}}>/10</span>
          </div>
        </div>
      </div>

      {/* What drove the score, for this product */}
      <div style={{padding:"12px 20px"}}>
        {cred.factors.map((f,i) => (
          <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start",marginBottom:i===cred.factors.length-1?0:9}}>
            <span style={{color:impactColor[f.impact],fontSize:11,lineHeight:1.5,flexShrink:0,fontWeight:700}}>{impactMark[f.impact]}</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text,overflowWrap:"anywhere"}}>{f.label}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55,overflowWrap:"anywhere"}}>{f.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Brand context — a separate, stable figure across the shared database */}
      {brand && (
        <div style={{padding:"11px 20px",borderTop:`1px solid ${t.border}`,background:t.bgSub,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase"}}>{brandStat?.isParent ? "Brand · Company" : "Brand"}</div>
            <div style={{fontSize:12,fontWeight:600,color:t.text,overflowWrap:"anywhere"}}>
              {brand}
              {brandStat?.isParent && <span style={{color:t.textMuted,fontWeight:500}}> · owned by {brandStat.identity}</span>}
            </div>
          </div>
          {brandStat ? (
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:800,
                color: brandStat.thin ? t.textMuted : brandStat.score>=8?"#2e7d52":brandStat.score>=6?"#b07d2b":brandStat.score>=4?"#a0622a":"#c0392b"}}>
                {brandStat.score}/10
              </div>
              <div style={{fontSize:10,color:t.textMuted}}>
                {brandStat.identity} · {brandStat.count} product{brandStat.count!==1?"s":""}
              </div>
              {/* Same convention as Expert accolades: a score built from a
                  handful of products reads with the same visual confidence as
                  one built from hundreds unless this says otherwise — and a
                  reputable brand can otherwise land on a flat, alarming 0/10
                  off a single flagged product, which looks like an app error
                  more than it looks like a finding. */}
              {brandStat.thin && (
                <div style={{fontSize:9,color:"#d97706",fontWeight:600,marginTop:2,maxWidth:170,lineHeight:1.4}}>
                  Too few products to be a verdict — indicative only
                </div>
              )}
            </div>
          ) : (
            <div style={{fontSize:10,color:t.textMuted,textAlign:"right",maxWidth:190,lineHeight:1.5}}>
              No brand rating yet — it appears once products from this brand are in the shared database.
            </div>
          )}
        </div>
      )}

      {/* Researched brand detail, Enhanced only — clearly marked as brand-level */}
      {enhanced && (cred.brandResearch?.summary || cred.brandResearch?.controversies?.length) && (
        <div style={{padding:"12px 20px",borderTop:`1px solid ${t.border}`}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>Company background</div>
          {cred.brandResearch.summary && <div style={{fontSize:11,color:t.textSub,lineHeight:1.65,marginBottom:cred.brandResearch.controversies?.length?8:0}}>{cred.brandResearch.summary}</div>}
          {(cred.brandResearch.controversies || []).slice(0,3).map((c,i) => (
            <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
              <span style={{color:"#c0392b",fontSize:10,flexShrink:0}}>!</span>
              <span style={{fontSize:11,color:t.textSub,lineHeight:1.55}}>{c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NUTRITION ROW ─────────────────────────────────────────────────────────────

export { ProductCredibilityCard };
