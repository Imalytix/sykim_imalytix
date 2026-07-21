-- Imalytix — images 테이블: pHash 기반 동일/유사 이미지 탐지용.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- (한 번만 실행하면 됩니다. 이미 존재하는 객체는 IF NOT EXISTS로 건너뜁니다.)
--
-- 설계 메모
-- ---------
-- pHash(64bit)는 bit(64) 타입으로 저장합니다. Hamming distance는 pgvector 없이도
-- PostgreSQL 14+ 내장 함수 bit_count(a # b)로 계산 가능합니다(# = bitwise XOR).
-- 그래서 이 테이블은 pgvector 없이도 동작하지만, embedding 컬럼은 나중에 DINOv3
-- 임베딩(코사인 유사도 kNN)을 붙일 자리로 미리 만들어둡니다 — Module B 2단계.
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
  created_at timestamptz not null default now()
);

comment on table images is 'Imalytix 분석 요청마다 1행 — pHash 중복/유사 탐지 및 (예정) DINO 임베딩 kNN용.';
comment on column images.phash is '64bit perceptual hash (lib/analysis/phash.ts generatePHash 출력, hex 16자리를 bit로 저장).';
comment on column images.embedding is 'DINOv3 임베딩 자리 — extract_embeddings.py 연동 전까지는 NULL.';

-- RLS 활성화: anon/authenticated 키로는 접근 불가, service_role 키만 사용
-- (service_role은 RLS를 우회하므로 별도 policy 불필요 — 서버 사이드 전용 테이블).
alter table images enable row level security;

-- 삽입: 64자리 '0'/'1' 이진 문자열을 받아 bit(64)로 저장. request_id 중복 시 무시(재시도 안전).
create or replace function insert_image_record(
  p_request_id text,
  p_phash_bits text,
  p_category text,
  p_is_ai_generated boolean,
  p_ai_probability numeric,
  p_image_path text,
  p_mode text
) returns void
language sql
as $$
  insert into images (request_id, phash, category, is_ai_generated, ai_probability, image_path, mode)
  values (
    p_request_id,
    p_phash_bits::bit(64),
    p_category,
    p_is_ai_generated,
    p_ai_probability,
    p_image_path,
    p_mode
  )
  on conflict (request_id) do nothing;
$$;

-- 조회: 주어진 phash(hex)와 Hamming distance가 p_max_distance 이하인 기존 이미지들을
-- 가까운 순으로 반환. distance 해석 기준(perceptual hash 관례):
--   0        완전 동일 (재업로드/무편집)
--   1~5      사실상 동일 (재압축/리사이즈/색 보정 수준의 경미한 편집)
--   6~10     느슨하게 유사 (구도가 비슷하거나 일부만 편집) — 참고용, 단독 판정 근거 아님
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
  created_at timestamptz
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
    images.created_at
  from images
  where bit_count(images.phash # p_phash_bits::bit(64)) <= p_max_distance
  order by distance asc
  limit p_limit;
$$;
