-- SAYDAN boshlang'ich sxema (SQLite). Migratsiyalar versiyalangan va faqat oldinga yo'naltirilgan.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,            -- normallashtirilgan (trim + lowercase)
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  password_hash TEXT NOT NULL,           -- scrypt, tuz bilan; hech qachon ochiq matn emas
  nickname TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted','blocked')),
  status_reason TEXT,
  reg_source TEXT,                       -- utm_source / ref / direct
  ref_code TEXT UNIQUE,
  referred_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rollar alohida jadvalda. Foydalanuvchi uni o'zgartira olmaydi: faqat server funksiyalari yozadi.
CREATE TABLE user_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','content_editor','marketer')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Ma'lumotlar bazasi darajasida: bittadan ortiq super_admin bo'lishi mumkin emas.
CREATE UNIQUE INDEX one_super_admin ON user_roles(role) WHERE role = 'super_admin';
-- super_admin yozuvini UPDATE qilib boshqa foydalanuvchiga ko'chirib bo'lmaydi.
CREATE TRIGGER super_admin_immutable
BEFORE UPDATE ON user_roles
WHEN OLD.role = 'super_admin'
BEGIN
  SELECT RAISE(ABORT, 'super_admin yozuvi o''zgartirilmaydi');
END;
-- Boshqa rolni super_admin ga UPDATE orqali ko'tarib bo'lmaydi (faqat INSERT, serverdan).
CREATE TRIGGER no_promote_by_update
BEFORE UPDATE OF role ON user_roles
WHEN NEW.role = 'super_admin'
BEGIN
  SELECT RAISE(ABORT, 'super_admin faqat himoyalangan server amali orqali beriladi');
END;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','change_email')),
  new_email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Shaxsiy teri profili (sezgir). Maydonlar server tomonda AES-256-GCM bilan shifrlanadi.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_enc TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------- Ingredient bazasi ----------
CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,              -- barqaror kalit: normallashtirilgan INCI
  record_no TEXT,
  inci TEXT NOT NULL,
  inci_norm TEXT NOT NULL,
  uz_name TEXT,
  synonyms TEXT,
  cas TEXT,
  cosing_functions TEXT,
  function_uz TEXT,
  description_uz TEXT,
  pubchem_en TEXT,
  detailed_explanation TEXT,
  safety_general TEXT,
  pregnancy_info TEXT,
  oily_info TEXT,
  dry_info TEXT,
  sensitive_info TEXT,
  eu_restrictions TEXT,
  eu_allergen TEXT,
  sccs TEXT,
  cir TEXT,
  source_urls TEXT,
  review_status TEXT,                    -- asl fayldagi holat matni
  pharmacist_approved INTEGER NOT NULL DEFAULT 0 CHECK (pharmacist_approved IN (0,1)),
  pharmacist_comment TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','needs_source','under_review','approved','archived','insufficient_evidence')),
  approved_by TEXT,
  approved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,                         -- asl qatorning to'liq nusxasi (hech narsa yo'qolmaydi)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ingredients_norm ON ingredients(inci_norm);
CREATE INDEX ingredients_status ON ingredients(status);

CREATE TABLE ingredient_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  alias_norm TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inci','synonym','uz','cas')),
  UNIQUE (ingredient_id, alias_norm, kind)
);
CREATE INDEX aliases_norm ON ingredient_aliases(alias_norm);

-- Tuzilgan baholash (faqat approved=1 bo'lgan yozuvlar foiz hisobiga kiradi)
CREATE TABLE ingredient_assessments (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('climate','pregnancy','dry','oily','sensitive')),
  stance TEXT NOT NULL CHECK (stance IN ('favorable','neutral','caution')),
  evidence_level TEXT NOT NULL CHECK (evidence_level IN ('high','moderate','low')),
  note TEXT,
  source_ref TEXT,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1)),
  approved_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (ingredient_id, dimension)
);

CREATE TABLE ingredient_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  changed_by TEXT,
  change_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE functions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_uz TEXT,
  definition_uz TEXT,
  ingredient_count INTEGER,
  examples TEXT,
  source TEXT,
  raw_json TEXT
);

CREATE TABLE function_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  examples TEXT,
  sources TEXT,
  review_status TEXT,
  pharmacist_approved INTEGER NOT NULL DEFAULT 0,
  pharmacist_comment TEXT,
  raw_json TEXT
);

CREATE TABLE alternatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  main_inci TEXT NOT NULL,
  main_uz TEXT,
  main_tag TEXT,
  alt_inci TEXT NOT NULL,
  alt_uz TEXT,
  alt_tag TEXT,
  shared_functions TEXT,
  similarity REAL,                        -- umumiy CosIng funksiyalari asosida; kimyoviy ekvivalentlik EMAS
  differences TEXT,
  sources TEXT,
  review_status TEXT,
  pharmacist_approved INTEGER NOT NULL DEFAULT 0,
  pharmacist_comment TEXT,
  main_ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  alt_ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  raw_json TEXT
);
CREATE INDEX alt_main ON alternatives(main_ingredient_id);

CREATE TABLE conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  ingredient_a TEXT NOT NULL,
  ingredient_b TEXT NOT NULL,
  interaction_type TEXT,
  description TEXT,
  sources TEXT,
  review_status TEXT,
  pharmacist_approved INTEGER NOT NULL DEFAULT 0,
  pharmacist_comment TEXT,
  a_ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  b_ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  raw_json TEXT
);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT,
  kind TEXT,
  published TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  file_name TEXT,
  actor TEXT,
  ok INTEGER NOT NULL,
  report_json TEXT NOT NULL
);

-- ---------- Mahsulotlar ----------
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT UNIQUE,
  ingredients_text TEXT,
  price_uzs INTEGER,                     -- faqat tasdiqlangan narx bo'lsa
  price_source TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX products_name_brand ON products(lower(name), lower(coalesce(brand,'')));

CREATE TABLE uploaded_images (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,               -- server tomonda yaratilgan tasodifiy nom
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  saved INTEGER NOT NULL DEFAULT 0,      -- foydalanuvchi tahlil bilan birga saqlashni tanlagan
  deleted_at TEXT
);

CREATE TABLE ocr_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error_code TEXT,
  duration_ms INTEGER,
  mean_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT,
  brand TEXT,
  barcode TEXT,
  input_text TEXT NOT NULL,
  confirmed_json TEXT NOT NULL,          -- foydalanuvchi tasdiqlagan ingredient nomlari
  result_json TEXT NOT NULL,
  expiry_date TEXT,
  pao_months INTEGER,
  image_id TEXT REFERENCES uploaded_images(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX analyses_user ON analyses(user_id, created_at);

-- Oylik limit uchun: saqlanmagan tahlillar ham hisoblanadi
CREATE TABLE analysis_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'label',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX usage_user ON analysis_usage(user_id, at);

-- ---------- Obuna va to'lov ----------
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pro')),
  status TEXT NOT NULL CHECK (status IN ('active','canceled','expired','refunded')),
  source TEXT NOT NULL CHECK (source IN ('production','demo','sandbox')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX subs_user ON subscriptions(user_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_txn_id TEXT NOT NULL,
  amount_uzs INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  simulated INTEGER NOT NULL DEFAULT 0,  -- 1 bo'lsa: haqiqiy moliyaviy hisobotlarga KIRMAYDI
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_txn_id)
);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, event_id)            -- takroriy (replay) hodisani rad etadi
);

-- ---------- Hamjamiyat ----------
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (product_id, user_id)           -- har bir mahsulotga bitta faol sharh
);
CREATE TABLE review_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE review_helpful (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('review','comment')),
  target_id INTEGER NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (target_type, target_id, reporter_id)
);

-- ---------- Parvarish kundaligi ----------
CREATE TABLE care_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'any' CHECK (period IN ('am','pm','any')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE routine_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES care_routines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id INTEGER NOT NULL REFERENCES care_routines(id) ON DELETE CASCADE,
  time_hhmm TEXT NOT NULL CHECK (time_hhmm GLOB '[0-2][0-9]:[0-5][0-9]'),
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (routine_id, time_hhmm)
);
CREATE TABLE daily_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES routine_tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  done_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (task_id, date)
);
CREATE INDEX progress_user ON daily_progress(user_id, date);
CREATE TABLE diary_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scale','yesno','text')),
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE diary_answers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  question_id INTEGER NOT NULL REFERENCES diary_questions(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,
  PRIMARY KEY (user_id, date, question_id)
);

CREATE TABLE shelf_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  ingredients_text TEXT,
  purchase_date TEXT,
  opened_date TEXT,
  expiry_date TEXT,                      -- aniq sana (yo'q bo'lsa NULL — taxmin qilinmaydi)
  pao_months INTEGER,                    -- PAO belgisi (ochilgandan keyingi oylar); sana EMAS
  reminder_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- Marketing ----------
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  valid_until TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,     -- tasdiqlanmaguncha faol emas
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE referral_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  converted_at TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  visitor_id TEXT,
  user_id TEXT,
  type TEXT NOT NULL,                    -- visit, register, first_analysis, pro_view, purchase, barcode_not_found ...
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ref TEXT,
  amount_uzs INTEGER,
  simulated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_type ON events(type, at);

-- ---------- Tizim ----------
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT
);
CREATE TABLE system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
