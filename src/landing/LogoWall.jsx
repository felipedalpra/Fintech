const CLINICS = [
  { name:'Dra. Michelle Brys', city:'RS' },
  { name:'Instituto Plástica Rio', city:'RJ' },
  { name:'Dr. Henrique Voss', city:'SP' },
  { name:'Centro Clínico Bellaforma', city:'SP' },
  { name:'Dra. Fernanda Alves', city:'MG' },
  { name:'Instituto Corpo & Arte', city:'RS' },
  { name:'Clínica Vitória Plástica', city:'BA' },
  { name:'Dr. Ricardo Tavares', city:'DF' },
  { name:'Clínica Lumina', city:'RJ' },
  { name:'Dr. Marcos Bittencourt', city:'SC' },
  { name:'Clínica Renova', city:'SP' },
  { name:'Dra. Camila Fontes', city:'CE' },
]

const DOUBLED = [...CLINICS, ...CLINICS]

export function LogoWall() {
  return (
    <section style={{ padding:'0 0 60px', overflow:'hidden' }}>
      <div className="reveal" style={{ marginBottom:20, textAlign:'center' }}>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.35)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em' }}>
          Clínicas que já usam o SurgiMetrics
        </div>
      </div>

      <div style={{ position:'relative' }}>
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:80, background:'linear-gradient(90deg, #07131f, transparent)', zIndex:2, pointerEvents:'none' }} />
        <div style={{ position:'absolute', right:0, top:0, bottom:0, width:80, background:'linear-gradient(270deg, #07131f, transparent)', zIndex:2, pointerEvents:'none' }} />

        <div style={{ display:'flex', gap:12, animation:'marqueeScroll 28s linear infinite', width:'max-content' }}>
          {DOUBLED.map((clinic, i) => (
            <div
              key={`${clinic.name}-${i}`}
              style={{
                display:'flex',
                alignItems:'center',
                gap:8,
                padding:'10px 18px',
                borderRadius:999,
                border:'1px solid rgba(255,255,255,0.1)',
                background:'rgba(255,255,255,0.04)',
                whiteSpace:'nowrap',
                flexShrink:0,
              }}
            >
              <div style={{ width:7, height:7, borderRadius:'50%', background:'rgba(94,234,212,0.7)', flexShrink:0 }} />
              <span style={{ fontSize:13, fontWeight:700, color:'#C8DDE6' }}>{clinic.name}</span>
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.3)', fontWeight:600 }}>{clinic.city}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
