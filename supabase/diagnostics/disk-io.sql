-- Disk IO 진단 — Supabase 대시보드 › SQL Editor 에 붙여 넣고 ①~⑥ 을 한 덩어리씩 선택해 실행한다
-- (편집기는 마지막 결과만 보여 준다). 읽기만 한다, 아무것도 바꾸지 않는다.
-- 결과 표를 그대로 복사해 Claude 에게 주면 무엇이 디스크를 쓰는지 짚을 수 있다.

-- ① 디스크에서 가장 많이 읽은 요청 (메모리에 없어 디스크까지 간 블록 = 8KB 단위)
select left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query,
       calls,
       shared_blks_read                         as disk_read_blocks,
       pg_size_pretty(shared_blks_read * 8192)  as disk_read,
       shared_blks_dirtied                      as dirtied_blocks,
       round(total_exec_time)                   as total_ms
  from extensions.pg_stat_statements
 order by shared_blks_read desc
 limit 15;

-- ② 가장 많이 고쳐 쓴(디스크 쓰기를 만든) 요청
select left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query,
       calls,
       shared_blks_dirtied + shared_blks_written as write_blocks,
       pg_size_pretty(wal_bytes)                 as wal,
       round(total_exec_time)                    as total_ms
  from extensions.pg_stat_statements
 order by wal_bytes desc nulls last
 limit 15;

-- ③ 메모리 적중률 — 99% 아래면 데이터가 메모리에 다 안 들어가 디스크를 계속 읽는 중
select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) as cache_hit_pct,
       pg_size_pretty(pg_database_size(current_database()))                         as db_size
  from pg_stat_database
 where datname = current_database();

-- ④ 큰 표 (realtime · cron · net · auth 포함)
select n.nspname || '.' || c.relname                    as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid))    as total_size,
       s.seq_scan, s.n_live_tup, s.n_dead_tup
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_all_tables s on s.relid = c.oid
 where c.relkind in ('r', 'p', 'm')
   and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
 order by pg_total_relation_size(c.oid) desc
 limit 15;

-- ⑤ 예약 작업 (1분마다 도는 것이 몇 개인가)
select jobname, schedule, active from cron.job order by schedule, jobname;

-- ⑥ 연결 수 · 복제 슬롯이 붙잡은 WAL
select coalesce(application_name, '') as app, state, count(*) from pg_stat_activity group by 1, 2 order by 3 desc;
select slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retained_wal
  from pg_replication_slots;
