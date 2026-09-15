-- Enable RLS on all tables
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots   ENABLE ROW LEVEL SECURITY;

-- users: each user sees and manages only their own row
CREATE POLICY "users: own row" ON users
  FOR ALL USING (id = auth.uid());

-- connected_accounts: scoped to the owning user
CREATE POLICY "connected_accounts: own rows" ON connected_accounts
  FOR ALL USING (user_id = auth.uid());

-- metric_snapshots: accessible only through owned connected_accounts
CREATE POLICY "metric_snapshots: own rows" ON metric_snapshots
  FOR ALL USING (
    connected_account_id IN (
      SELECT id FROM connected_accounts WHERE user_id = auth.uid()
    )
  );

-- Sync auth.users → public.users on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at)
  VALUES (NEW.id, NEW.email, NEW.created_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
