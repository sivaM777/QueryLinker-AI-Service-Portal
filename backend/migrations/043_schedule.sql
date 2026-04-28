DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
    CREATE TYPE shift_type AS ENUM ('MORNING', 'EVENING', 'NIGHT', 'OFF');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_off_status') THEN
    CREATE TYPE time_off_status AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS schedule_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type shift_type NOT NULL,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_shifts_user_date
  ON schedule_shifts(user_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_schedule_shifts_date
  ON schedule_shifts(shift_date);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NULL,
  status time_off_status NOT NULL DEFAULT 'PENDING',
  approver_id UUID NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_user
  ON time_off_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_status
  ON time_off_requests(status);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_date
  ON time_off_requests(start_date, end_date);
