const ROLE_HOME = { CANDIDATE: '/jobs', RECRUITER: '/recruiter', ADMIN: '/admin' }

export function getRolePath(role) {
  return ROLE_HOME[role] || '/jobs'
}

function canVisit(path, role) {
  if (path === '/' || path === '/jobs' || /^\/jobs\/[^/]+$/.test(path)
    || path === '/companies' || /^\/companies\/[^/]+$/.test(path)
    || path === '/settings') return true
  if (role === 'ADMIN') return path === '/admin' || path.startsWith('/admin/')
  if (role === 'RECRUITER') return path === '/recruiter' || path.startsWith('/recruiter/') || path === '/messages'
  if (role === 'CANDIDATE') {
    return ['/recommendations', '/profile', '/alerts', '/my-jobs', '/applications', '/saved-jobs', '/messages', '/invitations', '/interviews'].includes(path)
      || /^\/(invitations|interviews)\/[^/]+$/.test(path)
  }
  return false
}

export function getPostAuthDestination(role, returnTo) {
  const fallback = getRolePath(role)
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')
    || /[\\\x00-\x1f\x7f]/.test(returnTo)) return fallback
  try {
    const url = new URL(returnTo, 'http://job-connect.local')
    if (url.origin !== 'http://job-connect.local' || !canVisit(url.pathname, role)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
