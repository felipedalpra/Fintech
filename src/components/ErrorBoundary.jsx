import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset() {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
        padding: 32,
        background: '#0B1020',
        color: '#E2E8F0',
        fontFamily: 'inherit',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36 }}>⚠</div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Algo deu errado</h2>
        <p style={{ margin: 0, color: '#94A3B8', fontSize: 14, maxWidth: 400 }}>
          Ocorreu um erro inesperado. Tente recarregar a página.
        </p>
        {this.state.error?.message && (
          <pre style={{
            background: '#1E293B',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 12,
            color: '#F87171',
            maxWidth: 480,
            overflowX: 'auto',
            textAlign: 'left',
          }}>
            {this.state.error.message}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={() => this.handleReset()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#94A3B8',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            Tentar novamente
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#6366F1',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Recarregar página
          </button>
        </div>
      </div>
    )
  }
}
