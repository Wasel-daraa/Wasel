import { App } from '@capacitor/app';
import { supabase } from './supabase';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';

let isHandling = false;

/**
 * استخراج التوكنات من URL
 */
function extractTokensFromUrl(url) {
  console.log('WASEL_DEBUG: Extracting tokens from:', url);
  
  let params = new URLSearchParams();
  
  // جرب استخراج من hash أولاً
  if (url.includes('#')) {
    const hashPart = url.split('#')[1];
    if (hashPart) {
      params = new URLSearchParams(hashPart);
    }
  }
  
  // إذا لم نجد في hash، جرب query string
  if (!params.get('access_token') && url.includes('?')) {
    const queryPart = url.split('?')[1];
    if (queryPart) {
      // قد يحتوي على # أيضاً
      const cleanQuery = queryPart.split('#')[0];
      params = new URLSearchParams(cleanQuery);
    }
  }
  
  // جرب البحث المباشر في URL
  if (!params.get('access_token')) {
    const accessTokenMatch = url.match(/access_token=([^&]+)/);
    const refreshTokenMatch = url.match(/refresh_token=([^&]+)/);
    
    if (accessTokenMatch) {
      return {
        access_token: decodeURIComponent(accessTokenMatch[1]),
        refresh_token: refreshTokenMatch ? decodeURIComponent(refreshTokenMatch[1]) : null
      };
    }
  }
  
  return {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token')
  };
}

/**
 * معالج للعودة من Google OAuth
 */
export function initDeepLinkHandler() {
  // فقط على الأندرويد
  if (!Capacitor.isNativePlatform()) {
    console.log('WASEL_DEBUG: Not native platform, skipping deep link handler');
    return;
  }
  
  console.log('WASEL_DEBUG: Deep link handler initializing...');
  
  // مراقبة فتح التطبيق من deep link
  App.addListener('appUrlOpen', async ({ url }) => {
    console.log('WASEL_DEBUG: ==========================================');
    console.log('WASEL_DEBUG: appUrlOpen EVENT FIRED!');
    console.log('WASEL_DEBUG: Full URL:', url);
    console.log('WASEL_DEBUG: ==========================================');
    
    if (isHandling) {
      console.log('WASEL_DEBUG: Already handling, skipping...');
      return;
    }
    isHandling = true;
    
    try {
      // PKCE flow: parse code properly to avoid matching error_code
      const urlObj = new URL(url);
      const pkceCode = urlObj.searchParams.get('code');
      if (pkceCode && pkceCode.trim().length > 0) {
        console.log('WASEL_DEBUG: Found PKCE code, exchanging...');
        const { data, error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) {
          console.log('WASEL_DEBUG: exchangeCodeForSession error:', error.message);
          toast.error('فشل إكمال تسجيل الدخول عبر Google');
          return;
        }

        const sessionFromCode = data?.session || data;
        if (sessionFromCode?.user) {
          toast.success(`أهلاً ${sessionFromCode.user.user_metadata?.full_name || sessionFromCode.user.email} 👋`);
          window.location.replace('/');
          return;
        }
      }

      // التحقق من أن الرابط يحتوي على tokens
      if (url.includes('access_token') || url.includes('token')) {
        console.log('WASEL_DEBUG: Found token in URL, extracting...');
        
        const tokens = extractTokensFromUrl(url);
        console.log('WASEL_DEBUG: Extracted tokens:', {
          hasAccess: !!tokens.access_token,
          hasRefresh: !!tokens.refresh_token,
          accessLength: tokens.access_token?.length
        });
        
        if (tokens.access_token) {
          console.log('WASEL_DEBUG: Setting session with tokens...');
          
          // محاولة تعيين الجلسة
          const { data, error } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || ''
          });
          
          if (error) {
            console.log('WASEL_DEBUG: setSession ERROR:', error.message);
            toast.error('حدث خطأ في تسجيل الدخول: ' + error.message);
            isHandling = false;
            return;
          }
          
          if (data?.user) {
            console.log('WASEL_DEBUG: ✅ Session set successfully!');
            console.log('WASEL_DEBUG: User:', data.user.email);
            
            toast.success(`أهلاً ${data.user.user_metadata?.full_name || data.user.email} 👋`);
            
            // تخزين علامة النجاح
            localStorage.setItem('wasel_auth_success', 'true');
            
            // إعادة التوجيه للصفحة الرئيسية
            console.log('WASEL_DEBUG: Redirecting to home...');
            window.location.replace('/');
          } else {
            console.log('WASEL_DEBUG: No user in response');
            toast.error('لم يتم العثور على بيانات المستخدم');
          }
        } else {
          console.log('WASEL_DEBUG: No access_token found in URL');
          
          // جرب الحصول على الجلسة مباشرة
          console.log('WASEL_DEBUG: Trying to get session directly...');
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session?.user) {
            console.log('WASEL_DEBUG: Found existing session!');
            toast.success(`أهلاً ${session.user.email} 👋`);
            window.location.replace('/');
          }
        }
      } else {
        console.log('WASEL_DEBUG: URL does not contain tokens');
      }
    } catch (err) {
      console.log('WASEL_DEBUG: Error in handler:', err.message);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTimeout(() => {
        isHandling = false;
      }, 2000);
    }
  });
  
  // مراقبة تغييرات المصادقة
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('WASEL_DEBUG: Auth state changed:', event);
    
    if (event === 'SIGNED_IN' && session) {
      console.log('WASEL_DEBUG: User signed in:', session.user?.email);
      
      // التأكد من إعادة التوجيه
      const authSuccess = localStorage.getItem('wasel_auth_success');
      if (authSuccess) {
        localStorage.removeItem('wasel_auth_success');
        if (window.location.pathname !== '/') {
          window.location.replace('/');
        }
      }
    }
  });
  
  console.log('✅ Deep link handler ready');
}
