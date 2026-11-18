import { useCallback, useEffect, useMemo, useState } from 'react'
import { authApi, setAccessToken, setUnauthorizedHandler } from '../services/api'
import { AuthContext } from './auth'
import { endCurrentSession } from './logoutSession'

let restoreSessionPromise = null

function restoreSession() {
  if (!restoreSessionPromise) {
    restoreSessionPromise = authApi.refresh().finally(() => {
      restoreSessionPromise = null
    })
  }
  return restoreSessionPromise
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [logoutFailure, setLogoutFailure] = useState(null)

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setSession(null)
  }, [])

  useEffect(() => {
    let active = true
    setUnauthorizedHandler(clearSession)
    restoreSession()
      .then(({ user, token }) => {
        if (!active) return
        setAccessToken(token)
        setSession({ user })
      })
      .catch(() => {
        if (active) clearSession()
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
      setUnauthorizedHandler(null)
    }
  }, [clearSession])

  const login = useCallback(async (payload, isRegister = false) => {
    const data = isRegister ? await authApi.register(payload) : await authApi.login(payload)
    setLogoutFailure(null)
    setAccessToken(data.token)
    setSession({ user: data.user })
    return data.user
  }, [])

  const logout = useCallback(async () => {
    const result = await endCurrentSession({
      hasSession: Boolean(session),
      logoutRequest: authApi.logout,
      clearSession
    })
    setLogoutFailure(result.ok ? null : result)
    return result
  }, [clearSession, session])

  const updateSessionUser = useCallback((user) => {
    setSession((current) => current ? { ...current, user: { ...current.user, ...user } } : current)
  }, [])

  const value = useMemo(() => ({
    session,
    isLoading,
    logoutFailure,
    login,
    logout,
    clearSession,
    updateSessionUser
  }), [session, isLoading, logoutFailure, login, logout, clearSession, updateSessionUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
