// ─── FOOD ILLUSTRATION ─────────────────────────────────────────────────────────
function FoodBg() {
  const items = [
    {x:8,y:12,s:2.2,r:-15,e:"🥦"},{x:78,y:8,s:1.8,r:20,e:"🍎"},{x:45,y:5,s:2.0,r:0,e:"🥕"},
    {x:18,y:72,s:2.4,r:10,e:"🍋"},{x:85,y:65,s:2.1,r:-20,e:"🫐"},{x:62,y:78,s:1.9,r:15,e:"🧄"},
    {x:32,y:85,s:2.3,r:-8,e:"🥑"},{x:90,y:30,s:1.7,r:25,e:"🍊"},{x:5,y:45,s:1.6,r:-30,e:"🌽"},
    {x:55,y:90,s:2.0,r:12,e:"🍓"},{x:72,y:48,s:1.5,r:-18,e:"🥝"},{x:24,y:33,s:1.8,r:22,e:"🫑"},
    {x:48,y:58,s:1.4,r:-5,e:"🍇"},{x:88,y:85,s:1.6,r:18,e:"🧅"},{x:15,y:88,s:1.7,r:-12,e:"🥐"},
  ];
  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",userSelect:"none"}}>
      {items.map((it, i) => (
        <div key={i} style={{
          position:"absolute", left:`${it.x}%`, top:`${it.y}%`,
          fontSize:`${it.s}rem`, transform:`rotate(${it.r}deg)`,
          opacity:0.07, filter:"grayscale(100%)",
          animation:`foodFloat ${3+i*0.4}s ease-in-out ${i*0.3}s infinite alternate`,
        }}>{it.e}</div>
      ))}
    </div>
  );
}


export { FoodBg };
