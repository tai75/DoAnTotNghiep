import { Component } from 'react'

export default class RouteErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Không thể tải giao diện:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="route-error" role="alert">
      <h1>Không thể tải trang</h1>
      <p>Kết nối có thể đã gián đoạn khi tải giao diện. Vui lòng thử lại.</p>
      <button type="button" onClick={() => window.location.reload()}>Tải lại trang</button>
    </main>
  }
}
