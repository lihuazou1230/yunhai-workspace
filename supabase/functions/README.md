# Supabase Edge Functions（服务端能力收口）

> 为什么这里只有 Supabase：GitHub Pages 是**纯静态托管，没有 Serverless Functions**，
> 而 WxPusher 的 `appToken` 属于开发者凭证，放进前端产物等于公开。
> 所以服务端能力统一收口到已经在用的 Supabase（Auth / DB / Storage / Edge Functions 同平台管理），
> 不引入第二个后端。

当前只有一个函数：

| 函数     | 作用                                                                                  | 入口                                 |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| `notify` | WxPusher 微信推送代理：前端只传 `{ uid, title, content, url }`，appToken 在服务端拼接 | `supabase/functions/notify/index.ts` |

---

## 一、部署 `notify`

前置：安装 [Supabase CLI](https://supabase.com/docs/guides/cli)，并在项目根目录执行过登录与关联。

```bash
supabase login
supabase link --project-ref <你的-project-ref>       # project-ref 见 Supabase 控制台 URL
supabase functions deploy notify
```

### ⚠️ 不要加 `--no-verify-jwt`

`--no-verify-jwt` 会**关掉平台层的 JWT 校验**，函数将变成任何人都能直接 POST 的公开接口，
等于把 appToken 的推送额度送给全网。

本项目的防线是**两层叠加**：

1. **平台层**：默认开启的 JWT 校验（部署时保持默认即可，不要传上面那个参数）
2. **函数内**：`index.ts` 里用调用者的 JWT 建 Supabase 客户端并 `auth.getUser()`
   —— 拿到的是 Auth 服务**验签过**的用户；顺带把「token 过期 / 被吊销」也拒掉。
   没有有效用户一律回 **401**，请求根本到不了 WxPusher。

> 为什么两层都要：平台层挡住未登录的裸请求；函数内校验保证即使将来有人改了部署参数，
> 代码自身也不会把接口暴露成公开代理（防白嫖刷量）。

## 二、配置 Secret

`appToken` 只存在于服务端 Secrets，**绝不写进代码、绝不进前端 `.env`**：

```bash
# 在 WxPusher 官网创建应用后拿到 AT_ 开头的 appToken
supabase secrets set WXPUSHER_APP_TOKEN=AT_xxxxxxxxxxxxxxxx

# 查看已设置的 secret 名单（只看名字，不回显值）
supabase secrets list
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` 由平台自动注入，**不需要**手动设置。

本地调试（`.env.local` 放在 `supabase/` 下，已被 gitignore 忽略）：

```bash
supabase functions serve notify --env-file ./supabase/.env.local
# 然后调用 http://localhost:54321/functions/v1/notify
```

## 三、接口契约

请求（`POST /functions/v1/notify`，`Authorization: Bearer <用户 JWT>`）：

```json
{
  "uid": "UID_xxxx",
  "title": "写周报",
  "content": "<p>...</p>",
  "url": "https://<你的站点>/todos?focus=t1"
}
```

> ⚠️ `url` 必须是**路径式**（`/todos?focus=<id>`），不能写成 `#/todos?focus=<id>`。
> 本项目用的是 history 路由：hash 片段不会触发 vue-router 导航，用户点开推送只会
> 停在首页、什么都不会发生。前端由 `src/utils/wxpusher.ts` 的 `deepLink()` 统一生成
> （已适配 GitHub Pages 子路径），单测 `src/utils/wxpusher.spec.ts` 专门锁了这条格式。

| 状态                   | 含义                                           | 前端表现                 |
| ---------------------- | ---------------------------------------------- | ------------------------ |
| `200 { "ok": true }`   | 已交给 WxPusher（异步分发）                    | 静默成功                 |
| `400 { "error": ... }` | 入参不合法（uid/content 缺失等）               | Toast 展示服务端中文文案 |
| `401 { "error": ... }` | 未登录 / 登录过期                              | 提示先登录               |
| `405 { "error": ... }` | 非 POST                                        | —                        |
| `502 { "error": ... }` | WxPusher 业务失败（`code !== 1000`）或响应异常 | 提示推送被拒绝           |
| `503 { "error": ... }` | 未配置 `WXPUSHER_APP_TOKEN`                    | 提示服务端未配置         |
| `504 { "error": ... }` | 调 WxPusher 超时 / 网络不通                    | 提示稍后重试             |

> 注意：WxPusher 的消息是**异步分发**的，`200` 只代表发送任务已创建；
> 单个接收者是否真的收到，要用响应里的 `sendRecordId` 去查（本项目未做，够用即可）。

## 四、（可选进阶）pg_cron 定时扫描：页面关了也能收到

> **这条路径是可选的，不影响应用正常使用。**
> 应用开着时由前端 `useReminder` 扫描并调 `notify`；页面关掉后前端不存在了，
> 只有服务端定时任务能兜住「人不在电脑前」。

### 动手前必须知道的两个前提

1. **UID 目前只存在浏览器 localStorage（BYOK）**，服务端看不到。
   要让它能跑，必须先把 UID 同步到服务端（例如写进 `auth.users.user_metadata` 或单独建表），
   本阶段没有做——这也是它被归为「进阶」的主要原因。
2. **需要 service_role key**（pg_cron 以数据库身份调函数，没有用户 JWT）。
   它**只能存在 Vault 里**，绝不能出现在前端、SQL 文件或仓库里。

### 参考 SQL（照抄前请先补齐上面两点）

```sql
-- 1) 扩展：pg_cron 负责定时，pg_net 负责在数据库里发 HTTP 请求
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) 把密钥放进 Vault（值不要在 SQL 文件里留痕，用控制台/一次性语句写入）
--    select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'notify_service_key');
--    select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');

-- 3) 扫描到期任务并逐个调 Edge Function
create or replace function public.scan_due_reminders()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_url text;
  v_key text;
  r     record;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_service_key';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_key is null or v_url is null then
    raise notice '缺少 Vault 密钥，跳过本轮扫描';
    return;
  end if;

  for r in
    select t.id,
           t.title,
           u.raw_user_meta_data ->> 'wxpusher_uid' as uid,   -- ← 需要先把 UID 同步到服务端
           t.payload ->> 'reminderAt'               as reminder_at
    from public.todos t
    join auth.users u on u.id = t.user_id
    where t.completed = false
      and t.payload ? 'reminderAt'
      and (t.payload ->> 'reminderAt')::timestamptz <= now()
      and (t.payload ->> 'reminderAt')::timestamptz > now() - interval '10 minutes'
      and coalesce(u.raw_user_meta_data ->> 'wxpusher_uid', '') <> ''
  loop
    perform net.http_post(
      url     := v_url || '/functions/v1/notify',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_key          -- service_role 绕过平台 JWT 校验
                 ),
      body    := jsonb_build_object(
                   'uid',     r.uid,
                   'title',   r.title,
                   'content', '<p>' || r.title || '</p>',
                   'url',     v_url
                 )
    );
  end loop;
end;
$$;

-- 4) 每 5 分钟跑一次（cron 表达式是 UTC）
select cron.schedule('scan-due-reminders', '*/5 * * * *', $$select public.scan_due_reminders()$$);
```

还需要补的部分（同样留作进阶）：

- **防重复**：前端已通知标记在 localStorage，服务端看不到；服务端扫描要另建一个
  「已推送」标记（表或 `payload` 里的字段），否则每 5 分钟会把同一条任务推一次。
- **每人最多 2 次**的防骚扰上限也需要在服务端复刻（前端逻辑服务端用不上）。
- 查看运行情况：`select * from cron.job_run_details order by start_time desc limit 20;`

## 五、排错

| 现象                            | 多半是                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| 前端提示「推送代理尚未部署」    | 没执行 `supabase functions deploy notify`（或函数名不是 `notify`） |
| `401 未登录或登录已过期`        | 前端本地会话已过期；重新登录即可                                   |
| `503 未配置 WXPUSHER_APP_TOKEN` | 忘了 `supabase secrets set`，或设置后需重新部署一次                |
| `502 微信推送被拒绝：...`       | appToken 无效 / UID 不属于该应用；按冒号后的 WxPusher 原文排查     |
| 微信收到的是带 `<p>` 的纯文本   | `contentType` 被改成了 3（Markdown）；HTML 必须是 2                |
| 扫码后拿不到 UID                | 用的是应用二维码（`/api/qrcode/...`）而不是普通关注二维码          |
