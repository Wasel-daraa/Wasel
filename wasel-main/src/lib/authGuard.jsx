// =====================================================
// COMPREHENSIVE AUTHENTICATION & AUTHORIZATION GUARDS
// File: src/lib/authGuard.js
// =====================================================

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabase';

// =====================================================
// ROLE-BASED ACCESS CONTROL
// =====================================================

const ADMIN_ROLES = ['admin', 'super_admin', 'support', 'operator', 'supervisor'];
const COURIER_ROLES = ['courier', 'delivery_person'];

/**
 * صارم: التحقق من أن المستخدم مسجل الدخول
 * يرفع استثناء إذا لم يكن مسجل الدخول
 */
export async function requireAuth() {
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    throw new Error('UNAUTHORIZED: User not authenticated');
  }
  
  return user;
}

/**
 * صارم: التحقق من أن المستخدم هو مشرف
 */
export async function requireAdmin() {
  const user = await requireAuth();
  
  const { data: adminUser, error } = await supabase
    .from('admin_users')
    .select('id, role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  
  if (error) {
    console.error('❌ Admin check error:', error);
    throw new Error('UNAUTHORIZED: Failed to verify admin status');
  }
  
  if (!adminUser || !adminUser.is_active || !ADMIN_ROLES.includes(adminUser.role)) {
    throw new Error('UNAUTHORIZED: User is not an active admin');
  }
  
  return { user, adminUser };
}

/**
 * صارم: التحقق من أن المستخدم هو موصل مفوّض
 */
export async function requireCourier() {
  const user = await requireAuth();
  
  const { data: courier, error } = await supabase
    .from('courier_profiles')
    .select('user_id, onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle();
  
  if (error) {
    console.error('❌ Courier check error:', error);
    throw new Error('UNAUTHORIZED: Failed to verify courier status');
  }
  
  if (!courier || !courier.onboarding_completed) {
    throw new Error('UNAUTHORIZED: User is not a verified courier');
  }
  
  return { user, courier };
}

/**
 * معتدل: التحقق الزمني (Temporal Security)
 * التحقق من أن آخر نشاط للمستخدم كان خلال الساعة الأخيرة
 */
export async function requireRecentAuth(maxAgeMinutes = 60) {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) {
    throw new Error('UNAUTHORIZED: No active session');
  }
  
  // التحقق من وقت إنشاء الجلسة
  const tokenCreatedAt = session.created_at ? new Date(session.created_at).getTime() : 0;
  const nowMs = Date.now();
  const ageMs = nowMs - tokenCreatedAt;
  const ageMinutes = ageMs / (1000 * 60);
  
  if (ageMinutes > maxAgeMinutes) {
    throw new Error(`UNAUTHORIZED: Session too old (${Math.round(ageMinutes)} minutes)`);
  }
  
  return session;
}

/**
 * معتدل: التحقق من رقم الهاتف المؤكد (OTP يجب أن يكون تم التحقق منه)
 */
export async function requirePhoneVerified() {
  const user = await requireAuth();
  const { data: publicUser } = await supabase
    .from('users')
    .select('id, phone_verified, phone_verified_at')
    .eq('id', user.id)
    .maybeSingle();
  
  if (!publicUser?.phone_verified) {
    throw new Error('UNAUTHORIZED: Phone not verified');
  }
  
  return { user, phoneVerified: true };
}

/**
 * تحقق من أن المستخدم الحالي هو صاحب المحفظة
 */
export async function requireOwnWallet(walletUserId) {
  const user = await requireAuth();
  
  if (user.id !== walletUserId) {
    throw new Error('FORBIDDEN: Cannot access other users wallets');
  }
  
  return user;
}

/**
 * تحقق من أن المستخدم الحالي يملك الطلب
 */
export async function requireOwnOrder(orderId) {
  const user = await requireAuth();
  
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, user_id, user_email')
    .eq('id', orderId)
    .maybeSingle();
  
  if (error || !order) {
    throw new Error('NOT_FOUND: Order not found');
  }
  
  // تحقق أن المستخدم هو المرسل (sender) أو أن له صلاحيات مشرف
  if (order.user_id !== user.id) {
    // تحقق إذا كان مشرفاً
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id, role')
      .eq('id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    
    if (!adminUser || !ADMIN_ROLES.includes(adminUser.role)) {
      throw new Error('FORBIDDEN: Cannot access other users orders');
    }
  }
  
  return order;
}

/**
 * صارم: منع الطلب إذا كان مستخدم غير مفوّض
 */
export async function validateUserCanPlaceOrders() {
  const user = await requireAuth();
  
  // تحقق من أن البريد موثوق
  if (!user.email_confirmed) {
    throw new Error('UNAUTHORIZED: Email must be verified to place orders');
  }
  
  // تحقق من أن المستخدم لم يكن محظوراً
  const { data: publicUser } = await supabase
    .from('users')
    .select('id, is_banned, is_suspended')
    .eq('id', user.id)
    .maybeSingle();
  
  if (publicUser?.is_banned || publicUser?.is_suspended) {
    throw new Error('UNAUTHORIZED: User account is suspended or banned');
  }
  
  return user;
}

/**
 * صارم: فحص PayPal Transaction
 * تأكد من أن بيانات PayPal تطابق الطلب
 */
export async function validatePayPalCapture(orderId, captureData) {
  if (!captureData?.id) {
    throw new Error('SECURITY: No PayPal capture ID provided');
  }
  
  // تحقق من أن حالة الـ capture هي COMPLETED
  if (captureData.status !== 'COMPLETED') {
    throw new Error(`SECURITY: PayPal capture status is ${captureData.status}, not COMPLETED`);
  }
  
  // تحقق من المبلغ
  if (!captureData.amount?.value) {
    throw new Error('SECURITY: Invalid PayPal amount structure');
  }
  
  const captureAmount = parseFloat(captureData.amount.value);
  
  const { data: order } = await supabase
    .from('orders')
    .select('id, total_usd')
    .eq('id', orderId)
    .maybeSingle();
  
  if (!order) {
    throw new Error('NOT_FOUND: Order not found for validation');
  }
  
  // التسامح: ±$0.01 بسبب تقريب العملات
  const expectedAmount = parseFloat(order.total_usd);
  if (Math.abs(captureAmount - expectedAmount) > 0.01) {
    throw new Error(
      `SECURITY: PayPal amount mismatch. Expected $${expectedAmount}, got $${captureAmount}`
    );
  }
  
  return true;
}

/**
 * فحص قوي: تحقق من کود الهدية قبل الاستخدام
 */
export async function validateGiftCard(cardCode) {
  if (!cardCode || typeof cardCode !== 'string') {
    throw new Error('SECURITY: Invalid gift card code format');
  }
  
  // تحقق من الصيغة: يجب أن تكون 16-32 حرف/رقم
  if (cardCode.length < 16 || cardCode.length > 32) {
    throw new Error('SECURITY: Gift card code length invalid');
  }
  
  // تحقق من أنها تحتوي على أحرف وأرقام فقط
  if (!/^[A-Za-z0-9]+$/.test(cardCode)) {
    throw new Error('SECURITY: Gift card code contains invalid characters');
  }
  
  // تحقق من أن الكود لم يتم استخدامه مسبقاً
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('id, is_used, balance_usd')
    .eq('code', cardCode)
    .maybeSingle();
  
  if (error) {
    console.error('❌ Gift card validation error:', error);
    throw new Error('SECURITY: Failed to validate gift card');
  }
  
  if (!card) {
    throw new Error('SECURITY: Gift card not found');
  }
  
  if (card.is_used) {
    throw new Error('SECURITY: Gift card already redeemed');
  }
  
  if (!card.balance_usd || card.balance_usd <= 0) {
    throw new Error('SECURITY: Gift card has no balance');
  }
  
  return card;
}

/**
 * صارم: تحقق من أن العملية المرسلة تنتمي للمستخدم الحالي
 */
export async function validateTransactionOwnership(transactionId) {
  const user = await requireAuth();
  
  const { data: transaction, error } = await supabase
    .from('wallet_transactions')
    .select('id, user_id, type')
    .eq('id', transactionId)
    .maybeSingle();
  
  if (error || !transaction) {
    throw new Error('NOT_FOUND: Transaction not found');
  }
  
  if (transaction.user_id !== user.id) {
    // السماح فقط للمتراهين والمشرفين
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('role')
      .eq('id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    
    if (!adminUser) {
      throw new Error('FORBIDDEN: Cannot access other users transactions');
    }
  }
  
  return transaction;
}

/**
 * صارم: السماح بالعمليات الإدارية فقط من المشرفين
 */
export async function requireAdminAction(action) {
  const { adminUser } = await requireAdmin();
  
  const ALLOWED_ACTIONS = {
    'reset_wallet': ['admin', 'super_admin'],
    'reset_courier_balance': ['admin', 'super_admin'],
    'cancel_order': ['admin', 'super_admin', 'support'],
    'refund_payment': ['admin', 'super_admin'],
    'suspend_user': ['admin', 'super_admin'],
    'activate_membership': ['admin', 'super_admin', 'support'],
  };
  
  const allowedRoles = ALLOWED_ACTIONS[action];
  
  if (!allowedRoles || !allowedRoles.includes(adminUser.role)) {
    throw new Error(`FORBIDDEN: Insufficient permissions for action '${action}'`);
  }
  
  return adminUser;
}

// =====================================================
// EXPORTED GUARD MIDDLEWARE لـ React Routes
// =====================================================

const DEFAULT_REDIRECT = '/';

/**
 * HOC: حماية صفحة بـ Authentication
 */
export function withAuth(PageComponent) {
  return function ProtectedPage(props) {
    const [loading, setLoading] = React.useState(true);
    const [authorized, setAuthorized] = React.useState(false);
    const navigate = useNavigate();
    
    React.useEffect(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setAuthorized(true);
        } else {
          navigate(DEFAULT_REDIRECT);
        }
        setLoading(false);
      });
    }, [navigate]);
    
    if (loading) return <LoadingScreen />;
    if (!authorized) return null;
    
    return <PageComponent {...props} />;
  };
}

/**
 * HOC: حماية صفحة بـ Admin Role
 */
export function withAdmin(PageComponent) {
  return function AdminPage(props) {
    const [loading, setLoading] = React.useState(true);
    const [authorized, setAuthorized] = React.useState(false);
    const [accessError, setAccessError] = React.useState(null);
    
    React.useEffect(() => {
      (async () => {
        try {
          await requireAdmin();
          setAuthorized(true);
        } catch (error) {
          console.warn('⚠️ Admin access denied:', error.message);
          setAccessError(error.message);
        } finally {
          setLoading(false);
        }
      })();
    }, []);
    
    if (loading) return <LoadingScreen />;
    if (!authorized) return <AccessDeniedScreen role="admin" error={accessError} />;
    
    return <PageComponent {...props} />;
  };
}

/**
 * HOC: حماية صفحة بـ Courier Role
 */
export function withCourier(PageComponent) {
  return function CourierPage(props) {
    const [loading, setLoading] = React.useState(true);
    const [authorized, setAuthorized] = React.useState(false);
    const [accessError, setAccessError] = React.useState(null);
    
    React.useEffect(() => {
      (async () => {
        try {
          await requireCourier();
          setAuthorized(true);
        } catch (error) {
          console.warn('⚠️ Courier access denied:', error.message);
          setAccessError(error.message);
        } finally {
          setLoading(false);
        }
      })();
    }, []);
    
    if (loading) return <LoadingScreen />;
    if (!authorized) return <AccessDeniedScreen role="courier" error={accessError} />;
    
    return <PageComponent {...props} />;
  };
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        <p className="mt-4 text-gray-600">جاري التحقق من الصلاحيات...</p>
      </div>
    </div>
  );
}

function AccessDeniedScreen({ role, error }) {
  const handleRetry = () => window.location.reload();
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100" dir="rtl">
      <div className="text-center bg-white p-8 rounded-xl shadow-lg max-w-md">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          {role === 'admin' ? 'تعذّر الوصول لصفحة المشرف' : 'تعذّر الوصول لصفحة الموصل'}
        </h2>
        <p className="text-gray-500 text-sm mb-4">
          تأكد أن حسابك مسجّل بالصلاحية المطلوبة
        </p>
        {error && <p className="text-red-400 text-xs mb-4 bg-red-50 p-2 rounded">{error}</p>}
        <div className="flex gap-3 justify-center">
          <button onClick={handleRetry} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            إعادة المحاولة
          </button>
          <button onClick={handleLogout} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
            تسجيل الخروج
          </button>
        </div>
      </div>
    </div>
  );
}
