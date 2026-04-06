export function BrandLogo({ size = 'md', showWordmark = true, dark = false }) {
  void dark
  const dimensions = size === 'sm'
    ? { width:150, height:42 }
    : size === 'lg'
      ? { width:260, height:74 }
      : { width:200, height:56 }

  return (
    <div style={{ display:'inline-flex', alignItems:'center' }}>
      <img
        src="/assets/surgimetrics-logo.png"
        alt="SurgiMetrics"
        style={{
          width:showWordmark ? dimensions.width : Math.round(dimensions.height * 1.2),
          height:dimensions.height,
          objectFit:'contain',
          display:'block',
        }}
      />
    </div>
  )
}
