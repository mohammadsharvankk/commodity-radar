
CREATE TABLE public.candles (
  instrument text NOT NULL,
  timeframe text NOT NULL,
  ts timestamptz NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (instrument, timeframe, ts)
);
GRANT SELECT ON public.candles TO authenticated;
GRANT ALL ON public.candles TO service_role;
ALTER TABLE public.candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read candles" ON public.candles FOR SELECT TO authenticated USING (true);

CREATE TABLE public.news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL UNIQUE,
  title_key text NOT NULL UNIQUE,
  title text NOT NULL,
  source text,
  published_at timestamptz NOT NULL DEFAULT now(),
  tagged boolean NOT NULL DEFAULT false,
  instruments text[] NOT NULL DEFAULT '{}',
  sentiment jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact int NOT NULL DEFAULT 1,
  reason text,
  alerted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_pub_idx ON public.news (published_at DESC);
GRANT SELECT ON public.news TO authenticated;
GRANT ALL ON public.news TO service_role;
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read news" ON public.news FOR SELECT TO authenticated USING (true);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rule text NOT NULL DEFAULT 'manual', -- weekly | first_friday | manual
  weekday int, -- 0=Sun..6=Sat (New York)
  local_time text NOT NULL DEFAULT '08:30',
  tz text NOT NULL DEFAULT 'America/New_York',
  instruments text[] NOT NULL DEFAULT '{WTI,SILVER,GOLD}',
  impact int NOT NULL DEFAULT 3,
  context_only boolean NOT NULL DEFAULT false,
  higher_is_bullish boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all events" ON public.events FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.event_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  consensus double precision,
  previous double precision,
  actual double precision,
  notes text,
  UNIQUE (event_id, ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_dates TO authenticated;
GRANT ALL ON public.event_dates TO service_role;
ALTER TABLE public.event_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all event_dates" ON public.event_dates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.pattern_stats (
  instrument text PRIMARY KEY,
  data jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pattern_stats TO authenticated;
GRANT ALL ON public.pattern_stats TO service_role;
ALTER TABLE public.pattern_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stats" ON public.pattern_stats FOR SELECT TO authenticated USING (true);

CREATE TABLE public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  alert_types jsonb NOT NULL DEFAULT '{}'::jsonb,
  sudden_x double precision NOT NULL DEFAULT 1.5,
  cooldown_min int NOT NULL DEFAULT 60,
  quiet_enabled boolean NOT NULL DEFAULT false,
  quiet_start text NOT NULL DEFAULT '00:00',
  quiet_end text NOT NULL DEFAULT '07:00',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all settings" ON public.settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.settings (id) VALUES (1);

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  instrument text,
  dedupe_key text UNIQUE,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_created_idx ON public.alerts (created_at DESC);
GRANT SELECT ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read alerts" ON public.alerts FOR SELECT TO authenticated USING (true);

CREATE TABLE public.job_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_state TO authenticated;
GRANT ALL ON public.job_state TO service_role;
ALTER TABLE public.job_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read job_state" ON public.job_state FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.try_job_lock(_name text, _seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  INSERT INTO public.job_state(key, value, updated_at)
  VALUES ('lock:' || _name, jsonb_build_object('until', now() + make_interval(secs => _seconds)), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now()
    WHERE (public.job_state.value->>'until')::timestamptz < now()
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;
REVOKE ALL ON FUNCTION public.try_job_lock(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_job_lock(text, int) TO service_role;

-- Single-user app: block any sign-up after the first account exists.
CREATE OR REPLACE FUNCTION public.only_first_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Sign-ups are closed for this app';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER only_first_user_trg BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.only_first_user();

-- Seed recurring events (times in New York)
INSERT INTO public.events (name, rule, weekday, local_time, instruments, impact, context_only, higher_is_bullish) VALUES
 ('API Weekly Crude Inventory', 'weekly', 2, '16:30', '{WTI}', 3, false, false),
 ('EIA Weekly Petroleum Status Report', 'weekly', 3, '10:30', '{WTI}', 5, false, false),
 ('EIA Natural Gas Storage', 'weekly', 4, '10:30', '{WTI}', 1, true, false),
 ('Baker Hughes Rig Count', 'weekly', 5, '13:00', '{WTI}', 2, false, false),
 ('US Nonfarm Payrolls', 'first_friday', 5, '08:30', '{WTI,SILVER,GOLD}', 5, false, false),
 ('US CPI', 'manual', NULL, '08:30', '{WTI,SILVER,GOLD}', 5, false, false),
 ('FOMC Decision', 'manual', NULL, '14:00', '{WTI,SILVER,GOLD}', 5, false, false);

INSERT INTO public.event_dates (event_id, ts)
SELECT e.id, (d || ' 14:00')::timestamp AT TIME ZONE 'America/New_York'
FROM public.events e, unnest(ARRAY['2025-01-29','2025-03-19','2025-05-07','2025-06-18','2025-07-30','2025-09-17','2025-10-29','2025-12-10',
 '2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09']) AS d
WHERE e.name = 'FOMC Decision';
