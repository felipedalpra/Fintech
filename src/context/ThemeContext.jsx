import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { applyTheme, getStoredTheme } from '../theme.js'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(getStoredTheme())

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  const value = useMemo(() => ({
    mode,
    isLight:mode === 'light',
    setTheme:setMode,
    toggleTheme() {
      setMode(current => current === 'light' ? 'dark' : 'light')
    },
  }), [mode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
