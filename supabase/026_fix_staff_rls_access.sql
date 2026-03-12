-- =====================================================================
-- 🔧 إصلاح شامل: فتح وصول المشرف والموصل إلى صفحاتهم
-- المشكلة: RLS مبالغ فيه يمنع المشرف والموصل من الوصول
-- 
-- شغّل هذا الملف في Supabase SQL Editor
-- =====================================================================

BEGIN;

-- =============================================================
-- الخطوة 0: التأكد من وجود الدوال المساعدة (SECURITY DEFINER)
-- هذه الدوال تتجاوز RLS لتتحقق من صلاحية المستخدم
-- =============================================================

-- دالة: ربط auth.uid() بـ public.users.id
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid;
BEGIN
  SELECT u.id INTO v_user_id
  FROM public.users u
  WHERE u.auth_id = auth.uid() OR u.id = auth.uid()
  LIMIT 1;
  RETURN COALESCE(v_user_id, auth.uid());
END;
$$;

-- دالة: هل المستخدم الحالي من الموظفين (admin, operator, courier, supervisor)
CREATE OR REPLACE FUNCTION public.is_staff_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = auth.uid()
        AND COALESCE(au.is_active, true) = true
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.id = auth.uid())
        AND u.role IN ('admin', 'operator', 'courier', 'supervisor', 'super_admin', 'delivery_person', 'support')
    )
  );
END;
$$;

-- دالة: هل المستخدم الحالي مشرف
CREATE OR REPLACE FUNCTION public.is_admin_like()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = auth.uid()
        AND COALESCE(au.is_active, true) = true
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.id = auth.uid())
        AND u.role IN ('admin', 'super_admin', 'supervisor', 'operator', 'support')
    )
  );
END;
$$;

-- دالة: هل المستخدم الحالي موصل
CREATE OR REPLACE FUNCTION public.is_courier_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = auth.uid()
        AND COALESCE(au.is_active, true) = true
        AND au.role = 'delivery_person'
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.id = auth.uid())
        AND u.role IN ('courier', 'delivery_person')
    )
  );
END;
$$;

-- دالة: هل يمكن للمستخدم الوصول لطلب معين
CREATE OR REPLACE FUNCTION public.user_can_access_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.current_app_user_id();
  RETURN (
    public.is_staff_user()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = p_order_id
        AND (
          o.user_id = v_uid
          OR o.user_id = auth.uid()
          OR o.recipient_user_id = v_uid
          OR o.payer_user_id = v_uid
          OR o.paid_by_user_id = v_uid
        )
    )
  );
END;
$$;

-- صلاحيات تنفيذ الدوال
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_user() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_like() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_courier_user() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_order(uuid) TO authenticated, anon;


-- =============================================================
-- الخطوة 1: إصلاح admin_users — المشرفون يحتاجون قراءة جدولهم
-- =============================================================

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- حذف السياسات القديمة
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin_users'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_users', p.policyname); END LOOP;
END $$;

-- المشرف يقرأ سجله
CREATE POLICY admin_users_select_self ON public.admin_users
  FOR SELECT USING (id = auth.uid());

-- أي مشرف نشط يقرأ كل المشرفين (لعرض قائمة الموصلين مثلاً)
CREATE POLICY admin_users_select_admin ON public.admin_users
  FOR SELECT USING (public.is_admin_like());

-- الموظفون يقرؤون (الموصل يحتاج يشوف معلومات المشرف للتشات)
CREATE POLICY admin_users_select_staff ON public.admin_users
  FOR SELECT USING (public.is_staff_user());

-- المشرف يحدّث سجله
CREATE POLICY admin_users_update_self ON public.admin_users
  FOR UPDATE USING (id = auth.uid());

-- إدخال (للسكربت/الإعداد)
CREATE POLICY admin_users_insert ON public.admin_users
  FOR INSERT WITH CHECK (public.is_admin_like() OR id = auth.uid());


-- =============================================================
-- الخطوة 2: إصلاح users — المشرف والموصل يحتاجون قراءة بياناتهم
-- =============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='users'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', p.policyname); END LOOP;
END $$;

-- المستخدم يقرأ سجله
CREATE POLICY users_select_own ON public.users
  FOR SELECT USING (auth_id = auth.uid() OR id = auth.uid());

-- المستخدم يحدّث سجله
CREATE POLICY users_update_own ON public.users
  FOR UPDATE USING (auth_id = auth.uid() OR id = auth.uid());

-- الموظفون يقرؤون كل المستخدمين
CREATE POLICY users_select_staff ON public.users
  FOR SELECT USING (public.is_staff_user());

-- الموظفون يحدّثون المستخدمين (تعيين دور، إلخ)
CREATE POLICY users_update_staff ON public.users
  FOR UPDATE USING (public.is_staff_user()) WITH CHECK (public.is_staff_user());

-- إدخال مستخدم جديد (تسجيل، trigger)
CREATE POLICY users_insert ON public.users
  FOR INSERT WITH CHECK (true);


-- =============================================================
-- الخطوة 3: إصلاح courier_profiles — الموصل يحتاج الوصول لملفه
-- =============================================================

ALTER TABLE public.courier_profiles ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='courier_profiles'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.courier_profiles', p.policyname); END LOOP;
END $$;

-- الموصل يقرأ ملفه (بـ auth.uid() أو بـ users.id المحول)
CREATE POLICY courier_select_own ON public.courier_profiles
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
  );

-- الموصل يحدّث ملفه
CREATE POLICY courier_update_own ON public.courier_profiles
  FOR UPDATE USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
  );

-- الموصل يُنشئ ملفه (onboarding)
CREATE POLICY courier_insert_own ON public.courier_profiles
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
    OR public.is_staff_user()
  );

-- الموظفون يقرؤون كل الملفات
CREATE POLICY courier_select_staff ON public.courier_profiles
  FOR SELECT USING (public.is_staff_user());

-- الموظفون يحدّثون الملفات
CREATE POLICY courier_update_staff ON public.courier_profiles
  FOR UPDATE USING (public.is_staff_user()) WITH CHECK (public.is_staff_user());


-- =============================================================
-- الخطوة 4: إصلاح orders — الموصل يحتاج يشوف الطلبات المسندة له
-- =============================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='orders'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', p.policyname); END LOOP;
END $$;

-- المستخدم العادي يقرأ طلباته
CREATE POLICY orders_select_own ON public.orders
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
    OR recipient_user_id = auth.uid()
    OR payer_user_id = auth.uid()
    OR paid_by_user_id = auth.uid()
  );

-- الموظفون يقرؤون كل الطلبات
CREATE POLICY orders_select_staff ON public.orders
  FOR SELECT USING (public.is_staff_user());

-- أي مسجّل يُنشئ طلب
CREATE POLICY orders_insert ON public.orders
  FOR INSERT WITH CHECK (true);

-- المستخدم يحدّث طلبه
CREATE POLICY orders_update_own ON public.orders
  FOR UPDATE USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
    OR recipient_user_id = auth.uid()
    OR payer_user_id = auth.uid()
    OR paid_by_user_id = auth.uid()
  );

-- الموظفون يحدّثون ويحذفون الطلبات
CREATE POLICY orders_update_staff ON public.orders
  FOR UPDATE USING (public.is_staff_user()) WITH CHECK (public.is_staff_user());

CREATE POLICY orders_delete_staff ON public.orders
  FOR DELETE USING (public.is_staff_user());

-- الزائر guest يُنشئ طلب
CREATE POLICY orders_anon_insert ON public.orders
  FOR INSERT TO anon WITH CHECK (true);


-- =============================================================
-- الخطوة 5: إصلاح order_items
-- =============================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='order_items'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_items', p.policyname); END LOOP;
END $$;

CREATE POLICY order_items_select ON public.order_items FOR SELECT USING (true);
CREATE POLICY order_items_insert ON public.order_items FOR INSERT WITH CHECK (true);
CREATE POLICY order_items_update_staff ON public.order_items FOR UPDATE USING (public.is_staff_user());
CREATE POLICY order_items_delete_staff ON public.order_items FOR DELETE USING (public.is_staff_user());


-- =============================================================
-- الخطوة 6: إصلاح order_assignments — جدول حرج للموصل
-- (قد يكون عليه RLS بدون سياسات = محجوب 100%)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_assignments') THEN
    ALTER TABLE public.order_assignments ENABLE ROW LEVEL SECURITY;

    -- حذف السياسات القديمة
    DECLARE p record;
    BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='order_assignments'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_assignments', p.policyname); END LOOP;
    END;

    -- الموصل يقرأ التعيينات المسندة له
    EXECUTE 'CREATE POLICY oa_select_own ON public.order_assignments
      FOR SELECT USING (
        delivery_person_id = auth.uid()
        OR delivery_person_id = public.current_app_user_id()
      )';

    -- الموظفون يقرؤون كل التعيينات
    EXECUTE 'CREATE POLICY oa_select_staff ON public.order_assignments
      FOR SELECT USING (public.is_staff_user())';

    -- الموظفون يُنشئون ويحدّثون التعيينات
    EXECUTE 'CREATE POLICY oa_insert_staff ON public.order_assignments
      FOR INSERT WITH CHECK (public.is_staff_user())';

    EXECUTE 'CREATE POLICY oa_update_staff ON public.order_assignments
      FOR UPDATE USING (public.is_staff_user()) WITH CHECK (public.is_staff_user())';

    -- الموصل يحدّث حالة التعيين المسند له
    EXECUTE 'CREATE POLICY oa_update_own ON public.order_assignments
      FOR UPDATE USING (
        delivery_person_id = auth.uid()
        OR delivery_person_id = public.current_app_user_id()
      )';

    -- صلاحيات
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.order_assignments TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 7: إصلاح user_devices — يـحتاج المشرف يقرأ أجهزة المستخدمين (للإشعارات)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_devices') THEN
    ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

    DECLARE p record;
    BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_devices'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_devices', p.policyname); END LOOP;
    END;

    -- المستخدم يقرأ أجهزته
    EXECUTE 'CREATE POLICY ud_select_own ON public.user_devices
      FOR SELECT USING (user_id = auth.uid())';

    -- المستخدم يُدخل/يحدّث/يحذف أجهزته
    EXECUTE 'CREATE POLICY ud_insert_own ON public.user_devices
      FOR INSERT WITH CHECK (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY ud_update_own ON public.user_devices
      FOR UPDATE USING (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY ud_delete_own ON public.user_devices
      FOR DELETE USING (user_id = auth.uid())';

    -- الموظفون يقرؤون كل الأجهزة (لإرسال الإشعارات)
    EXECUTE 'CREATE POLICY ud_select_staff ON public.user_devices
      FOR SELECT USING (public.is_staff_user())';

    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 8: إصلاح order_feedback
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_feedback') THEN
    ALTER TABLE public.order_feedback ENABLE ROW LEVEL SECURITY;

    DECLARE p record;
    BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='order_feedback'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_feedback', p.policyname); END LOOP;
    END;

    -- الكل يقرأ التقييمات
    EXECUTE 'CREATE POLICY of_select ON public.order_feedback FOR SELECT USING (true)';

    -- المسجّلون يُنشئون تقييم
    EXECUTE 'CREATE POLICY of_insert ON public.order_feedback FOR INSERT WITH CHECK (auth.uid() IS NOT NULL)';

    -- المستخدم يحدّث تقييمه
    EXECUTE 'CREATE POLICY of_update_own ON public.order_feedback FOR UPDATE USING (
      reviewer_user_id = auth.uid()
      OR reviewer_user_id = public.current_app_user_id()
    )';

    -- الموظفون يحدّثون ويحذفون
    EXECUTE 'CREATE POLICY of_manage_staff ON public.order_feedback FOR ALL USING (public.is_staff_user())';

    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_feedback TO authenticated';
    EXECUTE 'GRANT SELECT ON public.order_feedback TO anon';
  END IF;
END $$;


-- =============================================================
-- الخطوة 9: إصلاح notifications
-- =============================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='notifications'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', p.policyname); END LOOP;
END $$;

CREATE POLICY notif_select_own ON public.notifications
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
  );

CREATE POLICY notif_select_staff ON public.notifications
  FOR SELECT USING (public.is_staff_user());

CREATE POLICY notif_update_own ON public.notifications
  FOR UPDATE USING (
    user_id = auth.uid()
    OR user_id = public.current_app_user_id()
  );

CREATE POLICY notif_insert ON public.notifications
  FOR INSERT WITH CHECK (true);


-- =============================================================
-- الخطوة 10: إصلاح wallets + wallet_transactions
-- =============================================================

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='wallets'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallets', p.policyname); END LOOP;
END $$;

CREATE POLICY wallets_select_own ON public.wallets
  FOR SELECT USING (user_id = auth.uid() OR user_id = public.current_app_user_id());

CREATE POLICY wallets_select_staff ON public.wallets
  FOR SELECT USING (public.is_staff_user());

CREATE POLICY wallets_insert ON public.wallets
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id = public.current_app_user_id());

CREATE POLICY wallets_update_own ON public.wallets
  FOR UPDATE USING (user_id = auth.uid() OR user_id = public.current_app_user_id());

CREATE POLICY wallets_update_staff ON public.wallets
  FOR UPDATE USING (public.is_staff_user());

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='wallet_transactions'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallet_transactions', p.policyname); END LOOP;
END $$;

CREATE POLICY wt_select_own ON public.wallet_transactions
  FOR SELECT USING (user_id = auth.uid() OR user_id = public.current_app_user_id());

CREATE POLICY wt_select_staff ON public.wallet_transactions
  FOR SELECT USING (public.is_staff_user());

CREATE POLICY wt_insert ON public.wallet_transactions
  FOR INSERT WITH CHECK (true);


-- =============================================================
-- الخطوة 11: الجداول العامة (products, reviews, restaurants, categories, coupons)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='products'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.products', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY products_read ON public.products FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY products_manage_staff ON public.products FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT ON public.products TO anon, authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reviews') THEN
    ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='reviews'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.reviews', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY reviews_read ON public.reviews FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY reviews_insert ON public.reviews FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY reviews_update ON public.reviews FOR UPDATE USING (
      reviewer_user_id = auth.uid() OR user_id::text = auth.uid()::text OR public.is_staff_user()
    )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.reviews TO authenticated';
    EXECUTE 'GRANT SELECT ON public.reviews TO anon';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='restaurants') THEN
    ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='restaurants'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.restaurants', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY restaurants_read ON public.restaurants FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY restaurants_manage_staff ON public.restaurants FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT ON public.restaurants TO anon, authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='categories'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.categories', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY categories_read ON public.categories FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY categories_manage_staff ON public.categories FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT ON public.categories TO anon, authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='coupons') THEN
    ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='coupons'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.coupons', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY coupons_read ON public.coupons FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY coupons_manage_staff ON public.coupons FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT ON public.coupons TO anon, authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 12: جداول إضافية (delivery_proofs, order_status_history, etc)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='delivery_proofs') THEN
    ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='delivery_proofs'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.delivery_proofs', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY dp_select_staff ON public.delivery_proofs FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY dp_select_own ON public.delivery_proofs FOR SELECT USING (
      is_visible_to_customer = true AND public.user_can_access_order(order_id)
    )';
    EXECUTE 'CREATE POLICY dp_insert ON public.delivery_proofs FOR INSERT WITH CHECK (
      public.is_staff_user() OR uploaded_by = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY dp_update ON public.delivery_proofs FOR UPDATE USING (
      public.is_staff_user() OR uploaded_by = public.current_app_user_id()
    )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.delivery_proofs TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_status_history') THEN
    ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='order_status_history'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_status_history', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY osh_read ON public.order_status_history FOR SELECT USING (
      public.is_staff_user() OR public.user_can_access_order(order_id)
    )';
    EXECUTE 'CREATE POLICY osh_insert ON public.order_status_history FOR INSERT WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT ON public.order_status_history TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_share_links') THEN
    ALTER TABLE public.order_share_links ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='order_share_links'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_share_links', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY osl_select ON public.order_share_links FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY osl_insert ON public.order_share_links FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY osl_update ON public.order_share_links FOR UPDATE USING (true)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.order_share_links TO authenticated';
    EXECUTE 'GRANT SELECT ON public.order_share_links TO anon';
  END IF;
END $$;


-- =============================================================
-- الخطوة 13: wasel_plus_memberships, abandoned_carts, suspicious_log
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wasel_plus_memberships') THEN
    ALTER TABLE public.wasel_plus_memberships ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='wasel_plus_memberships'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.wasel_plus_memberships', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY memberships_read ON public.wasel_plus_memberships FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY memberships_insert ON public.wasel_plus_memberships FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY memberships_manage ON public.wasel_plus_memberships FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT, INSERT ON public.wasel_plus_memberships TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='abandoned_carts') THEN
    ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='abandoned_carts'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.abandoned_carts', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY ac_select_own ON public.abandoned_carts FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY ac_insert ON public.abandoned_carts FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY ac_update_own ON public.abandoned_carts FOR UPDATE USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY ac_manage_staff ON public.abandoned_carts FOR ALL USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.abandoned_carts TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='suspicious_activities_log') THEN
    ALTER TABLE public.suspicious_activities_log ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='suspicious_activities_log'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.suspicious_activities_log', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY sal_insert ON public.suspicious_activities_log FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY sal_select_staff ON public.suspicious_activities_log FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'GRANT INSERT, SELECT ON public.suspicious_activities_log TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 14: favorites, cash_gifts, cart_share_links
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='favorites') THEN
    ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='favorites'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.favorites', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY fav_select_own ON public.favorites FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY fav_insert ON public.favorites FOR INSERT WITH CHECK (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY fav_delete ON public.favorites FOR DELETE USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_gifts') THEN
    ALTER TABLE public.cash_gifts ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cash_gifts'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.cash_gifts', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY cg_select_own ON public.cash_gifts FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY cg_insert ON public.cash_gifts FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY cg_select_staff ON public.cash_gifts FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT, INSERT ON public.cash_gifts TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cart_share_links') THEN
    ALTER TABLE public.cart_share_links ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cart_share_links'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.cart_share_links', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY csl_select ON public.cart_share_links FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY csl_insert ON public.cart_share_links FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY csl_update ON public.cart_share_links FOR UPDATE USING (true)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.cart_share_links TO authenticated';
    EXECUTE 'GRANT SELECT ON public.cart_share_links TO anon';
  END IF;
END $$;


-- =============================================================
-- الخطوة 15: direct_messages + conversations (الشات الجديد)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='direct_messages') THEN
    ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='direct_messages'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.direct_messages', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY dm_select ON public.direct_messages FOR SELECT USING (
      sender_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids))
      OR public.is_staff_user()
    )';
    EXECUTE 'CREATE POLICY dm_insert ON public.direct_messages FOR INSERT WITH CHECK (
      sender_id = auth.uid() OR public.is_staff_user()
    )';
    EXECUTE 'GRANT SELECT, INSERT ON public.direct_messages TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversations') THEN
    ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='conversations'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY conv_select ON public.conversations FOR SELECT USING (
      auth.uid() = ANY(participant_ids) OR public.is_staff_user()
    )';
    EXECUTE 'CREATE POLICY conv_insert ON public.conversations FOR INSERT WITH CHECK (
      auth.uid() = ANY(participant_ids) OR public.is_staff_user()
    )';
    EXECUTE 'CREATE POLICY conv_update ON public.conversations FOR UPDATE USING (
      auth.uid() = ANY(participant_ids) OR public.is_staff_user()
    )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 16: جداول أخرى (courier_referrals, courier_payout_resets, etc)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='courier_referrals') THEN
    ALTER TABLE public.courier_referrals ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='courier_referrals'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.courier_referrals', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY cr_select ON public.courier_referrals FOR SELECT USING (
      referrer_id = auth.uid() OR referred_id = auth.uid() OR public.is_staff_user()
    )';
    EXECUTE 'CREATE POLICY cr_insert ON public.courier_referrals FOR INSERT WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT ON public.courier_referrals TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='courier_payout_resets') THEN
    ALTER TABLE public.courier_payout_resets ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='courier_payout_resets'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.courier_payout_resets', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY cpr_select ON public.courier_payout_resets FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY cpr_insert ON public.courier_payout_resets FOR INSERT WITH CHECK (public.is_staff_user())';
    EXECUTE 'GRANT SELECT, INSERT ON public.courier_payout_resets TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_profiles') THEN
    ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin_profiles'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_profiles', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY ap_select_self ON public.admin_profiles FOR SELECT USING (user_id = auth.uid())';
    EXECUTE 'CREATE POLICY ap_select_staff ON public.admin_profiles FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY ap_manage ON public.admin_profiles FOR ALL USING (public.is_admin_like())';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.admin_profiles TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='delivery_profiles') THEN
    ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='delivery_profiles'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.delivery_profiles', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY delp_select_own ON public.delivery_profiles FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY delp_select_staff ON public.delivery_profiles FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY delp_manage ON public.delivery_profiles FOR ALL USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id() OR public.is_staff_user()
    )';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.delivery_profiles TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_logs') THEN
    ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin_logs'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_logs', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY al_select_staff ON public.admin_logs FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY al_insert ON public.admin_logs FOR INSERT WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT ON public.admin_logs TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notification_history') THEN
    ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='notification_history'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.notification_history', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY nh_select_own ON public.notification_history FOR SELECT USING (
      user_id = auth.uid() OR public.is_staff_user()
    )';
    EXECUTE 'CREATE POLICY nh_insert ON public.notification_history FOR INSERT WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT ON public.notification_history TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 17: إصلاح payments + audit_logs
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payments') THEN
    ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='payments'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.payments', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY pay_select_own ON public.payments FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY pay_select_staff ON public.payments FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY pay_insert ON public.payments FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY pay_update_staff ON public.payments FOR UPDATE USING (public.is_staff_user())';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_logs') THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    DECLARE p record; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs'
      LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs', p.policyname); END LOOP;
    END;
    EXECUTE 'CREATE POLICY audit_select_staff ON public.audit_logs FOR SELECT USING (public.is_staff_user())';
    EXECUTE 'CREATE POLICY audit_insert ON public.audit_logs FOR INSERT WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT ON public.audit_logs TO authenticated';
  END IF;
END $$;


-- =============================================================
-- الخطوة 18: GRANTS الأساسية (تأمين أن authenticated يمكنه الوصول)
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wallets TO authenticated;
GRANT SELECT, INSERT ON public.wallet_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.courier_profiles TO authenticated;

-- Anon (guest checkout)
GRANT INSERT, SELECT ON public.orders TO anon;
GRANT INSERT, SELECT ON public.order_items TO anon;

-- Grant RPC functions
DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_compatible_order_v2(jsonb) TO authenticated, anon';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.generate_order_number() TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.wallet_pay(uuid, numeric, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.decrement_free_orders(uuid, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_free_orders_remaining() TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_cash_gift(uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, text, numeric, numeric, text, timestamptz) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_cart_share_link(jsonb, int) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.init_user_order_tracking(uuid, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_product_avg_rating(uuid) TO authenticated, anon';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_reviews_summary() TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL; END $$;


-- =============================================================
-- الخطوة 19: 🔧 إصلاح حرج — ربط auth_id في جدول users لكل المشرفين والموصلين
-- (لأن كثير من السياسات تفحص auth_id = auth.uid())
-- =============================================================

-- ربط admin_users.id (=auth.users.id) مع public.users.auth_id
UPDATE public.users u
SET auth_id = au.id
FROM public.admin_users au
WHERE LOWER(u.email) = LOWER(au.email)
  AND u.auth_id IS DISTINCT FROM au.id;

-- ربط بناءً على auth.users مباشرة
UPDATE public.users pu
SET auth_id = a.id
FROM auth.users a
WHERE LOWER(pu.email) = LOWER(a.email)
  AND pu.auth_id IS DISTINCT FROM a.id;


COMMIT;

-- =============================================================
-- ✅ انتهى! الآن يجب أن يعمل المشرف والموصل
-- 
-- إذا كان الموصل مسجل فقط في admin_users بدور delivery_person
-- ولم يكن له سطر في courier_profiles، أنشئ له واحد:
--
-- INSERT INTO public.courier_profiles (user_id, onboarding_completed)
-- SELECT au.id, true
-- FROM public.admin_users au
-- WHERE au.role = 'delivery_person'
--   AND NOT EXISTS (
--     SELECT 1 FROM public.courier_profiles cp WHERE cp.user_id = au.id
--   );
-- =============================================================
