-- Imalytix — images 테이블: pHash 기반 동일/유사 이미지 탐지용.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- (한 번만 실행하면 됩니다. 이미 존재하는 객체는 IF NOT EXISTS로 건너뜁니다.)
--
-- 설계 메모
-- ---------
-- pHash(64bit)는 bit(64) 타입으로 저장합니다. Hamming distance는 PostgreSQL
-- 14+ 내장 함수 bit_count(a # b)로 계산 가능합니다(# = bitwise XOR) — 이
-- 프로젝트의 유일한 유사 이미지 탐지 경로입니다.
--
-- ⚠️ 2026-08-01(3): DINOv3(Module A) 성능이 불안정해서 프로젝트에서 완전히
-- 제거했습니다 — 그 임베딩을 저장/검색하던 pgvector 관련 스키마(embedding
-- 컬럼, HNSW 인덱스, find_similar_by_embedding RPC)도 함께 뺐습니다. DINO
-- 작업 자체는 버리지 않고 `archive/dino-pgvector` 브랜치에 그대로 남아있으니
-- 나중에 재도입하려면 그 브랜치에서 ml/, lib/analysis/dino.ts, 이 파일의
-- git 이력을 참고하면 됩니다. 아래 ALTER/DROP 문들은 이미 (구버전 schema.sql로)
-- embedding 컬럼/함수를 만들어둔 환경을 정리하기 위한 것 — 애초에 없던
-- 환경에서는 전부 안전한 no-op입니다.
--
-- hex ↔ bit(64) 변환: bytea에는 bit로의 직접 캐스트가 없어서(Postgres에 그런
-- 캐스트가 정의돼 있지 않음 — decode(hex,'hex')::bit(64)는 42846 에러),
-- 변환은 애플리케이션(lib/db/verification.ts)에서 hex를 64자리 '0'/'1' 이진
-- 문자열로 바꿔서 넘깁니다. 그 문자열은 '1010...'::bit(64)로 바로 캐스트됩니다
-- (bit 타입 입력 파서가 원래 0/1 문자열을 받는 포맷이라 이건 표준 동작).

-- ---------------------------------------------------------------------------
-- users — 로그인 프로필. Supabase Auth(auth.users)가 이메일/비밀번호·소셜 로그인
-- 자체를 처리하고, 이 테이블은 그 위에 얹는 앱 전용 프로필입니다(schema.v2.md
-- 제안의 users 테이블과 동일한 컬럼 구성). auth.users는 Supabase가 관리하는
-- 테이블이라 앱 코드에서 직접 insert하지 않고, 아래 트리거가 회원가입 시점에
-- 자동으로 이 테이블에 대응 행을 만듭니다.
--
-- ⚠️ 이건 스키마 준비만입니다 — 로그인 UI, Supabase Auth 클라이언트 연동,
-- 세션 처리, "로그인 안 하면 막기" 같은 라우트 보호는 별도 애플리케이션
-- 작업입니다(요청하신 범위는 SQL 파일까지). images/request_logs/feedback를
-- 로그인한 사용자와 연결하고 싶으면(예: "내 분석 기록 보기") 그 테이블들에
-- user_id 컬럼을 nullable로 추가하는 게 다음 단계인데, 이것도 별도로
-- 말씀해주시면 진행하겠습니다 — 지금은 users 테이블 자체만 추가합니다.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table users is '로그인 사용자 프로필 — auth.users와 1:1, on_auth_user_created 트리거가 자동 생성.';

-- RLS: 다른 테이블과 달리 이 테이블은 로그인한 사용자가 브라우저에서 자기
-- 프로필을 직접 읽고 고칠 수 있어야 하므로(anon/authenticated 키 경유),
-- service_role 전용이 아니라 auth.uid() 기반 정책을 둡니다.
alter table users enable row level security;

drop policy if exists "Users can view own profile" on users;
create policy "Users can view own profile" on users
  for select using (auth.uid() = id);

drop policy if exists "Users can update own profile" on users;
create policy "Users can update own profile" on users
  for update using (auth.uid() = id);

-- auth.users에 새 계정이 생기면 자동으로 users에도 프로필 행을 만듭니다.
-- security definer로 실행해야 이 함수가 (호출자가 아니라) 소유자 권한으로
-- auth.users를 읽고 public.users에 insert할 수 있습니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-08-01: schema.v2.md(동료 제안)로 마이그레이션 — 기존 images/request_logs
-- 2테이블 구조를 버리고 정규화된 5테이블(verification_requests/request_images/
-- ai_provider_calls/verification_evidence/verification_results)로 교체합니다.
--
-- ⚠️ 기존 images/request_logs 테이블 자체는 이 파일에서 지우지 않습니다 —
-- 그 안에 쌓인 과거 분석 기록이 자동으로 새 테이블로 옮겨지지도 않습니다.
-- DROP은 데이터 손실이 되는 명령이라 명시적으로 요청받기 전엔 실행하지
-- 않았습니다. 필요 없으시면 "images, request_logs 지워도 돼"라고 말씀해주시면
-- 별도 DROP 문을 드리겠습니다. 지금은 새 테이블만 추가되고, 옛 테이블은
-- 조회는 되지만(과거 기록 백업용) 이제 이 앱 코드는 더 이상 안 씁니다.
--
-- 키 정책: 내부 FK는 bigint(v2.md 제안 그대로)지만, 앱이 클라이언트에 노출하는
-- ID(`AnalysisResult.request_id`, export/로그/URL에 쓰이는 `req_...` 문자열)는
-- verification_requests.request_id(text, unique)로 유지합니다 — bigint id를
-- 그대로 노출하면 기존 UI/문자열 포맷이 전부 깨집니다(이전 리뷰에서 지적한
-- 부분).
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- verification_requests — 분석 요청 1건 = 1행. 기존 request_logs가 담당하던
-- "누가/언제/어디서/어떤 모드로" 요청 메타를 여기로 옮겼습니다.
-- ---------------------------------------------------------------------------
create table if not exists verification_requests (
  id bigint generated always as identity primary key,
  -- 앱 코드 전역(export/로그/UI 표시)에서 쓰는 문자열 ID. bigint id는 내부
  -- FK 전용이고, 클라이언트에 노출되는 건 항상 이 컬럼입니다.
  request_id text not null unique,
  user_id uuid references users (id) on delete set null,
  input_type text not null check (input_type in ('file_upload', 'image_url')),
  mode text not null check (mode in ('quick', 'standard', 'deep')),
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_message text,
  duration_ms integer,
  ip text,
  user_agent text,
  origin text,
  referer text,
  source_url text,
  filename text,
  created_at timestamptz not null default now()
);

comment on table verification_requests is '분석 요청 1건 = 1행. request_id(text)가 앱 전역에서 쓰는 공개 ID, id(bigint)는 내부 FK 전용.';

create index if not exists verification_requests_user_id_idx on verification_requests (user_id);
create index if not exists verification_requests_created_at_idx on verification_requests (created_at desc);

alter table verification_requests enable row level security;

-- 로그인한 사용자는 자기 분석 이력만 조회 가능(앱의 "내 분석 이력" 페이지가
-- anon/authenticated 키로 이 정책을 타고 조회). user_id가 NULL인(비로그인)
-- 요청은 본인 것이어도 anon/authenticated 키로는 조회 대상에서 빠집니다 —
-- 누구 것인지 자체를 특정할 수 없어서 원래도 "내 이력"에 낄 수 없는 데이터입니다.
drop policy if exists "Users can view own requests" on verification_requests;
create policy "Users can view own requests" on verification_requests
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- request_images — 분석 대상 이미지. 기존 images 테이블 역할이지만, "이미지
-- 자체의 정보"와 "최종 판정"을 분리했습니다(판정은 verification_results로).
-- ---------------------------------------------------------------------------
create table if not exists request_images (
  id bigint generated always as identity primary key,
  request_id bigint not null references verification_requests (id) on delete cascade,
  phash bit(64) not null,
  width integer,
  height integer,
  mime_type text,
  file_size integer,
  category text,
  image_url text,
  created_at timestamptz not null default now()
);

comment on table request_images is '분석 대상 이미지 1장 = 1행 (요청당 현재는 항상 1장). phash 유사도 탐지용.';
comment on column request_images.phash is '64bit perceptual hash (lib/analysis/phash.ts generatePHash 출력).';
comment on column request_images.image_url is 'Supabase Storage 경로(예: supabase://analyzed-images/...) — 이전 images.image_path와 동일한 값 포맷.';

-- DINO 제거 정리: embedding 컬럼/HNSW 인덱스를 이미 만들어둔 환경이 있으면
-- 여기서 걷어냅니다. 없는 환경(이 파일을 새로 실행하는 프로젝트)에서는 둘 다
-- no-op입니다.
drop index if exists request_images_embedding_hnsw_idx;
alter table request_images drop column if exists embedding;

create index if not exists request_images_request_id_idx on request_images (request_id);

alter table request_images enable row level security;

drop policy if exists "Users can view own request images" on request_images;
create policy "Users can view own request images" on request_images
  for select using (
    exists (
      select 1 from verification_requests vr
      where vr.id = request_images.request_id and vr.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- ai_provider_calls — provider별 AI 호출 raw 로그(비용/토큰/지연시간 포함).
-- 정규화된 판정 결과는 verification_evidence에 별도 저장(raw ↔ 정제 분리).
-- ---------------------------------------------------------------------------
create table if not exists ai_provider_calls (
  id bigint generated always as identity primary key,
  request_id bigint not null references verification_requests (id) on delete cascade,
  image_id bigint references request_images (id) on delete set null,
  provider text not null check (provider in ('openai', 'gemini', 'claude')),
  model_name text,
  prompt_type text check (prompt_type in ('quick', 'standard')),
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_message text,
  error_category text,
  raw_response jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 6),
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- DINO 제거 정리: 'dino'를 허용하던 구버전 CHECK가 이미 있으면 새로 교체
-- (Postgres 기본 명명 규칙 <table>_<column>_check를 그대로 씀 — 이 파일에서
-- 명시적으로 이름 붙인 적이 없어 항상 이 이름으로 생성됨).
alter table ai_provider_calls drop constraint if exists ai_provider_calls_provider_check;
alter table ai_provider_calls add constraint ai_provider_calls_provider_check check (provider in ('openai', 'gemini', 'claude'));

comment on table ai_provider_calls is 'provider별 AI 호출 raw 로그 — 비용/토큰/지연시간 집계용(lib/vision/pricing.ts가 cost_usd 추정).';

create index if not exists ai_provider_calls_request_id_idx on ai_provider_calls (request_id);
create index if not exists ai_provider_calls_provider_idx on ai_provider_calls (provider);

alter table ai_provider_calls enable row level security;

drop policy if exists "Users can view own provider calls" on ai_provider_calls;
create policy "Users can view own provider calls" on ai_provider_calls
  for select using (
    exists (
      select 1 from verification_requests vr
      where vr.id = ai_provider_calls.request_id and vr.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- verification_evidence — provider(및 metadata)별 정규화된 판정. 이전
-- images.full_result의 vision_results 배열이 여기로 정규화됐습니다 — 동일
-- 이미지 재업로드 시 이 테이블을 JOIN해서 원본 결과를 재구성합니다(아래
-- find_similar_images 참고).
-- ---------------------------------------------------------------------------
create table if not exists verification_evidence (
  id bigint generated always as identity primary key,
  request_id bigint not null references verification_requests (id) on delete cascade,
  source text not null check (source in ('metadata', 'openai', 'gemini', 'claude')),
  score numeric(6, 3),
  confidence text check (confidence in ('low', 'medium', 'high')),
  is_ai_generated boolean,
  -- MetadataAnalysis | VisionResult 전체 — lib/vision/normalize.ts가 만드는
  -- 모양 그대로 저장(evidence[]/suspicious_regions[]/limitations[] 포함).
  result jsonb,
  created_at timestamptz not null default now(),
  unique (request_id, source)
);

alter table verification_evidence drop constraint if exists verification_evidence_source_check;
alter table verification_evidence add constraint verification_evidence_source_check
  check (source in ('metadata', 'openai', 'gemini', 'claude'));

comment on table verification_evidence is '요청당 source(metadata/openai/gemini/claude)별 정규화된 판정 1행 — aggregateAnalysis()의 입력.';

create index if not exists verification_evidence_request_id_idx on verification_evidence (request_id);

alter table verification_evidence enable row level security;

drop policy if exists "Users can view own evidence" on verification_evidence;
create policy "Users can view own evidence" on verification_evidence
  for select using (
    exists (
      select 1 from verification_requests vr
      where vr.id = verification_evidence.request_id and vr.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- verification_results — 집계기(aggregateAnalysis)가 낸 최종 판정. 요청당 1행.
-- ---------------------------------------------------------------------------
create table if not exists verification_results (
  request_id bigint primary key references verification_requests (id) on delete cascade,
  final_score numeric(5, 2) not null,
  final_label text,
  is_ai_generated boolean,
  confidence text check (confidence in ('low', 'medium', 'high')),
  evidence_summary jsonb,
  suspicious_regions jsonb,
  limitations jsonb,
  recommended_action text,
  aggregator_version text default 'v1',
  created_at timestamptz not null default now()
);

comment on table verification_results is '집계된 최종 판정, 요청당 1행(request_id가 PK이자 FK). final_score = AnalysisResult.final_result.ai_probability.';

create index if not exists verification_results_created_at_idx on verification_results (created_at desc);

alter table verification_results enable row level security;

drop policy if exists "Users can view own results" on verification_results;
create policy "Users can view own results" on verification_results
  for select using (
    exists (
      select 1 from verification_requests vr
      where vr.id = verification_results.request_id and vr.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- record_verification — 위 5개 테이블 전부를 트랜잭션 하나로 채우는 단일
-- RPC. lib/analysis/pipeline.ts가 분석이 끝날 때마다 이거 한 번만 호출합니다.
--
-- 왜 개별 insert 5~10번이 아니라 이거 하나로 묶었나: 정규화된 구조는 요청당
-- insert가 여러 번(요청 1 + 이미지 1 + provider 호출 최대 4 + evidence 최대 5
-- + 결과 1) 필요한데, 앱 코드가 이걸 각각 왕복하면 그중 일부만 실패했을 때
-- (예: evidence 3개 중 1개만 실패) 데이터가 반쪽으로 남습니다. 하나의 plpgsql
-- 함수 안에서 하면 전부 같은 트랜잭션이라 원자적으로 성공/실패합니다.
--
-- payload 예시 shape (전부 jsonb 하나로 받음 — 파라미터 30개짜리 함수보다
-- TS 쪽에서 객체 하나 만들어 넘기는 게 다루기 쉬움):
-- {
--   "request": { "request_id": "req_...", "user_id": "uuid or null", "input_type": "file_upload",
--                "mode": "standard", "status": "ok", "error_message": null, "duration_ms": 4200,
--                "ip": "...", "user_agent": "...", "origin": null, "referer": null,
--                "source_url": null, "filename": "photo.jpg" },
--   "image": { "phash_bits": "0101...", "width": 800, "height": 600,
--              "mime_type": "image/jpeg", "file_size": 12345, "category": null, "image_url": "supabase://..." },
--   "provider_calls": [ { "provider": "openai", "model_name": "gpt-4o", "prompt_type": "standard",
--                          "status": "ok", "error_message": null, "error_category": null,
--                          "raw_response": {...}, "input_tokens": 2312, "output_tokens": 40,
--                          "cost_usd": 0.006, "latency_ms": 4943 }, ... ],
--   "evidence": [ { "source": "openai", "score": 0.5, "confidence": "low", "is_ai_generated": null,
--                   "result": {...VisionResult...} }, ... ],
--   "result": { "final_score": 69, "final_label": "AI 생성 의심", "is_ai_generated": true,
--               "confidence": "medium", "evidence_summary": [...], "suspicious_regions": [...],
--               "limitations": [...], "recommended_action": "..." }
-- }
--
-- request_id 중복(재시도) 시: verification_requests는 on conflict do nothing으로
-- 무시되고, 이미 있던 행의 id를 그대로 반환하며 나머지 테이블은 다시 안 채웁니다
-- (기존 insert_image_record의 "on conflict do nothing" 재시도-안전 정책과 동일).
create or replace function record_verification(payload jsonb) returns bigint
language plpgsql
as $$
declare
  v_request_id bigint;
  v_image_id bigint;
  v_call jsonb;
  v_ev jsonb;
  req jsonb := payload -> 'request';
  img jsonb := payload -> 'image';
  res jsonb := payload -> 'result';
begin
  insert into verification_requests (
    request_id, user_id, input_type, mode, status, error_message,
    duration_ms, ip, user_agent, origin, referer, source_url, filename
  )
  values (
    req ->> 'request_id',
    nullif(req ->> 'user_id', '')::uuid,
    req ->> 'input_type',
    req ->> 'mode',
    coalesce(req ->> 'status', 'ok'),
    req ->> 'error_message',
    (req ->> 'duration_ms')::integer,
    req ->> 'ip',
    req ->> 'user_agent',
    req ->> 'origin',
    req ->> 'referer',
    req ->> 'source_url',
    req ->> 'filename'
  )
  on conflict (request_id) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    -- 이미 기록된 request_id — 기존 id만 반환하고 하위 테이블은 다시 안 채움
    -- (중복 삽입 방지, 재시도 안전).
    select id into v_request_id from verification_requests where request_id = (req ->> 'request_id');
    return v_request_id;
  end if;

  if img is not null then
    insert into request_images (request_id, phash, width, height, mime_type, file_size, category, image_url)
    values (
      v_request_id,
      (img ->> 'phash_bits')::bit(64),
      (img ->> 'width')::integer,
      (img ->> 'height')::integer,
      img ->> 'mime_type',
      (img ->> 'file_size')::integer,
      img ->> 'category',
      img ->> 'image_url'
    )
    returning id into v_image_id;
  end if;

  if payload -> 'provider_calls' is not null then
    for v_call in select * from jsonb_array_elements(payload -> 'provider_calls')
    loop
      insert into ai_provider_calls (
        request_id, image_id, provider, model_name, prompt_type, status, error_message,
        error_category, raw_response, input_tokens, output_tokens, cost_usd, latency_ms
      )
      values (
        v_request_id,
        v_image_id,
        v_call ->> 'provider',
        v_call ->> 'model_name',
        v_call ->> 'prompt_type',
        coalesce(v_call ->> 'status', 'ok'),
        v_call ->> 'error_message',
        v_call ->> 'error_category',
        v_call -> 'raw_response',
        (v_call ->> 'input_tokens')::integer,
        (v_call ->> 'output_tokens')::integer,
        (v_call ->> 'cost_usd')::numeric,
        (v_call ->> 'latency_ms')::integer
      );
    end loop;
  end if;

  if payload -> 'evidence' is not null then
    for v_ev in select * from jsonb_array_elements(payload -> 'evidence')
    loop
      insert into verification_evidence (request_id, source, score, confidence, is_ai_generated, result)
      values (
        v_request_id,
        v_ev ->> 'source',
        (v_ev ->> 'score')::numeric,
        v_ev ->> 'confidence',
        (v_ev ->> 'is_ai_generated')::boolean,
        v_ev -> 'result'
      )
      on conflict (request_id, source) do nothing;
    end loop;
  end if;

  if res is not null then
    insert into verification_results (
      request_id, final_score, final_label, is_ai_generated, confidence,
      evidence_summary, suspicious_regions, limitations, recommended_action
    )
    values (
      v_request_id,
      (res ->> 'final_score')::numeric,
      res ->> 'final_label',
      (res ->> 'is_ai_generated')::boolean,
      res ->> 'confidence',
      res -> 'evidence_summary',
      res -> 'suspicious_regions',
      res -> 'limitations',
      res ->> 'recommended_action'
    )
    on conflict (request_id) do nothing;
  end if;

  return v_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- find_similar_images — phash 유사도 검색. request_images ↔ verification_requests
-- ↔ verification_results를 JOIN합니다. evidence 컬럼은 이전 images.full_result.
-- vision_results를 대체 — 매칭된 요청의 verification_evidence를 vision
-- provider(metadata 제외)만 골라 jsonb 배열로 묶어서 반환하므로, 애플리케이션
-- 코드(lib/db/verification.ts) 쪽 반환 타입은 그대로 유지됩니다.
--
-- find_similar_by_embedding(DINOv3 임베딩 kNN 폴백)은 DINO 제거와 함께
-- 삭제했습니다 — 아래 drop은 이미 만들어둔 환경을 정리하기 위한 것입니다.
-- ---------------------------------------------------------------------------
drop function if exists find_similar_images(text, int, int);

create or replace function find_similar_images(
  p_phash_bits text,
  p_max_distance int default 10,
  p_limit int default 20
) returns table (
  request_id text,
  distance int,
  is_ai_generated boolean,
  ai_probability numeric,
  image_path text,
  created_at timestamptz,
  evidence jsonb,
  evidence_summary jsonb,
  suspicious_regions jsonb
)
language sql
stable
as $$
  select
    vr.request_id,
    bit_count(ri.phash # p_phash_bits::bit(64)) as distance,
    res.is_ai_generated,
    res.final_score as ai_probability,
    ri.image_url as image_path,
    vr.created_at,
    (
      select jsonb_agg(ve.result)
      from verification_evidence ve
      where ve.request_id = vr.id and ve.source in ('openai', 'gemini', 'claude')
    ) as evidence,
    res.evidence_summary,
    res.suspicious_regions
  from request_images ri
  join verification_requests vr on vr.id = ri.request_id
  left join verification_results res on res.request_id = vr.id
  where bit_count(ri.phash # p_phash_bits::bit(64)) <= p_max_distance
  order by distance asc
  limit p_limit;
$$;

drop function if exists find_similar_by_embedding(vector(384), float, int);

-- ---------------------------------------------------------------------------
-- feedback — 결과 화면 하단 피드백 폼(app/page.tsx의 FeedbackForm) 제출 내역.
-- 로그인 여부와 무관하게 계속 익명 제출 가능(user_id는 로그인했을 때만 채워짐,
-- nullable) — 로그인을 피드백 남기기의 필수 조건으로 만들지 않았습니다.
-- ---------------------------------------------------------------------------
create table if not exists feedback (
  id bigint generated always as identity primary key,
  request_id text,
  user_id uuid references users (id) on delete set null,
  message text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- 기존에 다른 컬럼 구성으로 이미 만들어진 feedback 테이블이 있을 수 있어서
-- (예: schema.v2.md 원안 기준으로 직접 구축한 경우) 필요한 컬럼들을 개별
-- ALTER로 보강합니다 — create table if not exists만으론 기존 테이블에
-- 컬럼이 안 생기기 때문입니다.
alter table feedback add column if not exists user_id uuid references users (id) on delete set null;
alter table feedback add column if not exists ip text;
alter table feedback add column if not exists user_agent text;

comment on table feedback is '결과 화면의 피드백 폼 제출 내역 — 로그인 여부 무관 익명 제출 가능, user_id는 로그인 시에만 채워짐.';

create index if not exists feedback_user_id_idx on feedback (user_id);

alter table feedback enable row level security;

drop policy if exists "Users can view own feedback" on feedback;
create policy "Users can view own feedback" on feedback
  for select using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-08-01(2): 시장조사용 통계 — 새 테이블 없이 기존 정규화 테이블 위에
-- VIEW로만 구성했습니다(이미 쌓이고 있는 데이터라 앱 코드 변경 불필요,
-- SQL Editor에서 바로 select * from v_... 로 조회). service_role/postgres
-- 롤로 조회하는 걸 전제로 해서 별도 RLS는 안 걸었습니다(뷰 자체가
-- 클라이언트 노출용이 아니라 대시보드/리포트 조회 전용).
-- ═══════════════════════════════════════════════════════════════════════════

-- client_id: 비로그인 사용자의 재방문/순방문자 추정용 컬럼. 지금은 컬럼만
-- 추가합니다 — 실제로 값이 채워지려면 프론트에서 브라우저에 임의 UUID를
-- 만들어 저장(localStorage)하고 매 분석 요청마다 같이 보내는 코드가 별도로
-- 필요합니다(이번 라운드는 SQL만 요청하신 범위라 앱 코드는 안 건드렸습니다 —
-- 필요하시면 다음에 말씀해주세요). 그 전까지는 항상 NULL이라 아래
-- v_daily_activity의 signed_in_requests/anonymous_requests 구분은 되지만
-- "비로그인 순방문자 수"는 아직 추정 불가합니다.
alter table verification_requests add column if not exists client_id text;
create index if not exists verification_requests_client_id_idx on verification_requests (client_id);
comment on column verification_requests.client_id is '비로그인 재방문 추적용 브라우저 UUID — 컬럼만 준비됨, 프론트 연동 전까지 항상 NULL.';

-- v_daily_activity — 일별 트래픽 볼륨 + 로그인/비로그인 비율 + 입력방식/모드 분포.
create or replace view v_daily_activity as
select
  date_trunc('day', created_at) as day,
  count(*) as total_requests,
  count(*) filter (where user_id is not null) as signed_in_requests,
  count(*) filter (where user_id is null) as anonymous_requests,
  count(distinct user_id) as unique_signed_in_users,
  count(*) filter (where input_type = 'file_upload') as file_upload_count,
  count(*) filter (where input_type = 'image_url') as url_count,
  count(*) filter (where mode = 'quick') as quick_count,
  count(*) filter (where mode = 'standard') as standard_count,
  count(*) filter (where mode = 'deep') as deep_count,
  count(*) filter (where status = 'error') as error_count
from verification_requests
group by 1
order by 1 desc;

comment on view v_daily_activity is '일별 요청량/로그인 비율/입력방식·모드 분포 — 트래픽 트렌드용.';

-- v_verdict_distribution — 판정 결과 분포(AI 생성/실제/불확실)와 평균 점수 추이.
create or replace view v_verdict_distribution as
select
  date_trunc('day', vr.created_at) as day,
  count(*) as total,
  count(*) filter (where res.is_ai_generated = true) as ai_generated_count,
  count(*) filter (where res.is_ai_generated = false) as real_count,
  count(*) filter (where res.is_ai_generated is null) as undetermined_count,
  round(avg(res.final_score), 1) as avg_score
from verification_requests vr
join verification_results res on res.request_id = vr.id
group by 1
order by 1 desc;

comment on view v_verdict_distribution is '일별 AI생성/실제/불확실 판정 분포 + 평균 점수 — 서비스가 실제로 뭘 많이 잡아내는지 확인용.';

-- v_provider_cost_daily — provider별 일일 호출량/토큰/비용/지연시간.
create or replace view v_provider_cost_daily as
select
  date_trunc('day', apc.created_at) as day,
  apc.provider,
  count(*) as call_count,
  count(*) filter (where apc.status = 'error') as error_count,
  sum(apc.input_tokens) as total_input_tokens,
  sum(apc.output_tokens) as total_output_tokens,
  round(sum(apc.cost_usd), 4) as total_cost_usd,
  round(avg(apc.cost_usd), 6) as avg_cost_usd,
  round(avg(apc.latency_ms)) as avg_latency_ms
from ai_provider_calls apc
group by 1, 2
order by 1 desc, 2;

comment on view v_provider_cost_daily is 'provider별 일일 호출량/토큰/비용($)/지연시간 — 실사용 비용 추적 및 provider 비교용.';

-- v_cache_savings — phash 중복탐지로 LLM 호출을 스킵한 비율(비용 절감 효과 측정).
-- 판단 기준: 이 요청에 evidence(metadata 제외)는 있는데 ai_provider_calls가
-- 하나도 없으면 "캐시된 기존 결과를 재사용"(loggedProviderCalls=false)한 것.
create or replace view v_cache_savings as
with request_flags as (
  select
    vr.id,
    vr.created_at,
    exists (select 1 from verification_evidence ve where ve.request_id = vr.id and ve.source <> 'metadata') as has_evidence,
    exists (select 1 from ai_provider_calls apc where apc.request_id = vr.id) as has_provider_calls
  from verification_requests vr
  where vr.status = 'ok'
)
select
  date_trunc('day', created_at) as day,
  count(*) filter (where has_evidence and not has_provider_calls) as cache_hit_count,
  count(*) filter (where has_evidence and has_provider_calls) as fresh_analysis_count,
  round(
    100.0 * count(*) filter (where has_evidence and not has_provider_calls)
    / nullif(count(*) filter (where has_evidence), 0),
    1
  ) as cache_hit_rate_pct
from request_flags
group by 1
order by 1 desc;

comment on view v_cache_savings is '중복 이미지 재분석 시 LLM 호출을 스킵한 비율 — phash 중복탐지의 실제 비용 절감 효과 측정용.';

-- v_referrer_summary — 어느 origin/referer에서 요청이 들어왔는지(마케팅 유입 채널 파악).
create or replace view v_referrer_summary as
select
  coalesce(nullif(origin, ''), nullif(referer, ''), '(direct)') as source,
  count(*) as request_count,
  count(distinct user_id) filter (where user_id is not null) as signed_in_users,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from verification_requests
group by 1
order by request_count desc;

comment on view v_referrer_summary is 'origin/referer별 유입량 — 어떤 채널(익스텐션/웹/직접방문)에서 얼마나 오는지 파악용.';

-- v_user_activity_log — 요청 1건당 1행으로 "누가/언제/무엇을/어떤 결과"를 한눈에.
create or replace view v_user_activity_log as
select
  vr.request_id,
  vr.created_at,
  u.email as user_email,
  vr.user_id,
  vr.input_type,
  vr.mode,
  coalesce(vr.filename, vr.source_url) as input_source,
  vr.status,
  res.final_label,
  res.final_score,
  res.is_ai_generated,
  vr.ip,
  vr.user_agent
from verification_requests vr
left join users u on u.id = vr.user_id
left join verification_results res on res.request_id = vr.id
order by vr.created_at desc;

comment on view v_user_activity_log is '요청별 상세 로그(누가/언제/무엇을 업로드해서 어떤 판정을 받았는지) — 개별 케이스 조회/감사용.';

-- v_feedback_recent — 피드백을 해당 분석 결과와 묶어서 조회.
create or replace view v_feedback_recent as
select
  f.id,
  f.created_at,
  u.email as user_email,
  f.request_id,
  f.message,
  res.final_label,
  res.final_score
from feedback f
left join users u on u.id = f.user_id
left join verification_requests vr on vr.request_id = f.request_id
left join verification_results res on res.request_id = vr.id
order by f.created_at desc;

comment on view v_feedback_recent is '피드백 메시지를 해당 분석의 판정 결과와 함께 조회 — 어떤 판정에 대한 피드백인지 맥락 파악용.';
