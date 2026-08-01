-- Imalytix — images 테이블: pHash 기반 동일/유사 이미지 탐지용.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- (한 번만 실행하면 됩니다. 이미 존재하는 객체는 IF NOT EXISTS로 건너뜁니다.)
--
-- 설계 메모
-- ---------
-- pHash(64bit)는 bit(64) 타입으로 저장합니다. Hamming distance는 pgvector 없이도
-- PostgreSQL 14+ 내장 함수 bit_count(a # b)로 계산 가능합니다(# = bitwise XOR).
-- embedding 컬럼(DINOv3, 384차원)은 2026-07-25부터 실제로 채워집니다 — pHash로
-- 동일/근접 중복이 안 잡힐 때만 폴백으로 쓰는 2단계 검색(find_similar_by_embedding,
-- 아래 참고)이며, 1단계(find_similar_images, pHash)는 여전히 pgvector 없이도
-- 동작합니다.
--
-- hex ↔ bit(64) 변환: bytea에는 bit로의 직접 캐스트가 없어서(Postgres에 그런
-- 캐스트가 정의돼 있지 않음 — decode(hex,'hex')::bit(64)는 42846 에러),
-- 변환은 애플리케이션(lib/db/imageRecords.ts)에서 hex를 64자리 '0'/'1' 이진
-- 문자열로 바꿔서 넘깁니다. 그 문자열은 '1010...'::bit(64)로 바로 캐스트됩니다
-- (bit 타입 입력 파서가 원래 0/1 문자열을 받는 포맷이라 이건 표준 동작).

create extension if not exists vector;

create table if not exists images (
  id bigint generated always as identity primary key,
  request_id text not null unique,
  phash bit(64) not null,
  category text,
  embedding vector(384),
  is_ai_generated boolean,
  ai_probability numeric(5, 2),
  image_path text,
  mode text,
  -- { vision_results, evidence_summary, suspicious_regions } — the pieces of
  -- an AnalysisResult that come from actually running the LLMs/DINO on this
  -- image. Lets a *future* exact-duplicate hit (see EXACT_DUPLICATE_PHASH_
  -- DISTANCE in lib/analysis/pipeline.ts) display a genuinely complete
  -- result — same provider breakdown, same suspicious-region boxes — instead
  -- of just the bare final score. NULL for rows inserted before this column
  -- existed; pipeline.ts treats those as "no usable cached result" and runs
  -- a fresh analysis rather than showing an empty duplicate result, which
  -- self-heals old rows the next time their phash is re-uploaded.
  full_result jsonb,
  created_at timestamptz not null default now()
);

-- `create table if not exists` above only fires on a brand-new database —
-- an `images` table created before 2026-08-01 already exists without this
-- column, and `if not exists` doesn't retroactively add columns. This line
-- is what actually applies the change when re-running this file against an
-- existing database (safe to run repeatedly either way). Must run BEFORE
-- the `comment on column images.full_result` below — commenting on a column
-- that doesn't exist yet errors with 42703.
alter table images add column if not exists full_result jsonb;

comment on table images is 'Imalytix 분석 요청마다 1행 — pHash 중복/유사 탐지 및 (예정) DINO 임베딩 kNN용.';
comment on column images.phash is '64bit perceptual hash (lib/analysis/phash.ts generatePHash 출력, hex 16자리를 bit로 저장).';
comment on column images.embedding is 'DINOv3 임베딩(384차원) — ml/serve.py의 /infer 응답에서 받아 저장. IMALYTIX_ENABLE_DINO=false였거나 추론 서버 호출이 실패한 요청은 NULL.';
comment on column images.full_result is 'vision_results/evidence_summary/suspicious_regions — 동일 이미지 재업로드 시 전체 결과를 재구성하는 데 사용(lib/analysis/aggregator.ts의 buildDuplicateAggregateResult 참고).';

-- RLS 활성화: anon/authenticated 키로는 접근 불가, service_role 키만 사용
-- (service_role은 RLS를 우회하므로 별도 policy 불필요 — 서버 사이드 전용 테이블).
alter table images enable row level security;

-- 삽입: 64자리 '0'/'1' 이진 문자열을 받아 bit(64)로 저장. request_id 중복 시 무시(재시도 안전).
-- p_embedding은 선택 인자(기본 null) — DINO가 꺼져 있거나(IMALYTIX_ENABLE_DINO=false)
-- 추론 서버 호출이 실패한 요청은 임베딩 없이(NULL) 기록되고, pHash 중복탐지에는
-- 영향이 없습니다. 기존 호출부(embedding을 안 넘기던 코드)와도 호환됩니다.
create or replace function insert_image_record(
  p_request_id text,
  p_phash_bits text,
  p_category text,
  p_is_ai_generated boolean,
  p_ai_probability numeric,
  p_image_path text,
  p_mode text,
  p_embedding vector(384) default null,
  p_full_result jsonb default null
) returns void
language sql
as $$
  insert into images (request_id, phash, category, is_ai_generated, ai_probability, image_path, mode, embedding, full_result)
  values (
    p_request_id,
    p_phash_bits::bit(64),
    p_category,
    p_is_ai_generated,
    p_ai_probability,
    p_image_path,
    p_mode,
    p_embedding,
    p_full_result
  )
  on conflict (request_id) do nothing;
$$;

-- 조회: 주어진 phash(hex)와 Hamming distance가 p_max_distance 이하인 기존 이미지들을
-- 가까운 순으로 반환. distance 해석 기준(perceptual hash 관례):
--   0        완전 동일 (재업로드/무편집)
--   1~5      사실상 동일 (재압축/리사이즈/색 보정 수준의 경미한 편집)
--   6~10     느슨하게 유사 (구도가 비슷하거나 일부만 편집) — 참고용, 단독 판정 근거 아님
--
-- `create or replace function`은 반환 타입(RETURNS TABLE의 컬럼 구성)을 바꾸는 건
-- 허용하지 않습니다(42P13 에러) — full_result 컬럼을 추가했으므로 기존 함수를
-- 먼저 지워야 합니다. 함수가 없으면 조용히 넘어갑니다.
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
  full_result jsonb
)
language sql
stable
as $$
  select
    images.request_id,
    bit_count(images.phash # p_phash_bits::bit(64)) as distance,
    images.is_ai_generated,
    images.ai_probability,
    images.image_path,
    images.created_at,
    images.full_result
  from images
  where bit_count(images.phash # p_phash_bits::bit(64)) <= p_max_distance
  order by distance asc
  limit p_limit;
$$;

-- HNSW 인덱스: pgvector의 근사 최근접 이웃(ANN) 인덱스. embedding이 NULL인 행은
-- 자동으로 인덱스에서 제외됩니다(DINO가 꺼져 있던 시절 기록 등) — 별도 처리 불필요.
-- vector_cosine_ops를 쓰는 이유는 아래 find_similar_by_embedding이 코사인 거리
-- (<=>)로 검색하기 때문 — 인덱스의 거리 연산자와 쿼리의 거리 연산자가 일치해야
-- 인덱스가 실제로 사용됩니다.
create index if not exists images_embedding_hnsw_idx
  on images using hnsw (embedding vector_cosine_ops);

-- 조회(2단계 폴백 전용): pHash Hamming distance로 매치가 안 나왔을 때만 호출됨
-- (lib/analysis/pipeline.ts 참고). 코사인 거리(<=>, 0=완전 동일 방향 ~ 2=정반대)가
-- p_max_distance 이하인 이미지를 가까운 순으로 반환. pHash와 달리 "픽셀이 비슷한"
-- 게 아니라 "DINOv3가 의미적으로 비슷하다고 본" 이미지를 찾는 것이라 임계값의
-- 의미가 다릅니다 — 처음엔 보수적으로(0.15 안팎, 즉 매우 가까운 것만) 시작해서
-- 실측 분포를 보고 재보정하는 걸 권장합니다(리포트의 "pHash 임계값 실데이터
-- 재보정 미착수" 항목과 같은 종류의 튜닝 작업).
--
-- find_similar_images와 같은 이유로 반환 타입 변경 전 DROP 필요(42P13).
drop function if exists find_similar_by_embedding(vector(384), float, int);

create or replace function find_similar_by_embedding(
  p_embedding vector(384),
  p_max_distance float default 0.15,
  p_limit int default 20
) returns table (
  request_id text,
  distance float,
  is_ai_generated boolean,
  ai_probability numeric,
  image_path text,
  created_at timestamptz,
  full_result jsonb
)
language sql
stable
as $$
  select
    images.request_id,
    images.embedding <=> p_embedding as distance,
    images.is_ai_generated,
    images.ai_probability,
    images.image_path,
    images.created_at,
    images.full_result
  from images
  where images.embedding is not null
    and images.embedding <=> p_embedding <= p_max_distance
  order by distance asc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- request_logs — 요청 로그(누가/언제/어디서/무엇을/결과)를 Supabase에도 남김.
--
-- lib/logging/analysisLogger.ts는 원래 로컬 파일(storage/logs/*.jsonl)에만
-- 기록했는데, Vercel 서버리스는 로컬 디스크가 요청 사이에 휘발되기 때문에
-- 배포하면 로그가 남지 않는 문제가 있었습니다. 이 테이블이 그 문제를 해결하는
-- "진짜" 로그 저장소이고, 로컬 파일은 이제 빠른 로컬 디버깅용 보조 수단입니다.
--
-- images 테이블과 달리 여기는 bit(64) 같은 특수 타입이 없어서(전부 text/
-- jsonb/numeric) RPC 함수 없이 supabase-js의 `.from('request_logs').insert()`
-- 로 바로 넣습니다 — images 테이블에서 RPC 함수가 필요했던 이유(bit 타입
-- 직렬화 문제)가 애초에 여기엔 없기 때문입니다.
-- ---------------------------------------------------------------------------
create table if not exists request_logs (
  id bigint generated always as identity primary key,
  request_timestamp timestamptz not null,
  request_id text not null,
  status text not null,
  duration_ms integer,
  ip text,
  user_agent text,
  origin text,
  referer text,
  input_type text,
  mode text,
  source_url text,
  filename text,
  image_path text,
  phash text,
  final_result jsonb,
  providers jsonb,
  metadata_score numeric,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table request_logs is 'analysisLogger.ts가 매 분석 요청마다 남기는 로그 — 로컬 storage/logs/*.jsonl과 동일한 내용을 클라우드에도 보관.';

alter table request_logs enable row level security;
