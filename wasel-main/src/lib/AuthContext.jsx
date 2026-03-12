import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from './supabase';
import { getCurrentUser } from '@/api/waselClient';
import { authError, authTrace, authWarn } from '@/lib/authDebug';

const AuthContext = createContext();
const AUTH_CHECK_TIMEOUT_MS = 3500;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    authTrace('AUTH_CTX_INIT');
    checkAuth();

    // الاستماع لتغييرات الـ auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);
      authTrace('AUTH_CTX_STATE_CHANGE', {
        event,
        hasSession: !!session,
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });
      if (event === 'SIGNED_IN' && session) {
        checkAuth();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkAuth = async () => {
    let timedOut = false;
    try {
      authTrace('AUTH_CTX_CHECK_START', { timeoutMs: AUTH_CHECK_TIMEOUT_MS });
      setIsLoadingAuth(true);
      setAuthError(null);

      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, AUTH_CHECK_TIMEOUT_MS);
      });

      const currentUser = await Promise.race([getCurrentUser(), timeoutPromise]);
      authTrace('AUTH_CTX_CHECK_RESULT', {
        hasCurrentUser: !!currentUser,
        timedOut,
      });

      // Fallback to auth user in case profile query hangs/fails.
      if (!currentUser && timedOut) {
        authWarn('AUTH_CTX_TIMEOUT_FALLBACK_GET_USER');
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (authUser) {
          authTrace('AUTH_CTX_TIMEOUT_FALLBACK_USER_FOUND', {
            userId: authUser.id,
            email: authUser.email || null,
          });
          setUser(authUser);
          setIsAuthenticated(true);
          return;
        }
      }
      
      if (currentUser) {
        authTrace('AUTH_CTX_AUTHENTICATED');
        setUser(currentUser);
        setIsAuthenticated(true);
      } else {
        authWarn('AUTH_CTX_NOT_AUTHENTICATED');
        setUser(null);
        setIsAuthenticated(false);
      }
      
    } catch (error) {
      authError('AUTH_CTX_CHECK_FAILED', error);
      console.error('Auth check failed:', error);
      setAuthError({
        type: 'auth_error',
        message: error.message || 'Failed to check authentication'
      });
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = async (shouldRedirect = false) => {
    try {
      authTrace('AUTH_CTX_LOGOUT_START', { shouldRedirect });
      await supabase.auth.signOut();
      setUser(null);
      setIsAuthenticated(false);
      
      if (shouldRedirect) {
        window.location.href = '/';
      }
    } catch (error) {
      authError('AUTH_CTX_LOGOUT_FAILED', error);
      console.error('Logout error:', error);
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAuth
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
