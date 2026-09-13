-- ============================================================================
-- Vue 3 智能工作台 · Supabase 初始化脚本（第五阶段：用户系统 + 云同步）
--
-- 使用方式：
--   1. https://supabase.com 新建项目（免费额度够用）
--   2. 控制台 → SQL Editor → 新建查询 → 粘贴本文件 → Run
--   3. Authentication → Providers：打开 Email，如需 GitHub 登录再打开 GitHub 并填 OAuth App 的
--      Client ID / Secret（GitHub 侧回调地址填 https://<project>.supabase.co/auth/v1/callback）
--   4. 项目根目录 .env.local 写入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
--
-- 本脚本可**重复执行**（全部语句幂等），改完策略再跑一次即可。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 任务表
--   结构化查询字段单独成列（title / completed / sort_order），
--   其余扩展字段（priority / dueDate / completedAt / pinned / subtasks）进 payload jsonb，
--   以后加字段不用改表。
-- ---------------------------------------------------------------------------
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default '',
  completed   boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,
  -- 拖拽排序的顺序位：云端没有这一列，跨设备就还原不出用户手动排的顺序
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists todos_user_sort_idx on public.todos (user_id, sort_order);

-- updated_at 自动维护（前端不做时钟同步，交给数据库）
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists todos_touch_updated_at on public.todos;
create trigger todos_touch_updated_at
  before update on public.todos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 行级安全（RLS）：权限下沉到数据库层
--   前端只带 anon key（公开可见），越权读写完全由这里的策略拦住，
--   所以「anon key 泄露」也不等于数据泄露——这正是选 Supabase 的核心理由。
-- ---------------------------------------------------------------------------
alter table public.todos enable row level security;

drop policy if exists "todos: own rows only" on public.todos;
create policy "todos: own rows only"
  on public.todos
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 表级权限（GRANT / REVOKE）
--   容易踩的坑：RLS 策略只负责「过滤行」，前提是角色**先有表级权限**。
--   创建项目时如果把「自动暴露新表」关掉（官方也建议关），Supabase 不会再把新表
--   自动授权给 Data API 角色，此时没有下面的 GRANT 会直接报
--   42501 permission denied（连 RLS 都走不到）。显式写出来，开/关都稳。
--
--   只授权给 authenticated：未登录（anon）连表权限都没有，等于多一层防护；
--   即使未来某条策略写错，anon 也读不到任何行。
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
revoke all on table public.todos from anon;

-- ---------------------------------------------------------------------------
-- 头像 Storage：avatars bucket
--   公开读（头像要在 <img> 里直接引用），写入限本人目录 user_id/avatar.webp
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 第九阶段 · 账号级数据一致性：user_settings（偏好设置） + user-assets（用户上传的图片）
--
-- 背景：第五阶段只有 todos 一张表，于是「换了设备就像换了个应用」——
-- 主题、标签、快捷导航、倒计时、仪表板布局、秒表配置、投入日志、壁纸全锁在各设备本机。
-- 这一节把**偏好类**数据也搬到账号上（凭证类与设备相关项刻意留在本机，见文件末尾说明）。
--
-- 为什么是「一行一个 key」而不是「一行一坨 JSON」：
-- 手机上改主题、桌面上调卡片顺序，如果两份数据同住一行的同一个 jsonb，
-- 后写的那次会把另一次一起覆盖掉（整坨 LWW）。拆成一行一个 key 之后，
-- 冲突范围收敛到「同一个设置项」，两处改动互不干扰。
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 按用户整取（登录/进设置页都会拉一遍全量偏好）
create index if not exists user_settings_user_idx on public.user_settings (user_id);

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: own rows only" on public.user_settings;
create policy "user_settings: own rows only"
  on public.user_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 表级权限：与 todos 同一套理由（关掉「自动暴露新表」时没有 GRANT 会 42501；
-- 且只授权 authenticated，anon 连表权限都没有）
grant select, insert, update, delete on table public.user_settings to authenticated;
revoke all on table public.user_settings from anon;

-- ---------------------------------------------------------------------------
-- 用户上传的图片（壁纸）：user-assets bucket
--   路径约定 `<user_id>/<name>-<时间戳>.<ext>`，写入限本人目录；
--   与 avatars 桶一样公开读——壁纸要用 <img>/background-image 直接引用，
--   私有桶得每次生成签名 URL（会过期、要刷新），复杂度不值当。
--   路径里带时间戳：换图就是新地址，天然绕开浏览器/CDN 缓存。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('user-assets', 'user-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "user-assets: public read" on storage.objects;
create policy "user-assets: public read"
  on storage.objects
  for select
  using (bucket_id = 'user-assets');

drop policy if exists "user-assets: owner insert" on storage.objects;
create policy "user-assets: owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user-assets: owner update" on storage.objects;
create policy "user-assets: owner update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user-assets: owner delete" on storage.objects;
create policy "user-assets: owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 自检（跑完这一段直接在下方 Results 里看结果）
--   期望值：todos_table=1 · rls_enabled=true · todo_policies=1
--           avatar_bucket=1 · avatar_policies=4 · anon_can_read=false
--           settings_table=1 · settings_rls=true · settings_policies=1 · anon_can_read_settings=false
--           asset_bucket=1 · asset_policies=4
--   任何一项不对就说明脚本没跑完（常见：只选中了前面一部分就点 Run）
-- ============================================================================
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'todos') as todos_table,
  (select relrowsecurity from pg_class
     where oid = 'public.todos'::regclass) as rls_enabled,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'todos') as todo_policies,
  (select count(*) from storage.buckets where id = 'avatars') as avatar_bucket,
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'avatars:%') as avatar_policies,
  -- 未登录角色应当连表权限都没有（revoke 生效）
  has_table_privilege('anon', 'public.todos', 'select') as anon_can_read,
  -- 第九阶段
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'user_settings') as settings_table,
  (select relrowsecurity from pg_class
     where oid = 'public.user_settings'::regclass) as settings_rls,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'user_settings') as settings_policies,
  has_table_privilege('anon', 'public.user_settings', 'select') as anon_can_read_settings,
  (select count(*) from storage.buckets where id = 'user-assets') as asset_bucket,
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'user-assets:%') as asset_policies;

-- ============================================================================
-- 第六阶段 6.5 · 提醒体系：**不需要改表**
--
-- 提醒相关的字段全部搭在现有的 `todos.payload jsonb` 上（见 src/utils/todoRemote.ts）：
--   payload.reminderAt  提醒时间（ISO 字符串；前端按「到期日 09:00 / 有具体时间则提前 1 小时」生成）
--   payload.snoozedUntil 稍后再做（第六阶段已有的字段，与提醒共用「到期」语义）
-- 这正是当初把扩展字段塞进 jsonb 的原因：加功能不用改表、不用停机、旧客户端也不会挂。
--
-- 与提醒有关的两个前端状态**刻意不入库**：
--   · 已通知标记（localStorage `smart-workspace:reminder-notified`）——它只是「本机别重复弹」，
--     跨设备同步反而会让另一台设备该提醒时被标记成已提醒
--   · WxPusher UID（localStorage `smart-workspace:wxpusher-uid`）——用户级凭证走 BYOK，
--     appToken 在 Edge Function Secrets 里（见 supabase/functions/README.md）
--
-- 所以本文件**无需新增任何表 / 列 / 策略**；下面整段都是可选的进阶部署说明，默认注释掉，
-- 直接整份粘贴执行也不会产生任何副作用。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 【可选 · 进阶】pg_cron 定时扫描：页面关掉也能收到微信提醒
--
-- 应用开着时由前端 `useReminder` 每 30 秒扫描并调 Edge Function `notify`；
-- 页面关掉后前端就不存在了，只有服务端定时任务能兜住「人不在电脑前」。
-- **不做这一步应用也完全可用**（应用内提醒 + 应用开着时的微信推送都在）。
--
-- 动手前必须先解决两件事，否则这段 SQL 跑起来也是空转：
--   1. UID 目前只存在浏览器 localStorage，服务端看不到 —— 需要先把 UID 同步到服务端
--      （例如写进 auth.users.user_metadata，或单独建一张用户设置表）
--   2. 需要 service_role key（pg_cron 以数据库身份调函数，没有用户 JWT），
--      它只能存在 Vault 里，**绝不能**出现在前端、本文件或仓库中
--
-- 另外服务端扫描还得自己补「防重复」（前端那份已通知标记在 localStorage）
-- 与「每条任务最多提醒 2 次」的上限，否则每轮 cron 都会把同一条任务推一次。
--
-- 照抄前请先读：supabase/functions/README.md 的「四、（可选进阶）pg_cron 定时扫描」。
-- ---------------------------------------------------------------------------
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- 密钥入 Vault（值不要留在 SQL 文件里，用控制台或一次性语句写入）
-- -- select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'notify_service_key');
-- -- select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--
-- create or replace function public.scan_due_reminders()
-- returns void
-- language plpgsql
-- security definer
-- set search_path = public, vault, net
-- as $$
-- declare
--   v_url text;
--   v_key text;
--   r     record;
-- begin
--   select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_service_key';
--   select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
--   if v_key is null or v_url is null then
--     raise notice '缺少 Vault 密钥，跳过本轮扫描';
--     return;
--   end if;
--
--   for r in
--     select t.title,
--            u.raw_user_meta_data ->> 'wxpusher_uid' as uid
--     from public.todos t
--     join auth.users u on u.id = t.user_id
--     where t.completed = false
--       and t.payload ? 'reminderAt'
--       -- 只看最近 10 分钟内到点的：更早的属于「应用一打开就补发」的范畴，短信轰炸没有意义
--       and (t.payload ->> 'reminderAt')::timestamptz <= now()
--       and (t.payload ->> 'reminderAt')::timestamptz > now() - interval '10 minutes'
--       and coalesce(u.raw_user_meta_data ->> 'wxpusher_uid', '') <> ''
--   loop
--     perform net.http_post(
--       url     := v_url || '/functions/v1/notify',
--       headers := jsonb_build_object(
--                    'Content-Type',  'application/json',
--                    'Authorization', 'Bearer ' || v_key    -- service_role 绕过平台层 JWT 校验
--                  ),
--       body    := jsonb_build_object(
--                    'uid',     r.uid,
--                    'title',   r.title,
--                    'content', '<p>' || r.title || '</p>',
--                    'url',     v_url
--                  )
--     );
--   end loop;
-- end;
-- $$;
--
-- -- 每 5 分钟跑一次（cron 表达式用 UTC）
-- select cron.schedule('scan-due-reminders', '*/5 * * * *', $$select public.scan_due_reminders()$$);
--
-- -- 运行记录（排查「到底跑没跑」）
-- -- select * from cron.job_run_details order by start_time desc limit 20;

-- ============================================================================
-- 第九阶段 · 刻意**不上云**的数据（不是漏了，是设计）
--
-- 前端把这些键留在本机（见 src/types/settings.ts 的 SYNCED_KEYS / LOCAL_ONLY_KEYS）：
--   · 用户级凭证：AI Key（BYOK）、WxPusher UID —— 进了数据库就等于多一份泄露面，
--     而它们的价值只在「这台设备要用」，换设备重填一次即可
--   · 设备相关：定位记忆 / 定位被拒标记 / 天气缓存（移动端与桌面端本来就在不同城市）、
--     已通知标记（若同步，另一台设备该提醒时会被标成"已提醒"而静默不响）
--   · 界面细节：侧边栏折叠状态（跟着屏幕尺寸走，与账号无关）
--
-- 也就是说：**任务 + 偏好 + 壁纸**三样跟账号走，凭证与设备状态各留各的。
-- ============================================================================

