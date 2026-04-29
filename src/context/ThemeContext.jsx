import { createContext, useContext, useMemo, useState } from 'react'
import { applyTheme, getStoredTheme } from '../theme.js'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(getStoredTheme())

  const value = useMemo(() => ({
    mode,
    isLight: mode === 'light',
    setTheme(next) {
      applyTheme(next)
      setMode(next)
    },
    toggleTheme() {
      const next = mode === 'light' ? 'dark' : 'light'
      applyTheme(next)
      setMode(next)
    },
  }), [mode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
