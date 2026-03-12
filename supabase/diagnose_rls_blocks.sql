-- =============================================
-- 🔍 تشخيص مشاكل RLS — لماذا لا يستطيع المشرف/الموصل الدخول
-- شغّل هذا في Supabase SQL Editor
-- =============================================

-- ============================
-- 1️⃣ كل المشرفين المسجلين في admin_users
-- ============================
SELECT '--- admin_users ---' AS section;
SELECT id, email, name, role, is_active, created_at
FROM public.admin_users
ORDER BY created_at DESC;

-- ============================
-- 2️⃣ كل المستخدمين بأدوار إدارية/موصل في جدول users
-- ============================
SELECT '--- users with staff/courier roles ---' AS section;
SELECT id, email, full_name, role, auth_id, created_at
FROM public.users
WHERE role IN ('admin', 'super_admin', 'operator', 'supervisor', 'courier', 'delivery_person')
ORDER BY role, created_at DESC;

-- ============================
-- 3️⃣ ملفات الموصلين — هل لديهم onboarding مكتمل؟
-- ============================
SELECT '--- courier_profiles ---' AS section;
SELECT cp.user_id, cp.onboarding_completed,
       u.email, u.role, u.auth_id,
       CASE WHEN u.id = u.auth_id THEN '✅ id = auth_id'
            WHEN u.auth_id IS NULL THEN '⚠️ auth_id NULL'
            ELSE '⚠️ id ≠ auth_id' END AS id_match_status
FROM public.courier_profiles cp
LEFT JOIN public.users u ON u.id = cp.user_id;

-- ============================
-- 4️⃣ كل الجداول التي عليها RLS مفعّل
-- ============================
SELECT '--- tables with RLS enabled ---' AS section;
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;

-- ============================
-- 5️⃣ ⚠️ جداول عليها RLS بدون أي سياسة (محجوبة 100%)
-- ============================
SELECT '--- ⚠️ BLOCKED: RLS enabled but NO policies ---' AS section;
SELECT t.tablename AS blocked_table
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.schemaname = 'public' AND t.rowsecurity = true
GROUP BY t.tablename
HAVING COUNT(p.policyname) = 0
ORDER BY t.tablename;

-- ============================
-- 6️⃣ كل السياسات على الجداول المهمة
-- ============================
SELECT '--- all RLS policies ---' AS section;
SELECT tablename, policyname, permissive, roles::text, cmd,
       LEFT(qual::text, 120) AS using_clause,
       LEFT(with_check::text, 120) AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ============================
-- 7️⃣ هل الدوال المساعدة موجودة؟
-- ============================
SELECT '--- helper functions ---' AS section;
SELECT routine_name, routine_schema,
       CASE WHEN security_type = 'DEFINER' THEN '✅ SECURITY DEFINER' ELSE '⚠️ INVOKER' END AS security_mode
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('current_app_user_id', 'is_staff_user', 'is_admin_like');

-- ============================
-- 8️⃣ الصلاحيات (GRANTS) على الجداول المهمة
-- ============================
SELECT '--- grants on key tables ---' AS section;
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN (
    'admin_users', 'users', 'courier_profiles', 'orders', 'order_items',
    'notifications', 'order_feedback', 'order_assignments', 'user_devices',
    'direct_messages', 'conversations', 'wallets', 'wallet_transactions',
    'reviews', 'wasel_plus_memberships', 'delivery_proofs'
  )
  AND grantee IN ('authenticated', 'anon')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

-- ============================
-- 9️⃣ فحص تطابق auth.users مع public.users و admin_users
-- (يكشف إذا كان auth_id مفقود أو غير مطابق)
-- ============================
SELECT '--- auth.users ↔ public.users matching ---' AS section;
SELECT
  au.id AS auth_user_id,
  au.email AS auth_email,
  pu.id AS public_user_id,
  pu.role AS public_role,
  pu.auth_id AS public_auth_id,
  adm.role AS admin_role,
  adm.is_active AS admin_active,
  CASE
    WHEN pu.id IS NULL AND adm.id IS NULL THEN '❌ لا يوجد في users ولا admin_users'
    WHEN pu.id IS NOT NULL AND pu.auth_id IS NULL THEN '⚠️ users.auth_id فارغ'
    WHEN pu.id IS NOT NULL AND pu.auth_id != au.id AND pu.id != au.id THEN '❌ لا يوجد ربط بين auth و users'
    WHEN adm.id IS NOT NULL AND NOT adm.is_active THEN '⚠️ admin_users موجود لكن is_active = false'
    ELSE '✅ مطابق'
  END AS status
FROM auth.users au
LEFT JOIN public.users pu ON (pu.auth_id = au.id OR pu.id = au.id OR LOWER(pu.email) = LOWER(au.email))
LEFT JOIN public.admin_users adm ON adm.id = au.id
WHERE au.email IN (
  SELECT email FROM public.admin_users
  UNION
  SELECT email FROM public.users WHERE role IN ('admin','supervisor','courier','delivery_person','operator')
)
ORDER BY au.email;

-- ============================
-- 🔟 فحص courier_profiles.user_id — هل يطابق auth.uid() أم public.users.id؟
-- (مهم جداً: authGuard.jsx يبحث بـ user_id = auth.uid())
-- ============================
SELECT '--- courier user_id mapping check ---' AS section;
SELECT
  cp.user_id AS profile_user_id,
  u.auth_id AS users_auth_id,
  u.email,
  CASE
    WHEN u.auth_id IS NOT NULL AND cp.user_id = u.auth_id THEN '✅ user_id = auth_id (OK for authGuard)'
    WHEN u.auth_id IS NOT NULL AND cp.user_id = u.id AND u.id != u.auth_id THEN '❌ user_id = users.id but ≠ auth_id (authGuard will FAIL)'
    WHEN u.auth_id IS NULL THEN '⚠️ auth_id missing in users table'
    WHEN cp.user_id = u.id AND u.id = u.auth_id THEN '✅ all IDs match'
    ELSE '⚠️ unknown mapping'
  END AS guard_compatibility
FROM public.courier_profiles cp
LEFT JOIN public.users u ON u.id = cp.user_id;
