import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { FinancialPrivacyProvider } from './context/FinancialPrivacyContext.jsx'
import { BillingProvider } from './context/BillingContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <FinancialPrivacyProvider>
          <AuthProvider>
            <BillingProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </BillingProvider>
          </AuthProvider>
        </FinancialPrivacyProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
