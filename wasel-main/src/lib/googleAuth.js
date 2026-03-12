import { supabase } from './supabase';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { authError, authTrace, authWarn } from '@/lib/authDebug';

/**
 * تسجيل الدخول عبر Google OAuth
 */
export async function signInWithGoogle() {
  try {
    authTrace('AUTH_GOOGLE_SIGNIN_START', { native: Capacitor.isNativePlatform() });
    if (Capacitor.isNativePlatform()) {
      // للأندرويد: استخدام Browser plugin
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'com.wasel.app://login-callback',
          skipBrowserRedirect: true,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
      authTrace('AUTH_GOOGLE_SIGNIN_NATIVE_URL_READY', { hasUrl: !!data?.url });
      
      // فتح OAuth في متصفح
      if (data?.url) {
        console.log('WASEL_DEBUG: Opening browser for OAuth...');
        authTrace('AUTH_GOOGLE_BROWSER_OPEN_START');
        await Browser.open({ 
          url: data.url,
          presentationStyle: 'popover'
        });
        
        // التحقق من الجلسة بعد إغلاق المتصفح
        const browserFinishedHandler = Browser.addListener('browserFinished', async () => {
          console.log('WASEL_DEBUG: Browser closed, checking session...');
          authTrace('AUTH_GOOGLE_BROWSER_FINISHED');
          
          // انتظار قصير لضمان معالجة deep link
          await new Promise(resolve => setTimeout(resolve, 500));
          
          let attempts = 0;
          const maxAttempts = 15;
          
          const checkSession = async () => {
            attempts++;
            console.log(`WASEL_DEBUG: Session check attempt ${attempts}/${maxAttempts}`);
            authTrace('AUTH_GOOGLE_NATIVE_SESSION_CHECK_ATTEMPT', { attempts, maxAttempts });
            
            const { data: { session }, error: getSessionError } = await supabase.auth.getSession();
            if (getSessionError) {
              authError('AUTH_GOOGLE_NATIVE_GET_SESSION_FAILED', getSessionError, { attempts });
            }
            
            if (session) {
              console.log('✅ تم العثور على الجلسة!', session.user.email);
              authTrace('AUTH_GOOGLE_NATIVE_SESSION_FOUND', {
                userId: session.user.id,
                email: session.user.email || null,
              });
              browserFinishedHandler.remove();
              // إعادة تحميل التطبيق
              window.location.replace('/');
              return true;
            }
            
            if (attempts < maxAttempts) {
              setTimeout(checkSession, 800);
            } else {
              console.log('❌ فشل الحصول على الجلسة بعد', maxAttempts, 'محاولات');
              authWarn('AUTH_GOOGLE_NATIVE_SESSION_NOT_FOUND_AFTER_RETRIES', { maxAttempts });
              browserFinishedHandler.remove();
            }
            return false;
          };
          
          checkSession();
        });
      }
      
      return { data, error: null };
    } else {
      // للويب: استخدم PKCE ليعود ?code=... ثم نستبدله بجلسة
      authTrace('AUTH_GOOGLE_WEB_SIGNIN_START', { redirectTo: window.location.origin });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          flowType: 'pkce',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
      authTrace('AUTH_GOOGLE_WEB_SIGNIN_REDIRECT_READY', { hasUrl: !!data?.url });
      return { data, error: null };
    }
  } catch (error) {
    authError('AUTH_GOOGLE_SIGNIN_FAILED', error, { native: Capacitor.isNativePlatform() });
    console.error('Google sign-in error:', error);
    return { data: null, error };
  }
}

/**
 * تسجيل الخروج من Supabase Auth
 */
export async function signOutGoogle() {
  try {
    authTrace('AUTH_GOOGLE_SIGNOUT_START');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    authTrace('AUTH_GOOGLE_SIGNOUT_OK');
    return { error: null };
  } catch (error) {
    authError('AUTH_GOOGLE_SIGNOUT_FAILED', error);
    console.error('Sign out error:', error);
    return { error };
  }
}

/**
 * الحصول على الجلسة الحالية من Supabase Auth
 */
export async function getGoogleSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    authTrace('AUTH_GOOGLE_GET_SESSION_RESULT', {
      hasSession: !!session,
      userId: session?.user?.id || null,
      email: session?.user?.email || null,
    });
    return session;
  } catch (error) {
    authError('AUTH_GOOGLE_GET_SESSION_FAILED', error);
    console.error('Get session error:', error);
    return null;
  }
}

/**
 * مراقبة تغييرات حالة المصادقة
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
