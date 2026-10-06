import { Link } from 'react-router-dom'
import { C } from '../theme.js'
import { useTheme } from '../context/ThemeContext.jsx'
import { BrandLogo } from './BrandLogo.jsx'

export const CONTACT_LINK = 'https://wa.me/5551991897471'
export const CONTACT_LABEL = 'WhatsApp (51) 99189-7471'

export function LegalPage({ title, updatedAt, sections, contactTitle, contactIntro }) {
  useTheme()

  const heading = { fontSize:20, fontWeight:700, color:C.text, margin:'36px 0 12px' }
  const paragraph = { fontSize:15, lineHeight:1.75, color:C.textSub, margin:'0 0 12px' }
  const list = { ...paragraph, paddingLeft:22 }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, color:C.text, fontFamily:'inherit' }}>
      <header style={{ borderBottom:`1px solid ${C.border}`, padding:'12px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <Link to="/" aria-label="SurgiMetrics - página inicial"><BrandLogo size="sm" /></Link>
        <Link to="/" style={{ color:C.accentLight, fontSize:14, textDecoration:'none' }}>Voltar ao site</Link>
      </header>

      <main style={{ maxWidth:780, margin:'0 auto', padding:'48px 24px 80px' }}>
        <h1 style={{ fontSize:34, fontWeight:800, margin:'0 0 8px', color:C.text }}>{title}</h1>
        <p style={{ ...paragraph, color:C.textDim }}>Última atualização: {updatedAt}</p>

        {sections.map(section => (
          <section key={section.title}>
            <h2 style={heading}>{section.title}</h2>
            {section.body?.map(text => <p key={text} style={paragraph}>{text}</p>)}
            {section.list && (
              <ul style={list}>
                {section.list.map(item => <li key={item} style={{ marginBottom:6 }}>{item}</li>)}
              </ul>
            )}
            {section.after && <p style={paragraph}>{section.after}</p>}
          </section>
        ))}

        <section>
          <h2 style={heading}>{contactTitle}</h2>
          <p style={paragraph}>
            {contactIntro}{' '}
            <a href={CONTACT_LINK} target="_blank" rel="noreferrer" style={{ color:C.accentLight }}>{CONTACT_LABEL}</a>.
          </p>
        </section>
      </main>
    </div>
  )
}
