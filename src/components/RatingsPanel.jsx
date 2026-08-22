import { CSPI_TIERS, SENSITIVITY_GROUPS } from "../ratings.js";
import { Disclaimer } from "./Disclaimer.jsx";

function RatingsPanel({ ratings, t, myStars, setMyStars, myReview, setMyReview, myReport, setMyReport, onSubmit,
                       freshness, onRefresh, refreshing, contributions, detailsOpen, setDetailsOpen,
                       myDetails, setMyDetails, onSubmitDetails,
                       profile, toggleSensitivity, profileOpen, setProfileOpen, communityRecord, photoUnverified, onAddIngredients, ingredientsFocus, onSaveIngredients }) {
  if (!ratings) return null;
  const { safety, expert, community } = ratings;
  const TIER_COLOR = { avoid:"#c0392b", caution:"#d97706", sensitive:"#b8860b", cutback:"#7a8b3a", safe:"#2e7d52" };
  const sHdr = { fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 };
  const box  = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:10, padding:12, marginBottom:10 };
  const scoreColor = (v) => v >= 8 ? "#2e7d52" : v >= 6 ? "#7a8b3a" : v >= 4 ? "#d97706" : "#c0392b";

  return (
    <div style={{marginTop:14}}>
      {/* Three scores, never merged. Combining them would let a well-reviewed
          product mask a composition problem — the exact thing this app is for. */}
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[["Safety", safety.score, safety.unknown ? "no data" : "CSPI tiers"],
          ["Expert", expert.score, expert.count ? `${expert.count} source${expert.count!==1?"s":""}` : "none yet"],
          ["Community", community.score, community.count ? `${community.count} review${community.count!==1?"s":""}` : "none yet"]
        ].map(([label, val, sub]) => (
          <div key={label} style={{flex:1,textAlign:"center",background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:"10px 6px"}}>
            <div style={{fontSize:19,fontWeight:700,color:val==null?t.textMuted:scoreColor(val)}}>{val == null ? "—" : val}</div>
            <div style={{fontSize:10,fontWeight:600,color:t.text,marginTop:1}}>{label}</div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:1}}>{sub}</div>
          </div>
        ))}
      </div>
      {safety.unknown && (
        <div style={{fontSize:10,color:"#c0392b",fontWeight:600,lineHeight:1.6,marginBottom:6}}>
          Not scored. A product with no ingredient list cannot be rated — an empty score is not a
          good one.
        </div>
      )}
      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.6,marginBottom:4}}>
        Scored 1–10. Kept separate on purpose: something can be award-winning and well liked
        and still contain an ingredient rated “Avoid”. Reviews never change the safety score.
      </div>

      {/* Shown whether or not a profile is set: a missing ingredient list is a
          gap in the data everyone should see, not only people with declared
          sensitivities. */}
      {!ratings.safety?.rated?.length && !ratings.safety?.unrated?.length && (
        <div style={{fontSize:10,color:"#d97706",background:"rgba(217,119,6,0.08)",
          border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"9px 11px",lineHeight:1.6,marginTop:10}}>
          <strong>No ingredient list on record.</strong> Nothing could be analysed — additives,
          allergens and anything you avoid are all unknown for this product, not absent from it.
          {" "}
          <button onClick={onAddIngredients}
            style={{background:"none",border:"none",padding:0,color:"#d97706",fontWeight:700,
              textDecoration:"underline",cursor:"pointer",fontSize:10}}>
            Add it from the pack
          </button>
        </div>
      )}

      {/* Provenance, before the disclaimer. A community record is a stranger's
          transcription of a label — useful, and not the same thing as a curated
          database entry. Saying so is the minimum. */}
      {photoUnverified && (
        <div style={{fontSize:10,color:t.textMuted,background:t.bgSub,border:`1px solid ${t.border}`,
          borderRadius:8,padding:"8px 11px",lineHeight:1.6,marginTop:10}}>
          The photo for this product could not be matched to the label automatically, so it is
          shown as unverified.
        </div>
      )}

      {communityRecord && (
        <div style={{fontSize:10,color:"#d97706",background:"rgba(217,119,6,0.08)",
          border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"9px 11px",lineHeight:1.6,marginTop:10}}>
          <strong>Added by a reader.</strong> This product is in no open database — the details were
          typed in from the pack by someone using this app, and have not been verified. Check it
          against the label in your hand.
        </div>
      )}

      {/* Directly under the scores — this is the moment a number is read as a
          verdict, so it is where the qualification belongs. */}
      <Disclaimer t={t}/>
      <div style={{height:12}}/>

      {/* ── For you ──
          Placed above the population scores on purpose. A general 8/10 is not
          the answer for someone the product can actually harm, and an "organic"
          badge is a farming claim, not a tolerability one. */}
      <div style={{...box, borderColor: ratings.personal?.hits?.length ? "#c0392b55" : t.border}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{...sHdr,color:t.textSub,marginBottom:0,flex:1}}>For you</div>
          <button onClick={() => setProfileOpen(o => !o)}
            style={{fontSize:10,fontWeight:600,padding:"4px 9px",borderRadius:6,cursor:"pointer",
              background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>
            {profileOpen ? "Done" : profile.length ? `${profile.length} set` : "Set sensitivities"}
          </button>
        </div>

        {!profileOpen && !ratings.personal?.checked && (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6}}>
            Tell the app what you react to and it will check every product against it.
            Kept on this device only — never uploaded.
          </div>
        )}

        {/* The most important state in the app. With no ingredient list there is
            nothing to match a profile against, and saying "nothing matches"
            would read as a clearance for a product nobody has examined. */}
        {!profileOpen && ratings.personal?.checked && ratings.personal.insufficientData && (
          <div style={{fontSize:11,color:"#c0392b",lineHeight:1.6,background:"rgba(192,57,43,0.07)",
            border:"1px solid rgba(192,57,43,0.35)",borderRadius:8,padding:"10px 12px"}}>
            <strong>Cannot check this product.</strong> There is no ingredient list on record, so
            nothing was compared against your profile. This is <em>not</em> a clearance — a product
            with no data can still contain exactly what you are avoiding.
            <button onClick={onAddIngredients}
              style={{display:"block",marginTop:8,padding:"8px 12px",fontSize:11,fontWeight:600,
                borderRadius:7,background:"#c0392b",color:"#fff",border:"none",cursor:"pointer"}}>
              Add the ingredient list from the pack
            </button>
          </div>
        )}

        {!profileOpen && ratings.personal?.checked && ratings.personal.clear && !ratings.health?.length && (
          <div style={{fontSize:11,color:"#2e7d52",lineHeight:1.6}}>
            Nothing here matches your declared conditions or sensitivities.
            <span style={{color:t.textMuted}}> Based on the listed ingredients — an incomplete list can still hide something.</span>
          </div>
        )}

        {!profileOpen && ratings.health?.map(h => (
          <div key={h.key} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:7}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",
              background:h.level==="high"?"#c0392b":"#d97706",padding:"3px 6px",borderRadius:4,marginTop:1}}>
              {h.short}
            </span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{h.label}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{h.detail}</div>
            </div>
          </div>
        ))}

        {!profileOpen && ratings.personal?.hits?.map(h => (
          <div key={h.key} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:7}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:"#c0392b",padding:"3px 6px",borderRadius:4,marginTop:1}}>FOR YOU</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{h.label}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{h.note} Found: {h.matched.join(", ")}.</div>
            </div>
          </div>
        ))}

        {!profileOpen && ratings.personal?.misleadingClaim && (
          <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:6,borderTop:`1px solid ${t.border}`,paddingTop:7}}>
            This product carries an organic or natural claim. That describes how it was
            produced, not whether you can tolerate it — the match above still applies.
          </div>
        )}

        {profileOpen && (
          <>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              Select what you react to. This changes what you are warned about; it never
              changes the product's score for anyone else.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {Object.entries(SENSITIVITY_GROUPS).map(([key, g]) => {
                const on = profile.includes(key);
                return (
                  <button key={key} onClick={() => toggleSensitivity(key)} title={g.note}
                    style={{fontSize:10,fontWeight:600,padding:"6px 10px",borderRadius:7,cursor:"pointer",
                      background:on?"#c0392b":t.pill, color:on?"#fff":t.textSub,
                      border:`1px solid ${on?"#c0392b":t.border}`}}>
                    {g.label}
                  </button>
                );
              })}
            </div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:8,lineHeight:1.6}}>
              Not medical advice, and not a substitute for reading the pack. If you have a
              diagnosed allergy, treat the physical label as the authority.
            </div>
          </>
        )}
      </div>

      {/* ── CSPI breakdown ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>CSPI Chemical Cuisine</div>
        {safety.rated.length === 0 && safety.unrated.length === 0 && (
          <div style={{fontSize:11,color:t.textSub}}>No additives listed for this product.</div>
        )}
        {(safety.rated || []).map(r => (
          <div key={r.additive} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:TIER_COLOR[r.tier]||"#777",padding:"3px 6px",borderRadius:4,marginTop:1}}>
              {CSPI_TIERS[r.tier]?.short || "Unrated"}
            </span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{r.name}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{r.why}</div>
            </div>
          </div>
        ))}
        {(safety.unrated || []).length > 0 && (
          <div style={{fontSize:10,color:t.textMuted,marginTop:8,lineHeight:1.6,borderTop:`1px solid ${t.border}`,paddingTop:8}}>
            Not in the curated CSPI subset, so not scored either way: {safety.unrated.join(", ")}.
            Coverage {Math.round(safety.coverage * 100)}% — an unrated additive is unknown, not cleared.
          </div>
        )}
      </div>

      {/* ── Reader-reported composition ── */}
      {ratings.reported?.count > 0 && (
        <div style={{...box, borderColor:"#d9770655"}}>
          <div style={{...sHdr,color:t.textSub}}>Reported by readers · unverified</div>
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6,marginBottom:8}}>
            Readers say these appear on the physical label but are missing from the source
            data. They are <strong>not</strong> counted in the score above.
          </div>
          {ratings.reported.reported.map(r => (
            <div key={r.additive} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6}}>
              <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:TIER_COLOR[r.tier]||"#777",padding:"3px 6px",borderRadius:4,marginTop:1}}>
                {CSPI_TIERS[r.tier]?.short || "Unrated"}
              </span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,fontWeight:600,color:t.text}}>{r.name}</div>
                <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{r.why}</div>
              </div>
            </div>
          ))}
          <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:8,borderTop:`1px solid ${t.border}`,paddingTop:8}}>
            If confirmed, the safety score would be {ratings.reported.wouldBe}/10 instead of {ratings.reported.current}/10.
            Shown so you can judge it yourself — one reader's transcription does not re-rate a
            product for everyone.
          </div>
        </div>
      )}

      {/* ── Expert accolades ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>Expert scores &amp; awards</div>
        {expert.count === 0 ? (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6}}>
            None recorded. Competition medals, critic scores and lab results have no
            open API — they are curated entries in the shared database, added by hand
            with a source. Nothing here is generated.
          </div>
        ) : (
          <>
            {expert.items.map((a, i) => (
              <div key={i} style={{display:"flex",gap:8,alignItems:"baseline",marginBottom:5}}>
                <span style={{fontSize:12,fontWeight:700,color:scoreColor(a.normalized.value),minWidth:26}}>{a.normalized.value}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,color:t.text}}>{a.name || a.sourceLabel} {a.year ? `(${a.year})` : ""}</div>
                  <div style={{fontSize:9,color:t.textMuted}}>{a.sourceLabel} · original “{a.normalized.raw}” · {a.normalized.note}</div>
                </div>
              </div>
            ))}
            {expert.thin && (
              <div style={{fontSize:9,color:t.textMuted,marginTop:6,lineHeight:1.6}}>
                Fewer than three sources — treat as indicative, not a verdict.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Freshness ── */}
      {freshness && (
        <div style={{...box, display:"flex", gap:10, alignItems:"center",
                     borderColor: freshness.stale ? "#d9770655" : t.border}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,fontWeight:600,color:t.text}}>
              {!freshness.known ? "Source date unknown"
                : freshness.days === 0 ? "Read from source today"
                : `Read from source ${freshness.days} day${freshness.days !== 1 ? "s" : ""} ago`}
            </div>
            <div style={{fontSize:9,color:t.textMuted,lineHeight:1.6,marginTop:2}}>
              {/* Reformulations happen. A rating is only as current as the data
                  behind it, so the read date is shown rather than implied. */}
              Ratings are computed from the source data at that date. Recipes change —
              refresh to re-read and re-rate.
            </div>
          </div>
          <button onClick={onRefresh} disabled={refreshing}
            style={{flexShrink:0,fontSize:11,fontWeight:600,padding:"7px 12px",borderRadius:7,
              background:freshness.stale?"#d97706":t.pill, color:freshness.stale?"#fff":t.textSub,
              border:`1px solid ${freshness.stale?"#d97706":t.border}`,
              cursor:refreshing?"default":"pointer",opacity:refreshing?0.6:1}}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      {/* ── Add product details ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub,marginBottom:6}}>Add product details</div>
        {contributions?.length > 0 && (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6,marginBottom:8}}>
            {contributions.length} contribution{contributions.length!==1?"s":""} from readers.
            Community-supplied and unverified — they fill gaps in the source data, never overwrite it.
          </div>
        )}
        {!detailsOpen ? (
          <button onClick={() => setDetailsOpen(true)}
            style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
              background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>
            Something missing or wrong? Add details
          </button>
        ) : (
          <>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              {ingredientsFocus
                ? "Copy the ingredient list exactly as printed on the pack. This is what the profile check reads, so it changes the verdict for you and for everyone who scans this product afterwards."
                : "Copy from the physical label. Reported additives are shown separately as unverified; the other fields are stored for other readers."}
            </div>
            {[["ingredients","Full ingredient list from the pack","textarea"],
              ["additives","Additives / E-numbers on the label (comma separated)","input"],
              ["quantity","Pack size, e.g. 500 g","input"],
              ["category","Category, e.g. greek yogurt","input"],
              ["note","Anything else worth knowing","textarea"]].map(([key,ph,kind]) => (
              kind === "textarea" ? (
                <textarea key={key} rows={2} value={myDetails[key]} placeholder={ph}
                  onChange={e => setMyDetails(d => ({...d, [key]: e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,
                    border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",
                    fontFamily:"inherit",marginBottom:6}}/>
              ) : (
                <input key={key} value={myDetails[key]} placeholder={ph}
                  onChange={e => setMyDetails(d => ({...d, [key]: e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,
                    border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:6}}/>
              )
            ))}
            <div style={{display:"flex",gap:6}}>
              <button onClick={ingredientsFocus ? onSaveIngredients : onSubmitDetails}
                style={{flex:1,padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.accent,color:t.accentFg,border:"none"}}>
                {ingredientsFocus ? "Save and re-check against my profile" : "Save details"}
              </button>
              <button onClick={() => setDetailsOpen(false)}
                style={{padding:"9px 14px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>Cancel</button>
            </div>
          </>
        )}
      </div>

      {/* ── Community ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>Customer reviews</div>
        {community.count > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,color:t.text,marginBottom:4}}>
              {community.average}/5 from {community.count} review{community.count!==1?"s":""}
              {community.thin && <span style={{color:t.textMuted}}> · too few to be representative</span>}
            </div>
            {community.reports.length > 0 && (
              <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:5}}>
                Unverified substance reports: {community.reports.map(r => `${r.substance} (${r.count})`).join(", ")}.
                These are reader claims awaiting confirmation and do not affect the safety score.
              </div>
            )}
          </div>
        )}
        <div style={{display:"flex",gap:5,marginBottom:8}}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setMyStars(n)}
              style={{flex:1,padding:"7px 0",fontSize:13,borderRadius:7,cursor:"pointer",
                background:n<=myStars?"#d97706":t.pill,color:n<=myStars?"#fff":t.textSub,
                border:`1px solid ${n<=myStars?"#d97706":t.border}`,fontWeight:600}}>★</button>
          ))}
        </div>
        <textarea value={myReview} onChange={e => setMyReview(e.target.value)} rows={2} maxLength={500}
          placeholder="What did you think? (optional)"
          style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",fontFamily:"inherit",marginBottom:6}}/>
        <input value={myReport} onChange={e => setMyReport(e.target.value)}
          placeholder="Ingredient on the label but missing from the data? (comma separated)"
          style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:8}}/>
        <button onClick={onSubmit} disabled={!myStars}
          style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:myStars?"pointer":"default",
            background:myStars?t.accent:t.pill,color:myStars?t.accentFg:t.textMuted,border:"none"}}>
          {myStars ? "Save review to shared database" : "Pick a rating first"}
        </button>
        <div style={{fontSize:9,color:t.textMuted,marginTop:7,lineHeight:1.6}}>
          One review per device; saving again replaces your previous one. Reviews are
          public. Substance reports are counted and shown as unverified — they are a
          prompt to check the label, not a change to the rating.
        </div>
      </div>
    </div>
  );
}

// A single disclaimer component, used everywhere a product judgement is shown.
// One definition rather than several copies, so the wording cannot drift apart
// between the result card, the alternatives list and the browse results.
//
// Deliberately domain-neutral: this app covers food and cosmetics, and the same
// point holds for both. A "100% pure", "vegan" or "organic" label describes how
// something was made, not whether it suits the person reading — pure essential
// oils burn skin, and organic wine still puts asthmatics in hospital.

export { RatingsPanel };
