import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initDeepLinkHandler } from '@/lib/deepLinkHandler'
import { supabase } from '@/lib/supabase'
import { authError, authTrace, authWarn, exposeAuthDebugHelpers } from '@/lib/authDebug'

// ⚡ تحميل خدمة الإشعارات مبكراً لإعداد المستمعين
import '@/services/pushNotifications'

// معالجة OAuth tokens قبل تحميل React لتجنب race condition
async function boot() {
  const hash = window.location.hash;
  const search = window.location.search;
  authTrace('AUTH_BOOT_START', {
    hasHash: !!hash,
    hasSearch: !!search,
    hasAccessTokenInHash: hash.includes('access_token'),
    hasCodeInSearch: search.includes('code='),
  });
  exposeAuthDebugHelpers();

  // 1) Implicit flow — #access_token=...
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token) {
      try {
        authTrace('AUTH_BOOT_SET_SESSION_FROM_HASH_START');
        await supabase.auth.setSession({
          access_token,
          refresh_token: refresh_token || '',
        });
        authTrace('AUTH_BOOT_SET_SESSION_FROM_HASH_OK');
      } catch (e) {
        authError('AUTH_BOOT_SET_SESSION_FROM_HASH_FAILED', e);
        console.warn('boot: setSession from hash failed', e);
      }
    } else {
      authWarn('AUTH_BOOT_HASH_FOUND_WITHOUT_ACCESS_TOKEN');
    }
    window.history.replaceState({}, document.title, window.location.pathname || '/');
    authTrace('AUTH_BOOT_HASH_CLEANED');
  }

  // 2) PKCE flow — ?code=...
  const code = new URLSearchParams(search).get('code');
  if (code && !hash.includes('access_token')) {
    try {
      authTrace('AUTH_BOOT_EXCHANGE_CODE_START');
      await supabase.auth.exchangeCodeForSession(window.location.href);
      authTrace('AUTH_BOOT_EXCHANGE_CODE_OK');
    } catch (e) {
      authError('AUTH_BOOT_EXCHANGE_CODE_FAILED', e, { href: window.location.href });
      console.warn('boot: exchangeCodeForSession failed', e);
    }
    window.history.replaceState({}, document.title, window.location.pathname || '/');
    authTrace('AUTH_BOOT_QUERY_CLEANED');
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    authTrace('AUTH_BOOT_SESSION_RESULT', {
      hasSession: !!session,
      userId: session?.user?.id || null,
      email: session?.user?.email || null,
    });
  } catch (e) {
    authError('AUTH_BOOT_GET_SESSION_FAILED', e);
  }

  // تفعيل معالج Deep Links للأندرويد
  try {
    initDeepLinkHandler();
    authTrace('AUTH_BOOT_DEEPLINK_HANDLER_READY');
  } catch (e) {
    authError('AUTH_BOOT_DEEPLINK_HANDLER_FAILED', e);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  );
  authTrace('AUTH_BOOT_RENDERED');
}

boot().catch((e) => {
  authError('AUTH_BOOT_FATAL', e);
  throw e;
});
