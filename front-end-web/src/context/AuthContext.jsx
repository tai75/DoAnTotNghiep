import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, setAccessToken, setUnauthorizedHandler } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setSession(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(clearSession)
    authApi.refresh()
      .then(({ user, token }) => {
        setAccessToken(token)
        return authApi.me().then((currentUser) => setSession({ user: currentUser }))
      })
      .catch(() => clearSession())
      .finally(() => setIsLoading(false))

    return () => setUnauthorizedHandler(null)
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

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
