export function BrandLogo({ size = 'md', showWordmark = true, dark = false }) {
  void dark
  const heights = size === 'sm' ? 42 : size === 'lg' ? 74 : 56
  const iconWidth = Math.round(heights * 1.1)

  return (
    <div style={{ display:'inline-flex', alignItems:'center', lineHeight:0 }}>
      {showWordmark ? (
        <img
          src="/assets/surgimetrics-logo.png"
          alt="SurgiMetrics"
          style={{ width:'auto', height:heights, objectFit:'contain', display:'block' }}
        />
      ) : (
        <div style={{ width:iconWidth, height:heights, overflow:'hidden', display:'inline-flex', alignItems:'center' }}>
          <img
            src="/assets/surgimetrics-logo.png"
            alt="SurgiMetrics"
            style={{ width:'auto', height:heights, objectFit:'contain', display:'block' }}
          />
        </div>
      )}
    </div>
  )
}
