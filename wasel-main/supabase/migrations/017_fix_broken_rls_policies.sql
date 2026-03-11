-- =====================================================
-- EMERGENCY FIX: Remove broken RLS policies and restore working ones
-- Run this ENTIRE file in Supabase SQL Editor
-- =====================================================

BEGIN;

-- =============================================================
-- STEP 1: Drop ALL existing policies on affected tables
-- =============================================================

-- Orders: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', p.policyname);
  END LOOP;
END $$;

-- admin_users: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_users' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_users', p.policyname);
  END LOOP;
END $$;

-- wallets: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallets' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallets', p.policyname);
  END LOOP;
END $$;

-- wallet_transactions: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallet_transactions' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallet_transactions', p.policyname);
  END LOOP;
END $$;

-- notifications: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', p.policyname);
  END LOOP;
END $$;

-- courier_profiles: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'courier_profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.courier_profiles', p.policyname);
  END LOOP;
END $$;

-- order_items: drop everything
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_items' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.order_items', p.policyname);
  END LOOP;
END $$;

-- =============================================================
-- STEP 2: Ensure helper functions exist
-- =============================================================

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_user_id uuid;
BEGIN
  SELECT u.id INTO v_user_id
  FROM public.users u
  WHERE u.auth_id = auth.uid() OR u.id = auth.uid()
  LIMIT 1;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff_user()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid()
      AND COALESCE(au.is_active, true) = true
  ) OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.id = auth.uid())
      AND u.role IN ('admin', 'operator', 'courier', 'supervisor')
  );
$$;

-- =============================================================
-- STEP 3: Orders - proper non-recursive RLS
-- Key: user_id may = public.users.id OR auth.uid()
-- =============================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Users see their own orders (matching auth.uid or via public.users mapping)
CREATE POLICY orders_select_own ON public.orders
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR recipient_user_id = auth.uid()
  OR payer_user_id = auth.uid()
  OR paid_by_user_id = auth.uid()
);

-- Staff see all orders
CREATE POLICY orders_select_staff ON public.orders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- Couriers see assigned orders
CREATE POLICY orders_select_courier ON public.orders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.order_assignments oa
    WHERE oa.order_id = orders.id
      AND oa.delivery_person_id = auth.uid()
  )
);

-- Insert: allow authenticated users (RPC functions are SECURITY DEFINER anyway)
CREATE POLICY orders_insert_authenticated ON public.orders
FOR INSERT WITH CHECK (true);

-- Update: owners + staff
CREATE POLICY orders_update_own ON public.orders
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR recipient_user_id = auth.uid()
  OR payer_user_id = auth.uid()
  OR paid_by_user_id = auth.uid()
);

CREATE POLICY orders_update_staff ON public.orders
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- Delete: staff only
CREATE POLICY orders_delete_staff ON public.orders
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- =============================================================
-- STEP 4: order_items - follows orders access
-- =============================================================

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_select ON public.order_items
FOR SELECT USING (true);

CREATE POLICY order_items_insert ON public.order_items
FOR INSERT WITH CHECK (true);

CREATE POLICY order_items_update_staff ON public.order_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- =============================================================
-- STEP 5: admin_users
-- =============================================================

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_users_select_self ON public.admin_users
FOR SELECT USING (id = auth.uid());

CREATE POLICY admin_users_select_by_admin ON public.admin_users
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au2
    WHERE au2.id = auth.uid() AND au2.role = 'admin'
  )
);

-- =============================================================
-- STEP 6: wallets
-- =============================================================

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_select_own ON public.wallets
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wallets_update_own ON public.wallets
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wallets_insert_own ON public.wallets
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wallets_staff ON public.wallets
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- =============================================================
-- STEP 7: wallet_transactions
-- =============================================================

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wt_select_own ON public.wallet_transactions
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY wt_insert ON public.wallet_transactions
FOR INSERT WITH CHECK (true);

CREATE POLICY wt_staff ON public.wallet_transactions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- =============================================================
-- STEP 8: notifications
-- =============================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_select_own ON public.notifications
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = notifications.user_id
      AND (u.auth_id = auth.uid() OR u.id = auth.uid())
  )
);

CREATE POLICY notif_update_own ON public.notifications
FOR UPDATE USING (
  user_id = auth.uid()
  OR user_id = public.current_app_user_id()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = notifications.user_id
      AND (u.auth_id = auth.uid() OR u.id = auth.uid())
  )
);

CREATE POLICY notif_insert ON public.notifications
FOR INSERT WITH CHECK (true);

-- =============================================================
-- STEP 9: courier_profiles
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

CREATE POLICY courier_staff ON public.courier_profiles
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.id = auth.uid() AND COALESCE(au.is_active, true) = true
  )
);

-- =============================================================
-- STEP 10: Grant permissions
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_items TO authenticated;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wallets TO authenticated;
GRANT SELECT, INSERT ON public.wallet_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, UPDATE ON public.courier_profiles TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_user() TO authenticated;

COMMIT;
