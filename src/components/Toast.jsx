// ─── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ items, onDismiss, t }) {
  const colors = { off:"#2e7d52", high:"#c0392b", medium:"#b07d2b", sugar:"#3d6b99", cache:"#6b7cff", shared:"#3d52c4", database:"#2e7d52", scan:"#3d52c4", undeclared:"#c0392b", brand:"#8a3a1a" };
  const labels = { off:"Open Food Facts", high:"High Risk", medium:"Medium Risk", sugar:"Sugar Alert", cache:"Cached", shared:"Shared DB", database:"GitHub DB", scan:"AI Scan", undeclared:"Undeclared Substance", brand:"Brand Alert" };
  return (
    <div style={{position:"fixed",top:16,right:16,zIndex:9999,display:"flex",flexDirection:"column",gap:8,maxWidth:340,pointerEvents:"none"}}>
      {items.map(n => {
        const c = colors[n.type] || colors.scan;
        return (
          <div key={n.id} style={{background:t.surface,borderLeft:`3px solid ${c}`,border:`1px solid ${t.border}`,borderRadius:8,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start",boxShadow:"0 4px 24px rgba(0,0,0,0.12)",animation:"slideIn 0.28s ease",pointerEvents:"all"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:600,color:c,marginBottom:3}}>{labels[n.type] || "Info"}</div>
              <div style={{fontSize:12,color:t.textSub,lineHeight:1.5}}>{n.message}</div>
            </div>
            <button onClick={() => onDismiss(n.id)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>×</button>
          </div>
        );
      })}
    </div>
  );
}


export { Toast };
