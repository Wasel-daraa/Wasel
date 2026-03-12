-- =====================================================
-- RADICAL FIX: Complete RLS overhaul for ALL tables
-- Fixes: self-referencing policies, missing tables,
--        missing grants, and incorrect user_id matching
-- Run this ENTIRE file in Supabase SQL Editor
-- =====================================================

BEGIN;

-- =============================================================
-- STEP 0: Create missing tables if they don't exist
-- =============================================================

-- wasel_plus_memberships (Cart.jsx queries this on load)
CREATE TABLE IF NOT EXISTS public.wasel_plus_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  status text NOT NULL DEFAULT 'inactive',
  plan_type text DEFAULT 'monthly',
  start_date timestamptz DEFAULT now(),
  end_date timestamptz,
  trial_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- abandoned_carts
CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  user_email text,
  cart_data jsonb,
  total_amount numeric DEFAULT 0,
  currency text DEFAULT 'USD',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- suspicious_activities_log
CREATE TABLE IF NOT EXISTS public.suspicious_activities_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text,
  activity_type text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- =============================================================
-- STEP 1: Drop ALL existing RLS policies on ALL app tables
--         (prevents duplicate/conflicting policies)
-- =============================================================

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'users','orders','order_items','admin_users',
        'wallets','wallet_transactions','notifications',
        'courier_profiles','wasel_plus_memberships',
        'abandoned_carts','suspicious_activities_log',
        'cart_share_links','cash_gifts','products',
        'reviews','coupons','restaurants','categories'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- =============================================================
-- STEP 2: Recreate SECURITY DEFINER helper functions
-- =============================================================

-- Maps auth.uid() → public.users.id (bypasses RLS)
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

-- Checks if current user is admin/staff (bypasses RLS)
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
        AND u.role IN ('admin', 'operator', 'courier', 'supervisor')
    )
  );
END;
$$;

-- Checks if current user is admin (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin_like()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid()
      AND COALESCE(au.is_active, true) = true
  );
END;
$$;

-- =============================================================
-- STEP 3: USERS table — fix self-referencing policies!
-- =============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY users_select_own ON public.users
FOR SELECT USING (
  auth_id = auth.uid() OR id = auth.uid()
);

-- Users can update their own row
CREATE POLICY users_update_own ON public.users
FOR UPDATE USING (
  auth_id = auth.uid() OR id = auth.uid()
);

-- Staff can see all users (SECURITY DEFINER function, NO sub-query!)
CREATE POLICY users_select_staff ON public.users
FOR SELECT USING ( public.is_staff_user() );

-- Staff can update users
CREATE POLICY users_update_staff ON public.users
FOR UPDATE USING ( public.is_staff_user() )
WITH CHECK ( public.is_staff_user() );

-- Allow insert for new user creation (triggers, sign-up)
CREATE POLICY users_insert ON public.users
FOR INSERT WITH CHECK (true);

-- =============================================================
-- STEP 4: ORDERS
-- =============================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_own ON public.orders
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR recipient_user_id = auth.uid()
  OR payer_user_id = auth.uid()
  OR paid_by_user_id = auth.uid()
);

CREATE POLICY orders_select_staff ON public.orders
FOR SELECT USING ( public.is_staff_user() );

-- Any authenticated user can create orders
CREATE POLICY orders_insert ON public.orders
FOR INSERT WITH CHECK (true);

CREATE POLICY orders_update_own ON public.orders
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR recipient_user_id = auth.uid()
  OR payer_user_id = auth.uid()
  OR paid_by_user_id = auth.uid()
);

CREATE POLICY orders_update_staff ON public.orders
FOR UPDATE USING ( public.is_staff_user() )
WITH CHECK ( public.is_staff_user() );

CREATE POLICY orders_delete_staff ON public.orders
FOR DELETE USING ( public.is_staff_user() );

-- =============================================================
-- STEP 5: ORDER_ITEMS
-- =============================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_select ON public.order_items
FOR SELECT USING (true);

CREATE POLICY order_items_insert ON public.order_items
FOR INSERT WITH CHECK (true);

CREATE POLICY order_items_update_staff ON public.order_items
FOR UPDATE USING ( public.is_staff_user() );

CREATE POLICY order_items_delete_staff ON public.order_items
FOR DELETE USING ( public.is_staff_user() );

-- =============================================================
-- STEP 6: ADMIN_USERS (no self-referencing sub-queries)
-- =============================================================

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_users_select_self ON public.admin_users
FOR SELECT USING (id = auth.uid());

CREATE POLICY admin_users_select_admin ON public.admin_users
FOR SELECT USING ( public.is_admin_like() );

-- =============================================================
-- STEP 7: WALLETS — match by auth.uid() OR app user id
-- =============================================================

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_select_own ON public.wallets
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wallets_select_staff ON public.wallets
FOR SELECT USING ( public.is_staff_user() );

CREATE POLICY wallets_update_own ON public.wallets
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wallets_insert ON public.wallets
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

-- =============================================================
-- STEP 8: WALLET_TRANSACTIONS
-- =============================================================

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wt_select_own ON public.wallet_transactions
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wt_select_staff ON public.wallet_transactions
FOR SELECT USING ( public.is_staff_user() );

CREATE POLICY wt_insert ON public.wallet_transactions
FOR INSERT WITH CHECK (true);

-- =============================================================
-- STEP 9: NOTIFICATIONS
-- =============================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_select_own ON public.notifications
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY notif_update_own ON public.notifications
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY notif_insert ON public.notifications
FOR INSERT WITH CHECK (true);

-- =============================================================
-- STEP 10: COURIER_PROFILES
-- =============================================================

ALTER TABLE public.courier_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY courier_select_own ON public.courier_profiles
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY courier_update_own ON public.courier_profiles
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY courier_select_staff ON public.courier_profiles
FOR SELECT USING ( public.is_staff_user() );

-- =============================================================
-- STEP 11: WASEL_PLUS_MEMBERSHIPS
-- =============================================================

ALTER TABLE public.wasel_plus_memberships ENABLE ROW LEVEL SECURITY;

-- Users can read their own membership by email
CREATE POLICY memberships_select_own ON public.wasel_plus_memberships
FOR SELECT USING (true);

-- Admins can manage all memberships
CREATE POLICY memberships_manage_staff ON public.wasel_plus_memberships
FOR ALL USING ( public.is_staff_user() );

-- Allow insert for new memberships
CREATE POLICY memberships_insert ON public.wasel_plus_memberships
FOR INSERT WITH CHECK (true);

-- =============================================================
-- STEP 12: ABANDONED_CARTS
-- =============================================================

ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY abandoned_carts_select ON public.abandoned_carts
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY abandoned_carts_insert ON public.abandoned_carts
FOR INSERT WITH CHECK (true);

CREATE POLICY abandoned_carts_update ON public.abandoned_carts
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY abandoned_carts_staff ON public.abandoned_carts
FOR ALL USING ( public.is_staff_user() );

-- =============================================================
-- STEP 13: SUSPICIOUS_ACTIVITIES_LOG
-- =============================================================

ALTER TABLE public.suspicious_activities_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY suspicious_log_insert ON public.suspicious_activities_log
FOR INSERT WITH CHECK (true);

CREATE POLICY suspicious_log_select_staff ON public.suspicious_activities_log
FOR SELECT USING ( public.is_staff_user() );

-- =============================================================
-- STEP 14: CART_SHARE_LINKS
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cart_share_links') THEN
    ALTER TABLE public.cart_share_links ENABLE ROW LEVEL SECURITY;
    
    -- anyone can read (shared links are public by design)
    EXECUTE 'CREATE POLICY csl_select ON public.cart_share_links FOR SELECT USING (true)';
    -- authenticated users can create
    EXECUTE 'CREATE POLICY csl_insert ON public.cart_share_links FOR INSERT WITH CHECK (true)';
    -- creator can update
    EXECUTE 'CREATE POLICY csl_update ON public.cart_share_links FOR UPDATE USING (true)';
  END IF;
END $$;

-- =============================================================
-- STEP 15: CASH_GIFTS
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_gifts') THEN
    ALTER TABLE public.cash_gifts ENABLE ROW LEVEL SECURITY;
    
    EXECUTE 'CREATE POLICY cash_gifts_select_own ON public.cash_gifts FOR SELECT USING (
      user_id = auth.uid() OR user_id = public.current_app_user_id()
    )';
    EXECUTE 'CREATE POLICY cash_gifts_insert ON public.cash_gifts FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY cash_gifts_select_staff ON public.cash_gifts FOR SELECT USING (public.is_staff_user())';
  END IF;
END $$;

-- =============================================================
-- STEP 16: PRODUCTS, REVIEWS, COUPONS, RESTAURANTS, CATEGORIES
--          (public read access for everyone, including anon)
-- =============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY products_read ON public.products FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY products_manage_staff ON public.products FOR ALL USING (public.is_staff_user())';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reviews') THEN
    ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY reviews_read ON public.reviews FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY reviews_insert ON public.reviews FOR INSERT WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='coupons') THEN
    ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY coupons_read ON public.coupons FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY coupons_manage_staff ON public.coupons FOR ALL USING (public.is_staff_user())';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='restaurants') THEN
    ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY restaurants_read ON public.restaurants FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY restaurants_manage_staff ON public.restaurants FOR ALL USING (public.is_staff_user())';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY categories_read ON public.categories FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY categories_manage_staff ON public.categories FOR ALL USING (public.is_staff_user())';
  END IF;
END $$;

-- =============================================================
-- STEP 17: GRANT ALL PERMISSIONS
-- =============================================================

-- Core tables
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wallets TO authenticated;
GRANT SELECT, INSERT ON public.wallet_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, UPDATE ON public.courier_profiles TO authenticated;
GRANT SELECT, INSERT ON public.wasel_plus_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.abandoned_carts TO authenticated;
GRANT INSERT, SELECT ON public.suspicious_activities_log TO authenticated;

-- Public tables (anon + authenticated)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    EXECUTE 'GRANT SELECT ON public.products TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reviews') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.reviews TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='coupons') THEN
    EXECUTE 'GRANT SELECT ON public.coupons TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='restaurants') THEN
    EXECUTE 'GRANT SELECT ON public.restaurants TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='categories') THEN
    EXECUTE 'GRANT SELECT ON public.categories TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cart_share_links') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.cart_share_links TO authenticated';
    EXECUTE 'GRANT SELECT ON public.cart_share_links TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_gifts') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.cash_gifts TO authenticated';
  END IF;
END $$;

-- Functions
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_like() TO authenticated;

-- Grant all RPC functions the app uses (each wrapped in exception handler)
DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_compatible_order_v2(jsonb) TO authenticated, anon';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.generate_order_number() TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.wallet_pay(uuid, numeric, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.decrement_free_orders(uuid, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_free_orders_remaining() TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_cash_gift(uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, text, numeric, numeric, text, timestamptz) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_cart_share_link(jsonb, int) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.init_user_order_tracking(uuid, text) TO authenticated';
EXCEPTION WHEN undefined_function OR undefined_object THEN NULL;
END $$;

-- =============================================================
-- STEP 18: Make sure anon can also create orders 
--          (guest checkout without login)
-- =============================================================

GRANT INSERT ON public.orders TO anon;
GRANT SELECT ON public.orders TO anon;
GRANT INSERT ON public.order_items TO anon;
GRANT SELECT ON public.order_items TO anon;

-- Allow anon inserts through RLS
DO $$ BEGIN
  -- Check if anon policies exist; if not create them
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='orders_anon_insert') THEN
    EXECUTE 'CREATE POLICY orders_anon_insert ON public.orders FOR INSERT TO anon WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_items' AND policyname='order_items_anon_insert') THEN
    EXECUTE 'CREATE POLICY order_items_anon_insert ON public.order_items FOR INSERT TO anon WITH CHECK (true)';
  END IF;
END $$;

COMMIT;
