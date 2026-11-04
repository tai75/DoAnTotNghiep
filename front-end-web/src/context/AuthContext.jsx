import { useCallback, useEffect, useMemo, useState } from 'react'
import { authApi, setAccessToken, setUnauthorizedHandler } from '../services/api'
import { AuthContext } from './auth'

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
    setAccessToken(data.token)
    setSession({ user: data.user })
  }, [])

  const logout = useCallback(async () => {
    try {
      if (session) await authApi.logout()
    } catch (error) {
      console.error('Không thể đăng xuất trên máy chủ:', error)
    } finally {
      clearSession()
    }
  }, [clearSession, session])

  const value = useMemo(() => ({
    session,
    isLoading,
    login,
    logout
  }), [session, isLoading, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
