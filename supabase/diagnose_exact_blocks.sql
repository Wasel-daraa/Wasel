-- =============================================
-- 🎯 تشخيص دقيق: محاكاة استعلامات الفرونتند
-- يحاكي بالضبط ما يفعله authGuard.jsx و App.jsx
-- شغّل هذا في Supabase SQL Editor
-- =============================================

-- ============================
-- 1️⃣ هل courier_profiles عنده عمود id؟
-- (authGuard.jsx يطلب: .select('id, user_id, onboarding_completed'))
-- إذا لا يوجد id → الموصل محجوب!
-- ============================
SELECT '--- courier_profiles columns ---' AS section;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'courier_profiles'
ORDER BY ordinal_position;

-- ============================
-- 2️⃣ هل الدوال المساعدة موجودة وبأي نوع أمان؟
-- ============================
SELECT '--- helper functions ---' AS section;
SELECT routine_name,
       CASE WHEN security_type = 'DEFINER' THEN '✅ SECURITY DEFINER' ELSE '⚠️ INVOKER' END AS security_mode
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('current_app_user_id', 'is_staff_user', 'is_admin_like', 'is_super_admin', 'is_courier_user');

-- ============================
-- 3️⃣ الصلاحيات (GRANTS) — هل authenticated يستطيع SELECT؟
-- ============================
SELECT '--- grants on key tables ---' AS section;
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN (
    'admin_users', 'users', 'courier_profiles', 'orders', 'order_items',
    'notifications', 'order_feedback', 'order_assignments', 'user_devices',
    'direct_messages', 'conversations', 'wallets', 'wallet_transactions'
  )
  AND grantee IN ('authenticated', 'anon')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

-- ============================
-- 4️⃣ محاكاة requireAdmin() — هل المشرف يجد نفسه في admin_users؟
-- ============================
SELECT '--- simulate requireAdmin for bishrjr37 ---' AS section;
SELECT id, role, is_active,
  CASE
    WHEN role IN ('admin', 'super_admin', 'support', 'operator', 'supervisor') AND is_active = true
      THEN '✅ requireAdmin سينجح'
    WHEN is_active = false THEN '❌ is_active = false → UNAUTHORIZED'
    ELSE '❌ role غير مسموح → UNAUTHORIZED'
  END AS result
FROM public.admin_users
WHERE id = '526c25f3-55f8-4042-bc0c-af0daa648797';

-- ============================
-- 5️⃣ محاكاة requireCourier() — هل الموصل يجد ملفه؟
-- ============================
SELECT '--- simulate requireCourier for joudjr30 ---' AS section;
SELECT user_id, onboarding_completed,
  CASE
    WHEN onboarding_completed = true THEN '✅ requireCourier سينجح'
    ELSE '❌ onboarding_completed = false → UNAUTHORIZED'
  END AS result
FROM public.courier_profiles
WHERE user_id = 'edbaffbf-e64f-4bfb-89c9-0dd4088fa4ad';

SELECT '--- simulate requireCourier for dimaalrashdan886 ---' AS section;
SELECT user_id, onboarding_completed,
  CASE
    WHEN onboarding_completed = true THEN '✅ requireCourier سينجح'
    ELSE '❌ onboarding_completed = false → UNAUTHORIZED'
  END AS result
FROM public.courier_profiles
WHERE user_id = 'b34126d1-e238-47bf-853d-b7764e8c40e5';

-- ============================
-- 6️⃣ محاكاة resolveUserRole() من App.jsx
-- ============================
SELECT '--- simulate resolveUserRole ---' AS section;
SELECT u.id, u.email, u.role,
  CASE
    WHEN u.role IN ('admin', 'super_admin', 'support', 'operator', 'supervisor') THEN 'isAdmin = true → renders SupervisorPanel'
    WHEN u.role IN ('courier', 'delivery_person') THEN 'isCourier = true → renders DriverPanel'
    ELSE 'regular user → renders normal pages'
  END AS routing_result
FROM public.users u
WHERE u.role IN ('admin', 'super_admin', 'operator', 'supervisor', 'courier', 'delivery_person');

-- ============================
-- 7️⃣ فحص is_staff_user() — هل ترجع true للمشرف والموصل؟
-- (تُنفذ كـ SECURITY DEFINER، لذا نفحص المنطق يدوياً)
-- ============================
SELECT '--- is_staff_user logic check ---' AS section;
SELECT
  au.id,
  au.email,
  au.role AS admin_role,
  au.is_active AS admin_active,
  u.role AS users_role,
  CASE
    WHEN au.is_active = true THEN '✅ is_staff_user = true (via admin_users)'
    WHEN u.role IN ('admin', 'operator', 'courier', 'supervisor') THEN '✅ is_staff_user = true (via users)'
    ELSE '❌ is_staff_user = false'
  END AS staff_result,
  CASE
    WHEN au.is_active = true THEN '✅ is_admin_like = true'
    ELSE '❌ is_admin_like = false (not in admin_users or inactive)'
  END AS admin_like_result
FROM public.admin_users au
LEFT JOIN public.users u ON (u.auth_id = au.id OR u.id = au.id)
ORDER BY au.email;

-- ============================
-- 8️⃣ هل هناك grant EXECUTE على الدوال؟
-- ============================
SELECT '--- function grants ---' AS section;
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('current_app_user_id', 'is_staff_user', 'is_admin_like', 'is_super_admin')
  AND grantee IN ('authenticated', 'anon', 'public')
ORDER BY routine_name, grantee;
