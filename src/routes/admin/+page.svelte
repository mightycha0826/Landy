<script lang="ts">
	/**
	 * 개요 (Phase 96) — 운영 콘솔 첫 화면: 지금 처리할 일 → 지금 앱 상태 → 14일 추이 → 시스템.
	 * 칸은 DB(admin_overview)가 내 권한만큼만 채워 준다 — 없는 권한의 칸은 아예 그리지 않는다.
	 * 예전 첫 화면(채팅 신고 목록)과 두 신고 화면 위에 겹쳐 있던 숫자 줄은 여기로 모았다.
	 */
	import { canSee } from '$lib/adminRoles';
	import { fmtTime } from '$lib/adminTypes';
	import TrendChart from '$lib/admin/TrendChart.svelte';

	let { data } = $props();
	const o = $derived(data.overview);
	const sees = (path: string) => canSee(data.staff, path);
	const n = (v: number) => v.toLocaleString('ko-KR');

	/** 할 일 — 내 권한으로 처리할 수 있는 것만 (DB 가 나머지는 null 로 준다) */
	const todo = $derived(
		!o
			? []
			: [
					{ label: '채팅 신고', count: o.todo.chat_reports, href: '/admin/reports?kind=chat', hint: '미처리' },
					{ label: '편지 신고', count: o.todo.letter_reports, href: '/admin/reports?kind=letter', hint: '미처리' },
					{ label: '검토 중인 신고', count: o.todo.reviewing, href: '/admin/reports?kind=chat&status=reviewing', hint: '마무리 필요', soft: true },
					{ label: '학생 문의', count: o.todo.inquiries, href: '/admin/inquiries', hint: '답을 기다림' },
					{ label: '뱃지 요청', count: o.todo.badge_requests, href: '/admin/badge-requests', hint: '심사 대기' }
				].flatMap((t) => (t.count === null ? [] : [{ ...t, count: t.count }]))
	);
	const waiting = $derived(todo.filter((t) => !t.soft).reduce((sum, t) => sum + t.count, 0));

	const TRENDS = [
		{ key: 'signups', title: '가입', unit: '명' },
		{ key: 'rooms', title: '새 대화', unit: '개' },
		{ key: 'letters', title: '보낸 편지', unit: '통' },
		{ key: 'reports', title: '신고', unit: '건' }
	] as const;
	const trends = $derived(
		!o ? [] : TRENDS.filter((t) => o.days[0]?.[t.key] != null).map((t) => ({ ...t, days: o.days.map((d) => ({ d: d.d, v: d[t.key] ?? 0 })) }))
	);

	const service = $derived(!o ? null : o.live.maintenance ? { text: '서버 점검 중', kind: 'warn' } : o.live.is_open ? { text: '서비스 운영 중', kind: 'ok' } : { text: '서비스 닫힘', kind: 'off' });
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">개요</h1>
		<p class="a-sub">{o ? `${fmtTime(o.now)} 기준 · 화면을 새로 열면 다시 셉니다` : '운영 콘솔 첫 화면'}</p>
	</div>
	{#if service}
		<svelte:element this={sees('/admin/settings') ? 'a' : 'span'} class="service {service.kind}" href={sees('/admin/settings') ? '/admin/settings' : undefined}>
			<i aria-hidden="true"></i>{service.text}
		</svelte:element>
	{/if}
</header>

{#if !o}
	<p class="a-warn">
		개요 수치를 불러오지 못했어요. DB 에 Phase 96 SQL(<code>supabase/migrations/20261110120000_admin_overview_phase96.sql</code>)을 아직 적용하지 않았다면 적용한 뒤에 보여요.
		그동안에도 왼쪽 메뉴의 화면은 모두 그대로 쓸 수 있어요.
	</p>
{:else}
	{#if todo.length}
		<section aria-labelledby="todo-h">
			<h2 class="a-h2" id="todo-h">할 일 <span class="muted">{waiting ? `${n(waiting)}건이 기다려요` : '밀린 일이 없어요'}</span></h2>
			<div class="tiles">
				{#each todo as t (t.label)}
					<a class="tile link" class:hot={t.count > 0 && !t.soft} href={t.href}>
						<b class="num">{n(t.count)}</b>
						<span>{t.label}</span>
						<small>{t.count > 0 ? t.hint : '없음'}</small>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<section aria-labelledby="live-h">
		<h2 class="a-h2" id="live-h">지금</h2>
		<div class="tiles">
			<svelte:element this={sees('/admin/live') ? 'a' : 'div'} class="tile" class:link={sees('/admin/live')} href={sees('/admin/live') ? '/admin/live' : undefined}>
				<b class="num">{n(o.live.online)}</b><span>접속 중</span><small>오늘 접속 {n(o.totals.active_today)}명</small>
			</svelte:element>
			<div class="tile"><b class="num">{n(o.live.seeking)}</b><span>상대 찾는 중</span><small>매칭 대기</small></div>
			<div class="tile"><b class="num">{n(o.live.active_rooms)}</b><span>진행 중 대화</span><small>고정한 대화 포함</small></div>
			<div class="tile"><b class="num">{n(o.totals.students)}</b><span>가입한 학생</span><small>인증 · 시작하기 완료</small></div>
			<svelte:element this={sees('/admin/users') ? 'a' : 'div'} class="tile" class:link={sees('/admin/users')} href={sees('/admin/users') ? '/admin/users?filter=restricted' : undefined}>
				<b class="num">{n(o.totals.restricted)}</b><span>이용 제한 계정</span><small>정지 · 영구 정지</small>
			</svelte:element>
		</div>
	</section>

	<section aria-labelledby="trend-h">
		<h2 class="a-h2" id="trend-h">14일 추이 <span class="muted">한국 날짜 기준 · 막대에 올리면 그날 수</span></h2>
		<div class="trends">
			{#each trends as t (t.key)}
				<TrendChart title={t.title} unit={t.unit} days={t.days} />
			{/each}
		</div>
		<p class="a-hint">메시지 수는 세지 않아요 — 끝난 대화의 메시지는 24시간 뒤 지워져서 지난날을 셀 수 없습니다.</p>
	</section>

	{#if o.system}
		{@const s = o.system}
		<section aria-labelledby="sys-h">
			<h2 class="a-h2" id="sys-h">시스템 <span class="muted">AI 검토 · 푸시 알림</span></h2>
			<div class="tiles">
				<div class="tile"><b class="num">{n(s.mod_pending)}</b><span>AI 검토 대기</span><small>오늘 검토 {n(s.mod_checked_today)}건</small></div>
				<div class="tile" class:alert={s.mod_errors_24h > 0}>
					<b class="num">{n(s.mod_errors_24h)}</b><span>검토 오류</span><small>{s.mod_errors_24h > 0 ? '⚠ 확인 필요 · 24시간' : '24시간'}</small>
				</div>
				<div class="tile"><b class="num">{n(s.ai_chats_today)}</b><span>대화 봇 이용</span><small>오늘 시작한 대화</small></div>
				<div class="tile" class:alert={s.push_failed_24h > 0}>
					<b class="num">{n(s.push_sent_24h)}</b><span>푸시 보냄</span><small>{s.push_failed_24h > 0 ? `⚠ 실패 ${n(s.push_failed_24h)}건 · 24시간` : '실패 없음 · 24시간'}</small>
				</div>
				<div class="tile"><b class="num">{n(s.push_devices)}</b><span>알림 받는 기기</span><small>구독 중</small></div>
			</div>
			<p class="a-hint">AI 하루 한도 · 금칙어 · 점검은 <a href="/admin/settings">운영 설정</a>에서.</p>
		</section>
	{/if}
{/if}

<style>
	section {
		margin-bottom: 26px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); /* 다섯 칸이 한 줄에 (본문 폭 약 660px 일 때) */
		gap: 10px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
	}
	.tile b {
		font-size: 26px;
		font-weight: 650;
		letter-spacing: -0.03em;
		line-height: 1.15;
	}
	.tile span {
		font-size: 13px;
		font-weight: 600;
	}
	.tile small {
		font-size: 12px;
		color: var(--text-2);
	}
	.tile.link {
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.tile.link:hover {
		border-color: var(--text-2);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
	}
	/* 밀린 일 — 숫자와 왼쪽 띠로 (색만으로 알리지 않게 아래 글도 "미처리 · 답을 기다림"으로 바뀐다) */
	.tile.hot {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.tile.hot b {
		color: var(--accent);
	}
	.tile.alert small {
		color: var(--danger);
		font-weight: 600;
	}
	.trends {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
	}
	.service {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.service i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #16a34a;
	}
	.service.off i {
		background: var(--danger);
	}
	.service.warn i {
		background: #f59e0b;
	}
	.a-warn code {
		font-size: 12px;
		overflow-wrap: anywhere;
	}
</style>
