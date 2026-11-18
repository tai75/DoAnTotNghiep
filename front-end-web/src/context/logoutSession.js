export async function endCurrentSession({ hasSession, logoutRequest, clearSession }) {
  if (!hasSession) {
    clearSession()
    return { ok: true, kind: 'local' }
  }

  try {
    await logoutRequest()
    clearSession()
    return { ok: true, kind: 'server' }
  } catch (error) {
    return { ok: false, kind: error?.isNetworkError ? 'network' : 'server', error }
  }
}
