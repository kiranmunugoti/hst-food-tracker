import { fmt, tlColor } from "../lib/theme.js";

function NRow({ label, val100, valSrv, unit, ri, bold, indent, type, hasSrv, t }) {
  if (val100 == null && valSrv == null) return null;
  const pct = ri && val100 != null ? Math.round((val100 / ri) * 100) : null;
  const col = type ? tlColor(type, val100) : (t?.text || "#1a1917");
  return (
    <tr style={{borderBottom:`1px solid ${t?.tableBorder||"#eee"}`}}>
      <td style={{padding:indent?"5px 12px 5px 26px":"8px 12px",fontSize:indent?11:12.5,color:t?.text||"#1a1917",fontWeight:bold?600:400}}>
        {indent && <span style={{color:t?.textMuted,marginRight:5}}>—</span>}{label}
      </td>
      <td style={{padding:"8px 12px",fontSize:12.5,fontWeight:bold?600:500,color:col,textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>
        {val100 != null ? `${fmt(val100)}${unit}` : "—"}
      </td>
      {hasSrv && <td style={{padding:"8px 12px",fontSize:11.5,color:t?.textSub||"#6b6760",textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>{valSrv != null ? `${fmt(valSrv)}${unit}` : "—"}</td>}
      <td style={{padding:"8px 12px",fontSize:11,color:type?col:(t?.textMuted||"#aaa"),textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>{pct != null ? `${pct}%` : ""}</td>
    </tr>
  );
}

// parseOFF stores nutrients under short names; the condition checks use OFF's
// per-100g keys. Mapping here rather than renaming either side, because both
// names are load-bearing elsewhere. Without this every threshold check reads
// undefined and silently never fires — a failure that looks like "no alerts".
function nutFor(nut = {}) {
  return {
    "sugars_100g":        nut.sugars,
    "saturated-fat_100g": nut.saturated,
    "fat_100g":           nut.fat,
    "salt_100g":          nut.salt,
    "sodium_100g":        nut.sodium,
    "carbohydrates_100g": nut.carbs,
    "fiber_100g":         nut.fiber,
    "proteins_100g":      nut.protein,
    "energy-kcal_100g":   nut.energy_kcal,
  };
}


export { NRow, nutFor };
