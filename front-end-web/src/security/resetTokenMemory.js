let resetToken = null

function cleanResetUrl(location) {
  const query = new URLSearchParams(location.search)
  query.delete('token')
  const search = query.toString()
  const hash = location.hash.startsWith('#token=') ? '' : location.hash
  return `${location.pathname}${search ? `?${search}` : ''}${hash}`
}

export function captureResetTokenFromLocation(location = window.location, history = window.history) {
  if (location.pathname !== '/reset-password') return resetToken
  const queryToken = new URLSearchParams(location.search).get('token')
  const hashToken = location.hash.startsWith('#token=')
    ? new URLSearchParams(location.hash.slice(1)).get('token')
    : null
  const captured = hashToken || queryToken
  if (captured) resetToken = captured
  if (queryToken || hashToken) history.replaceState(history.state, '', cleanResetUrl(location))
  return resetToken
}

export function getResetToken() {
  return resetToken
}

export function clearResetToken() {
  resetToken = null
}
