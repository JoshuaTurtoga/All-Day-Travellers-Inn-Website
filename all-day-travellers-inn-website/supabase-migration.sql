-- =============================================================
-- InnSight PMS — Complete Supabase Migration
-- Run this in the Supabase SQL Editor to set up all tables,
-- RLS policies, functions, and seed data.
-- =============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ==================== ENUMS ====================

CREATE TYPE public.app_role AS ENUM ('admin', 'front_desk');
CREATE TYPE public.room_status AS ENUM ('vacant_clean', 'vacant_dirty', 'cleaning');
CREATE TYPE public.room_type AS ENUM ('Double', 'Deluxe', 'Family');
CREATE TYPE public.booking_status AS ENUM ('confirmed', 'in_house', 'checked_out', 'cancelled');
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'refunded');

-- ==================== TABLES ====================

-- Rooms
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number TEXT NOT NULL UNIQUE,
  room_type public.room_type NOT NULL,
  base_rate NUMERIC(10,2) NOT NULL CHECK (base_rate > 0),
  status public.room_status NOT NULL DEFAULT 'vacant_clean',
  floor INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guests
CREATE TABLE public.guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  id_type TEXT,
  id_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bookings (with exclusion constraint to prevent double-booking)
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0),
  payment_option TEXT NOT NULL DEFAULT 'on_check_out' CHECK (payment_option IN ('before_check_in', 'on_check_out')),
  add_ons JSONB,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_dates CHECK (check_out_date > check_in_date),
  -- Prevent overlapping bookings for the same room (only for active bookings)
  CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in_date, check_out_date) WITH &&
  ) WHERE (status NOT IN ('checked_out', 'cancelled'))
);

-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  room_rate NUMERIC(10,2) NOT NULL,
  num_nights INTEGER NOT NULL CHECK (num_nights > 0),
  subtotal NUMERIC(10,2) NOT NULL,
  tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  tax_amount NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL,
  payment_status public.payment_status NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  payment_timing TEXT NOT NULL DEFAULT 'on_check_out' CHECK (payment_timing IN ('before_check_in', 'on_check_out')),
  amount_received NUMERIC(10,2),
  change_amount NUMERIC(10,2),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Roles (separate from profiles to avoid privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- ==================== AUTO-UPDATE TIMESTAMPS ====================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER guests_updated_at BEFORE UPDATE ON public.guests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ==================== SECURITY DEFINER FUNCTION ====================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Helper: check if user has ANY role (is authenticated staff)
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
  )
$$;

-- ==================== ENABLE RLS ====================

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ==================== RLS POLICIES ====================

-- ROOMS: All staff can read, only admin can modify
CREATE POLICY "Staff can view rooms" ON public.rooms
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admin can insert rooms" ON public.rooms
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update rooms" ON public.rooms
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete rooms" ON public.rooms
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- GUESTS: All staff can read and insert, only admin can delete
CREATE POLICY "Staff can view guests" ON public.guests
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can insert guests" ON public.guests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff can update guests" ON public.guests
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Admin can delete guests" ON public.guests
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- BOOKINGS: All staff can read/insert, front-desk can update status, admin full
CREATE POLICY "Staff can view bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can insert bookings" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff can update bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Admin can delete bookings" ON public.bookings
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- INVOICES: All staff can read/insert, admin full control
CREATE POLICY "Staff can view invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can insert invoices" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Admin can update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Admin can delete invoices" ON public.invoices
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- USER_ROLES: Only admin can manage, users can read own role
CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ==================== INVOICE NUMBER SEQUENCE ====================

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := 'INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_invoice_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_invoice_number();

-- ==================== SEED DATA: 8 ROOMS ====================

INSERT INTO public.rooms (room_number, room_type, base_rate, status, floor, description) VALUES
  ('101', 'Double', 1500.00, 'vacant_clean', 1, 'Standard double room with city view'),
  ('102', 'Double', 1500.00, 'vacant_clean', 1, 'Standard double room with garden view'),
  ('103', 'Deluxe', 2500.00, 'vacant_clean', 1, 'Deluxe room with king bed and balcony'),
  ('201', 'Double', 1500.00, 'vacant_clean', 2, 'Standard double room with city view'),
  ('202', 'Deluxe', 2500.00, 'vacant_clean', 2, 'Deluxe room with queen bed and sitting area'),
  ('203', 'Deluxe', 2500.00, 'vacant_clean', 2, 'Deluxe room with king bed and mini bar'),
  ('301', 'Family', 3500.00, 'vacant_clean', 3, 'Spacious family room with two double beds'),
  ('302', 'Family', 3500.00, 'vacant_clean', 3, 'Family suite with separate living area');

-- ==================== NOTES ====================
-- Schema patch for existing deployments (safe to re-run)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guest_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_option TEXT NOT NULL DEFAULT 'on_check_out';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS add_ons JSONB;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS check_in_at TIMESTAMPTZ;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expected_check_out_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_payment_option_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_payment_option_check
      CHECK (payment_option IN ('before_check_in', 'on_check_out'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'Staff can update invoices'
  ) THEN
    CREATE POLICY "Staff can update invoices" ON public.invoices
      FOR UPDATE TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_guest_count_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_guest_count_check
      CHECK (guest_count > 0);
  END IF;
END
$$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_timing TEXT NOT NULL DEFAULT 'on_check_out';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(10,2);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_payment_timing_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_payment_timing_check
      CHECK (payment_timing IN ('before_check_in', 'on_check_out'));
  END IF;
END
$$;

-- After running this migration:
-- 1. Create your first admin user via Supabase Auth (Dashboard > Authentication > Users)
-- 2. Then insert their role:
--    INSERT INTO public.user_roles (user_id, role)
--    VALUES ('<the-user-uuid-from-step-1>', 'admin');
