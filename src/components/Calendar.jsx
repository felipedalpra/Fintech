import { useMemo, useState, useRef, useEffect } from 'react'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { Card } from './UI.jsx'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

function buildCalendarGrid(year, month) {
  // month is 0-indexed
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  // leading empty cells
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // trailing empty cells to complete last row
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function pad(n) { return String(n).padStart(2, '0') }

export function Calendar({ data }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const navBtn = { background:'transparent', border:`1px solid ${C.border}`, color:C.textSub, width:36, height:36, borderRadius:10, cursor:'pointer', fontSize:22, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit', lineHeight:1 }
  const [popover, setPopover] = useState(null) // { day, events, rect }
  const popoverRef = useRef(null)

  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const eventsByDay = useMemo(() => {
    const map = {}
    const monthStr = `${year}-${pad(month + 1)}`

    ;(data.surgeries || []).forEach(item => {
      if (!item.date || !item.date.startsWith(monthStr)) return
      const day = parseInt(item.date.slice(8, 10), 10)
      if (!map[day]) map[day] = []
      const procName = (data.procedures || []).find(p => p.id === item.procedureId)?.name || 'Cirurgia'
      map[day].push({
        type:'surgery',
        label:`${item.patient || 'Paciente'} — ${procName}`,
        value:item.totalValue || 0,
        id:item.id,
      })
    })

    ;(data.consultations || []).forEach(item => {
      if (!item.date || !item.date.startsWith(monthStr)) return
      const day = parseInt(item.date.slice(8, 10), 10)
      if (!map[day]) map[day] = []
      map[day].push({
        type:'consultation',
        label:`${item.patient || 'Paciente'} — ${item.consultationType || 'Consulta'}`,
        value:item.value || 0,
        id:item.id,
      })
    })

    return map
  }, [data, year, month])

  const grid = useMemo(() => buildCalendarGrid(year, month), [year, month])

  const goBack = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
    setPopover(null)
  }
  const goForward = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
    setPopover(null)
  }

  const handleDayClick = (day, e) => {
    if (!day) return
    const events = eventsByDay[day] || []
    if (events.length === 0) { setPopover(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setPopover({ day, events, rect })
  }

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setPopover(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popover])

  const surgeryCount = Object.values(eventsByDay).reduce((acc, arr) => acc + arr.filter(e => e.type === 'surgery').length, 0)
  const consultationCount = Object.values(eventsByDay).reduce((acc, arr) => acc + arr.filter(e => e.type === 'consultation').length, 0)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Legend + summary */}
      <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ width:10, height:10, borderRadius:'50%', background:C.accent, display:'inline-block', flexShrink:0 }} />
          <span style={{ fontSize:12, color:C.textSub }}>{surgeryCount} cirurgia{surgeryCount !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ width:10, height:10, borderRadius:'50%', background:C.cyan, display:'inline-block', flexShrink:0 }} />
          <span style={{ fontSize:12, color:C.textSub }}>{consultationCount} consulta{consultationCount !== 1 ? 's' : ''}</span>
        </div>
        <span style={{ fontSize:11, color:C.textDim, marginLeft:'auto' }}>Clique em um dia para ver os eventos</span>
      </div>

      <Card style={{ padding:0, overflow:'hidden', position:'relative' }}>
        {/* Header: month/year + navigation */}
        <div style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          padding:'18px 20px',
          borderBottom:`1px solid ${C.border}`,
          background:`linear-gradient(135deg, ${C.surface}, ${C.card})`,
        }}>
          <button onClick={goBack} style={navBtn}>‹</button>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:800, color:C.text, letterSpacing:'-0.02em' }}>
              {MONTHS_PT[month]} {year}
            </div>
            <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
              {surgeryCount + consultationCount} evento{(surgeryCount + consultationCount) !== 1 ? 's' : ''} neste mês
            </div>
          </div>
          <button onClick={goForward} style={navBtn}>›</button>
        </div>

        {/* Day-of-week headers */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:`1px solid ${C.border}` }}>
          {WEEKDAYS.map(wd => (
            <div key={wd} style={{
              padding:'10px 4px',
              textAlign:'center',
              fontSize:11,
              fontWeight:700,
              color:C.textDim,
              textTransform:'uppercase',
              letterSpacing:'0.06em',
            }}>{wd}</div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
          {grid.map((day, idx) => {
            const dateStr = day ? `${year}-${pad(month + 1)}-${pad(day)}` : null
            const isToday = dateStr === todayStr
            const dayEvents = day ? (eventsByDay[day] || []) : []
            const hasSurgery = dayEvents.some(e => e.type === 'surgery')
            const hasConsultation = dayEvents.some(e => e.type === 'consultation')
            const isPopoverDay = popover && popover.day === day

            return (
              <div
                key={idx}
                onClick={e => handleDayClick(day, e)}
                style={{
                  minHeight:72,
                  padding:'8px 6px',
                  borderRight:`1px solid ${C.border}`,
                  borderBottom:`1px solid ${C.border}`,
                  cursor: dayEvents.length > 0 ? 'pointer' : day ? 'default' : 'default',
                  background: isPopoverDay
                    ? C.accent + '18'
                    : isToday
                    ? C.accent + '10'
                    : day ? 'transparent' : C.bg + '44',
                  transition:'background 0.15s',
                  position:'relative',
                }}
                onMouseEnter={e => { if (day && dayEvents.length > 0) e.currentTarget.style.background = C.accent + '14' }}
                onMouseLeave={e => {
                  if (!isPopoverDay) e.currentTarget.style.background = isToday ? C.accent + '10' : day ? 'transparent' : C.bg + '44'
                }}
              >
                {day && (
                  <>
                    <div style={{
                      fontSize:13,
                      fontWeight: isToday ? 800 : 500,
                      color: isToday ? C.accent : C.text,
                      width:24,
                      height:24,
                      borderRadius:'50%',
                      display:'flex',
                      alignItems:'center',
                      justifyContent:'center',
                      background: isToday ? C.accent + '20' : 'transparent',
                      border: isToday ? `1px solid ${C.accent}44` : 'none',
                      marginBottom:4,
                    }}>{day}</div>
                    {/* Event dots */}
                    {(hasSurgery || hasConsultation) && (
                      <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:2 }}>
                        {hasSurgery && (
                          <span style={{
                            width:7,
                            height:7,
                            borderRadius:'50%',
                            background:C.accent,
                            display:'inline-block',
                            boxShadow:`0 0 4px ${C.accent}88`,
                          }} title="Cirurgia" />
                        )}
                        {hasConsultation && (
                          <span style={{
                            width:7,
                            height:7,
                            borderRadius:'50%',
                            background:C.cyan,
                            display:'inline-block',
                            boxShadow:`0 0 4px ${C.cyan}88`,
                          }} title="Consulta" />
                        )}
                        {dayEvents.length > 1 && (
                          <span style={{ fontSize:9, color:C.textDim, lineHeight:'8px', marginTop:1 }}>
                            {dayEvents.length}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Popover panel */}
      {popover && (
        <div ref={popoverRef}>
          <Card style={{
            border:`1px solid ${C.borderBright}`,
            background:C.card,
            boxShadow:'0 8px 40px rgba(0,0,0,0.55)',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:C.text }}>
                  {pad(popover.day)} de {MONTHS_PT[month]} de {year}
                </div>
                <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                  {popover.events.length} evento{popover.events.length !== 1 ? 's' : ''}
                </div>
              </div>
              <button
                onClick={() => setPopover(null)}
                style={{
                  background:C.border,
                  border:'none',
                  color:C.textSub,
                  width:28,
                  height:28,
                  borderRadius:8,
                  cursor:'pointer',
                  fontSize:16,
                  display:'flex',
                  alignItems:'center',
                  justifyContent:'center',
                  fontFamily:'inherit',
                }}
              >×</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {popover.events.map(ev => (
                <div key={ev.id} style={{
                  display:'flex',
                  gap:10,
                  alignItems:'flex-start',
                  padding:'10px 12px',
                  borderRadius:10,
                  background: ev.type === 'surgery' ? C.accent + '10' : C.cyan + '10',
                  border:`1px solid ${ev.type === 'surgery' ? C.accent : C.cyan}22`,
                }}>
                  <span style={{
                    width:8,
                    height:8,
                    borderRadius:'50%',
                    background:ev.type === 'surgery' ? C.accent : C.cyan,
                    flexShrink:0,
                    marginTop:4,
                  }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:C.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {ev.label}
                    </div>
                    <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                      {ev.type === 'surgery' ? 'Cirurgia' : 'Consulta'}
                      {ev.value > 0 && <span style={{ color:C.green, marginLeft:8, fontWeight:700 }}>{fmt(ev.value)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
