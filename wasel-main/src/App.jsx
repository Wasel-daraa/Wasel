import React from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import EmailOtpLogin from '@/components/auth/EmailOtpLogin';
import { getOtpSession } from '@/lib/otpAuth';
import { supabase } from '@/lib/supabase';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { withAdmin, withCourier } from '@/lib/authGuard.jsx';
import { GoogleOAuthProvider } from '@react-oauth/google';
import ScrollToTop from '@/lib/ScrollToTop';
import { DarkModeProvider } from '@/lib/DarkModeContext';
import ErrorBoundary from './components/common/ErrorBoundary';
import { initializePushNotifications, deactivateCurrentDeviceToken } from '@/services/pushNotifications';
import SharedPay from './pages/SharedPay';
import SharedCartPay from './pages/SharedCartPay';
import SmartLottie from '@/components/animations/SmartLottie';
import { ANIMATION_PRESETS } from '@/components/animations/animationPresets';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const [session, setSession] = React.useState(null);
  const [checkingAuth, setCheckingAuth] = React.useState(true);
  const [userRole, setUserRole] = React.useState('user');

  const setActiveIdentityScope = React.useCallback((scopeValue) => {
    try {
      if (scopeValue) {
        localStorage.setItem('wasel_active_identity', String(scopeValue));
      } else {
        localStorage.setItem('wasel_active_identity', 'guest');
      }
      window.dispatchEvent(new Event('wasel_identity_changed'));
    } catch (error) {
      console.warn('setActiveIdentityScope warning:', error);
    }
  }, []);

  const resolveUserRole = React.useCallback(async (resolvedSession) => {
    try {
      const email = resolvedSession?.email || null;
      const authUserId = resolvedSession?.user?.id || null;

      if (!authUserId && !email) {
        setUserRole('user');
        return;
      }

      // Try users table first with non-single query to avoid failing on legacy duplicate rows.
      let usersQuery = supabase.from('users').select('id, role, email, auth_id');
      if (authUserId && email) {
        usersQuery = usersQuery.or(`auth_id.eq.${authUserId},id.eq.${authUserId},email.eq.${email}`);
      } else if (authUserId) {
        usersQuery = usersQuery.or(`auth_id.eq.${authUserId},id.eq.${authUserId}`);
      } else {
        usersQuery = usersQuery.eq('email', email);
      }

      const { data: userRows, error: usersError } = await usersQuery.limit(10);
      if (usersError) {
        console.warn('resolveUserRole users query error:', usersError);
      }

      const rows = Array.isArray(userRows) ? userRows : [];
      const preferredUserRow = rows.find((row) => row?.auth_id === authUserId || row?.id === authUserId)
        || rows.find((row) => String(row?.email || '').toLowerCase() === String(email || '').toLowerCase())
        || null;

      const normalizedRole = String(preferredUserRow?.role || '').toLowerCase();
      if (normalizedRole) {
        setUserRole(normalizedRole);
        return;
      }

      // Fallback: many staff accounts are only present in admin_users.
      if (authUserId) {
        const { data: adminRow, error: adminError } = await supabase
          .from('admin_users')
          .select('id, email, name, role, is_active')
          .eq('id', authUserId)
          .maybeSingle();

        if (adminError) {
          console.warn('resolveUserRole admin_users fallback error:', adminError);
          setUserRole('user');
          return;
        }

        if (adminRow?.is_active) {
          const adminRole = String(adminRow.role || '').toLowerCase();
          const mappedRole = adminRole === 'delivery_person' ? 'courier' : (adminRole || 'admin');

          const adminSession = {
            userId: authUserId,
            email: adminRow.email || email,
            name: adminRow.name || adminRow.email || 'Staff User',
            role: adminRole || 'admin',
            createdAt: Date.now(),
          };

          localStorage.setItem('admin_session', JSON.stringify(adminSession));
          localStorage.setItem('admin_user_data', JSON.stringify(adminRow));
          localStorage.setItem('admin_user', JSON.stringify(adminRow));

          setUserRole(mappedRole);
          return;
        }
      }

      setUserRole('user');
    } catch (error) {
      console.warn('resolveUserRole warning:', error);
      setUserRole('user');
    }
  }, []);

  const applyReferralCourierProvision = React.useCallback(async (resolvedSession) => {
    try {
      const referralCode = String(localStorage.getItem('wasel_referral_code') || '').trim().toUpperCase();
      if (!referralCode) return;

      const { error: rpcError } = await supabase.rpc('complete_referral_courier_signup', {
        p_referral_code: referralCode,
      });
      if (!rpcError) {
        localStorage.removeItem('wasel_referral_code');
        localStorage.removeItem('wasel_auth_region_locked');
        localStorage.removeItem('wasel_auth_preferred_region');
        return;
      }

      const authUser = resolvedSession?.user || null;
      const authUserId = authUser?.id || null;
      const email = resolvedSession?.email || authUser?.email || null;
      if (!authUserId || !email) return;

      const displayName = authUser?.user_metadata?.full_name
        || authUser?.user_metadata?.name
        || String(email).split('@')[0]
        || 'Courier User';
      const nowIso = new Date().toISOString();

      const { data: existingByEmail } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .limit(1);

      const existingUserId = Array.isArray(existingByEmail) && existingByEmail.length > 0
        ? existingByEmail[0]?.id
        : null;

      if (existingUserId) {
        await supabase
          .from('users')
          .update({
            auth_id: authUserId,
            role: 'courier',
            full_name: displayName,
            updated_at: nowIso,
          })
          .eq('id', existingUserId);
      } else {
        await supabase
          .from('users')
          .upsert({
            id: authUserId,
            auth_id: authUserId,
            email,
            full_name: displayName,
            role: 'courier',
            updated_at: nowIso,
          }, { onConflict: 'id' });
      }

      const { data: referrerProfile } = await supabase
        .from('courier_profiles')
        .select('user_id')
        .eq('referral_code', referralCode)
        .maybeSingle();

      const referrerUserId = referrerProfile?.user_id || null;
      if (referrerUserId) {
        const { data: referredRow } = await supabase
          .from('users')
          .select('id')
          .or(`id.eq.${authUserId},auth_id.eq.${authUserId},email.eq.${email}`)
          .limit(1)
          .maybeSingle();

        const referredUserId = referredRow?.id || authUserId;

        await supabase
          .from('courier_referrals')
          .upsert({
            referrer_user_id: referrerUserId,
            referred_user_id: referredUserId,
            referral_code: referralCode,
            joined_via_link: true,
            registration_completed: true,
            onboarding_completed: false,
            updated_at: nowIso,
          }, { onConflict: 'referred_user_id' });

        // Ensure admin_users row exists for supervisor assignment
        await supabase
          .from('admin_users')
          .upsert({
            id: authUserId,
            name: displayName,
            email,
            role: 'delivery_person',
            is_active: true,
          }, { onConflict: 'id' }).catch(() => {});

        // Ensure courier_profiles row exists
        await supabase
          .from('courier_profiles')
          .upsert({
            user_id: referredUserId,
            referral_code: null,
            onboarding_completed: false,
          }, { onConflict: 'user_id' }).catch(() => {});
      }

      localStorage.removeItem('wasel_referral_code');
      localStorage.removeItem('wasel_auth_region_locked');
      localStorage.removeItem('wasel_auth_preferred_region');
    } catch (error) {
      console.warn('applyReferralCourierProvision warning:', error);
    }
  }, []);

  // فحص الجلسة (OTP أو Google)
  React.useEffect(() => {
    let isMounted = true;
    let timeoutId = null;
    
    const checkSession = async () => {
      // فحص إذا كان هناك tokens في URL (من OAuth callback)
      const hash = window.location.hash;
      const search = window.location.search;
      
      // 0) تدفق الكود (PKCE) — Supabase يرسل ?code=...&state=...
      const queryParams = new URLSearchParams(search);
      const oauthCode = queryParams.get('code');
      if (oauthCode && oauthCode.trim().length > 0) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          const sessionFromCode = data?.session || data;
          if (sessionFromCode?.user && isMounted && !error) {
            const resolved = { type: 'google', email: sessionFromCode.user.email, user: sessionFromCode.user };
            setActiveIdentityScope(sessionFromCode.user.email || sessionFromCode.user.id || 'guest');
            await applyReferralCourierProvision(resolved);
            setSession(resolved);
            await resolveUserRole(resolved);
            setCheckingAuth(false);
            window.history.replaceState({}, document.title, '/');
            return;
          }
        } catch (err) {
          // OAuth code exchange failed, continue to next method
        }
      }

      // 1) تدفق Implicit — access_token في URL
      if (hash.includes('access_token') || search.includes('access_token')) {
        try {
          // أولاً دع Supabase يحاول التقاط الجلسة تلقائياً
          let { data: { session: urlSession } } = await supabase.auth.getSession();

          // إذا لم تُلتقط بعد، استخرج التوكنات يدوياً واضبط الجلسة
          if (!urlSession?.user) {
            const raw = hash.includes('access_token') ? hash.substring(1) : search.substring(1);
            const params = new URLSearchParams(raw);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (access_token) {
              const { data, error } = await supabase.auth.setSession({ access_token, refresh_token: refresh_token || '' });
              if (!error) urlSession = data?.session || data; // supabase-js قد يعيد session داخل data
            }
          }

          if (urlSession?.user && isMounted) {
            const resolved = { type: 'google', email: urlSession.user.email, user: urlSession.user };
            setActiveIdentityScope(urlSession.user.email || urlSession.user.id || 'guest');
            await applyReferralCourierProvision(resolved);
            setSession(resolved);
            await resolveUserRole(resolved);
            setCheckingAuth(false);
            // تنظيف URL
            window.history.replaceState({}, document.title, '/');
            return;
          }
        } catch (err) {
          // URL token processing failed, continue to next method
        }
      }
      
      // فحص OTP أولاً
      const otpSession = getOtpSession();
      if (otpSession?.email) {
        if (isMounted) {
          const resolved = { type: 'otp', email: otpSession.email };
          setActiveIdentityScope(otpSession.email);
          setSession(resolved);
          await resolveUserRole(resolved);
          setCheckingAuth(false);
        }
        return;
      }
      
      // فحص Supabase (Google)
      try {
        const { data: { session: supabaseSession } } = await supabase.auth.getSession();
        if (supabaseSession?.user) {
          if (isMounted) {
            const resolved = { type: 'google', email: supabaseSession.user.email, user: supabaseSession.user };
            setActiveIdentityScope(supabaseSession.user.email || supabaseSession.user.id || 'guest');
            await applyReferralCourierProvision(resolved);
            setSession(resolved);
            await resolveUserRole(resolved);
            setCheckingAuth(false);
          }
          return;
        }
      } catch (err) {
        // Supabase session check failed
      }
      if (isMounted) {
        setActiveIdentityScope('guest');
        setCheckingAuth(false);
      }
    };
    
    checkSession();
    
    // حد أقصى - كافي لاكتمال OAuth callback parsing
    timeoutId = setTimeout(() => {
      if (!isMounted) return;
      // قبل إنهاء التحقق، تأكد أنه لا يوجد tokens في URL لم تتم معالجتها بعد
      const currentHash = window.location.hash;
      if (currentHash.includes('access_token')) {
        // لا تزال هناك tokens، أعطِ وقتاً إضافياً لـ onAuthStateChange
        setTimeout(() => {
          if (!isMounted) return;
          setCheckingAuth((prev) => prev ? false : prev);
        }, 3000);
        return;
      }
      setCheckingAuth((prev) => prev ? false : prev);
    }, 2500);
    
    // الاستماع لتغييرات الجلسة
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, supabaseSession) => {
      if (event === 'SIGNED_IN' && supabaseSession?.user) {
        if (isMounted) {
          const resolved = { type: 'google', email: supabaseSession.user.email, user: supabaseSession.user };
          setActiveIdentityScope(supabaseSession.user.email || supabaseSession.user.id || 'guest');
          (async () => {
            await applyReferralCourierProvision(resolved);
            setSession(resolved);
            await resolveUserRole(resolved);
            setCheckingAuth(false);
            // تنظيف URL إذا كان لا يزال يحتوي على tokens
            if (window.location.hash.includes('access_token') || window.location.search.includes('access_token')) {
              window.history.replaceState({}, document.title, window.location.pathname || '/');
            }
            // تهيئة الإشعارات بعد تسجيل الدخول
            initializePushNotifications();
          })();
        }
      } else if (event === 'SIGNED_OUT') {
        setActiveIdentityScope('guest');
        deactivateCurrentDeviceToken().catch((error) => {
          console.warn('Push token deactivation warning:', error);
        });
        const otpSession = getOtpSession();
        if (!otpSession?.email && isMounted) {
          setSession(null);
          setUserRole('user');
        }
      }
    });
    
    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [applyReferralCourierProvision, resolveUserRole, setActiveIdentityScope]);

  React.useEffect(() => {
    if (session) {
      try {
        const redirectPath = localStorage.getItem('wasel_post_login_redirect');
        if (redirectPath && redirectPath.startsWith('/') && redirectPath !== location.pathname) {
          localStorage.removeItem('wasel_post_login_redirect');
          routerNavigate(redirectPath, { replace: true });
        }
      } catch {
        // noop
      }
      return;
    }

    // If user opened a shared-cart link while logged out, default login region to outside Syria.
    if (location.pathname.includes('/shared-cart')) {
      try {
        localStorage.setItem('wasel_auth_preferred_mode', 'login');
        localStorage.setItem('wasel_auth_preferred_region', 'outside_syria');
        localStorage.setItem('wasel_post_login_redirect', `${location.pathname}${location.search}`);
      } catch {
        // noop
      }
    }
  }, [session, location.pathname, location.search, routerNavigate]);

  // عرض شاشة التحميل مع timeout
  if (checkingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white">
        <SmartLottie
          animationPath={ANIMATION_PRESETS.pageLoading.path}
          width={80}
          height={80}
          trigger="never"
          autoplay={true}
          loop={true}
        />
        <p className="text-gray-500 text-sm">جاري التحميل...</p>
      </div>
    );
  }

  // عرض صفحة تسجيل الدخول إذا لم يكن هناك جلسة
  if (!session) {
    return <EmailOtpLogin onSuccess={() => {
      const otpSession = getOtpSession();
      if (otpSession?.email) {
        const resolved = { type: 'otp', email: otpSession.email };
        setActiveIdentityScope(otpSession.email);
        setSession(resolved);
        resolveUserRole(resolved);
      }
    }} />;
  }

  const isCourier = userRole === 'courier' || userRole === 'delivery_person';
  const isAdmin = ['admin', 'super_admin', 'support', 'operator', 'supervisor'].includes(userRole);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <SmartLottie
          animationPath={ANIMATION_PRESETS.pageLoading.path}
          width={80}
          height={80}
          trigger="never"
          autoplay={true}
          loop={true}
        />
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Skip base44 login when session is active
      if (!session) {
        navigateToLogin();
        return null;
      }
    }
  }

  // Render the main app
  if (isCourier) {
    return (
      <Routes>
        <Route path="/shared-pay/:token" element={<SharedPay />} />
        <Route path="/shared-pay" element={<SharedPay />} />
        <Route path="/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/wasel-app/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/wasel-app/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/DriverPanel" element={withCourier(Pages.DriverPanel)} />
        <Route path="/CourierTerms" element={<Pages.CourierTerms />} />
        <Route path="/CourierGuide" element={<Pages.CourierGuide />} />
        <Route path="/SupervisorGuide" element={<Pages.SupervisorGuide />} />
        <Route path="/AdminTerms" element={<Pages.AdminTerms />} />
        <Route path="*" element={<Navigate to="/DriverPanel" replace />} />
      </Routes>
    );
  }

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/shared-pay/:token" element={<SharedPay />} />
        <Route path="/shared-pay" element={<SharedPay />} />
        <Route path="/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/wasel-app/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/wasel-app/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
        <Route path="/SupervisorPanel" element={withAdmin(Pages.SupervisorPanel)} />
        <Route path="/CourierTerms" element={<Pages.CourierTerms />} />
        <Route path="/CourierGuide" element={<Pages.CourierGuide />} />
        <Route path="/SupervisorGuide" element={<Pages.SupervisorGuide />} />
        <Route path="/AdminTerms" element={<Pages.AdminTerms />} />
        <Route path="/StaffDashboard" element={<Navigate to="/SupervisorPanel" replace />} />
        <Route path="/AdminDashboard" element={<Navigate to="/SupervisorPanel" replace />} />
        <Route path="*" element={<Navigate to="/SupervisorPanel" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/shared-pay/:token" element={<SharedPay />} />
      <Route path="/shared-pay" element={<SharedPay />} />
      <Route path="/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
      <Route path="/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
      <Route path="/wasel-app/shared-cart/:token" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
      <Route path="/wasel-app/shared-cart" element={<LayoutWrapper currentPageName="SharedCart"><SharedCartPay /></LayoutWrapper>} />
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '251985599218-608bl35pbtifshb7iv0d9prngmsc4sv1.apps.googleusercontent.com';

  return (
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <DarkModeProvider>
          <AuthProvider>
            <QueryClientProvider client={queryClientInstance}>
              <Router>
                <ScrollToTop />
                <NavigationTracker />
                <AuthenticatedApp />
              </Router>
              <Toaster />
              <SonnerToaster position="top-center" richColors closeButton dir="rtl" />
            </QueryClientProvider>
          </AuthProvider>
        </DarkModeProvider>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  )
}

export default App
