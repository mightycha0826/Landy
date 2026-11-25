<script lang="ts">
	import { can } from '$lib/adminRoles';
	import { enhance } from '$app/forms';
	import { ACTION_LABEL, CLOSE_LABEL, REASON_LABEL, STATUS_LABEL, fmtTime, TARGET_LABEL } from '$lib/adminTypes';
	import AccountStatus from '$lib/admin/AccountStatus.svelte';
	import { ROLE_LABEL } from '$lib/adminRoles';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import SanctionForm from '$lib/admin/SanctionForm.svelte';
	import { confirmed } from '$lib/admin/confirm';
	import Sid from '$lib/admin/Sid.svelte';
	import { isRestricted } from '$lib/restriction';
	import type { PageProps } from './$types';

	let { data, form }: Pick<PageProps, 'data' | 'form'> = $props();
	const d = $derived(data.d);
	const p = $derived(d.profile);
	const admin = $derived(can(data.staff, 'identity')); // 학생 신원 권한 (Phase 51 표)
	// 지금 정지 중 (영구 · 기간 · 검토 대기) — 조치 칸 맨 위에 "정지 풀기" (Phase 44). 영구 정지는 관리자만 풀 수 있다
	const restricted = $derived(isRestricted(p, Date.now()));
	const canLift = $derived(restricted && (admin || p.status !== 'banned') && (admin || !d.staff_role));
	const askLift = confirmed(() => '이 계정의 정지를 풀까요? 바로 다시 대화 · 편지를 할 수 있어요. 이 조치는 기록됩니다.');

	// 특별 업적 (Phase 44) — 베타 테스터처럼 운영진이 주고 거두는 것
	const askBadge = confirmed((f) => {
		const on = f.get('on') === 'true';
		const title = data.badges.find((b) => b.code === f.get('code'))?.title ?? '특별 업적';
		return on
			? `이 학생에게 "${title}" 업적을 줄까요? 학생 앱에 새 업적 축하가 뜨고 기록에 남습니다.`
			: `"${title}" 업적을 거둘까요? 대표 업적에서도 빠집니다.`;
	});

	// 액션 결과는 다음 액션을 하면 사라지므로 따로 들고 있는다
	let email = $state<string | null>(null);
	let name = $state<string | null>(null);
	$effect(() => {
		// 이전 사용자에게 보낸 열람 요청이 늦게 끝나도 현재 사용자에게 붙이지 않는다.
		if (!form || !('userId' in form) || form.userId !== p.id) return;
		if (form && 'email' in form && form.email) {
			email = form.email;
			name = 'name' in form ? (form.name ?? null) : null;
		}
	});

	const GENDER: Record<string, string> = { m: '남', f: '여', x: '밝히지 않음', any: '상관없음' };

	const askIdentity = confirmed(() => '이 계정의 학교 이메일을 확인합니다. 열람 기록이 남습니다. 계속할까요?');

	// 개인 공지 (Phase 35)
	let pnKind = $state<'message' | 'warning'>('message');
	let pnTitle = $state('');
	let pnBody = $state('');
	const askNotify = confirmed(() => `이 학생에게만 ${pnKind === 'warning' ? '경고' : '개인 공지'}를 보낼까요? 학생 앱에 바로 뜨고 기록에 남습니다.`, {
		keep: true,
		onSuccess: () => {
			pnTitle = '';
			pnBody = '';
		}
	});
	const askUnnotify = confirmed(() => '이 개인 공지를 거둘까요? 학생 화면에서 사라집니다 (기록은 남음).');

	// 닉네임 랜덤 변경권 (Phase 103)
	let ticketN = $state(1);
	const askTickets = confirmed(() => `이 학생에게 닉네임 랜덤 변경권 ${ticketN}장을 줄까요? 바로 쓸 수 있고 기록에 남습니다.`);
</script>

<a class="a-back" href="/admin/users">← 사용자 목록</a>

<header class="a-head">
	<div>
		<h1 class="a-h1">
			{p.nickname ?? '(이름 없음)'}<Sid label={data.students[p.id]} />
			{#if d.staff_role}<span class="pill acc">{ROLE_LABEL[d.staff_role]}</span>{/if}
			<AccountStatus account={p} pill />
		</h1>
		<p class="a-sub">
			{#if d.online}<span class="dot"></span>접속 중{:else if d.last_seen}최근 접속 {fmtTime(d.last_seen)}{/if}
			· 가입 {fmtTime(p.created_at)} · <span class="mono">{p.id}</span>
		</p>
	</div>
</header>

<FormMsg {form} />

<div class="a-grid">
	<div class="a-col">
		<section>
			<h2 class="a-h2">프로필</h2>
			<div class="a-card">
				<dl class="a-dl">
					<dt>성별 / 찾는 상대</dt>
					<dd>{GENDER[p.gender]} / {GENDER[p.want]}</dd>
					<dt>MBTI</dt>
					<dd>{p.mbti ?? '—'}</dd>
					<dt>관심사</dt>
					<dd>{p.interests.length ? p.interests.join(', ') : '—'}</dd>
					<dt>소개</dt>
					<dd>{p.bio || '—'}</dd>
					<dt>학교 인증 / 가입 완료</dt>
					<dd>{p.verified ? '완료' : '미완료'} / {p.onboarded ? '완료' : '미완료'}</dd>
				</dl>
			</div>
		</section>

		<section>
			<h2 class="a-h2">받은 신고 <span class="muted">{d.chat_reports.length + d.letter_reports.length}건</span></h2>
			{#if d.chat_reports.length + d.letter_reports.length === 0}
				<p class="a-warn">받은 신고 없음</p>
			{:else}
				<ul class="a-list a-card">
					{#each d.chat_reports as r (r.id)}
						<li>
							<a href="/admin/reports/{r.id}">{fmtTime(r.created_at)} · 채팅 · {REASON_LABEL[r.reason] ?? r.reason}</a>
							<span class="st st-{r.status}">{STATUS_LABEL[r.status]}</span>
						</li>
					{/each}
					{#each d.letter_reports as r (r.id)}
						<li>
							<a href="/admin/letters/{r.id}">
								{fmtTime(r.created_at)} · {TARGET_LABEL[r.target_type] ?? r.target_type} · {REASON_LABEL[r.reason] ?? r.reason}
							</a>
							<span class="st st-{r.status}">{STATUS_LABEL[r.status]}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2 class="a-h2">제재 이력</h2>
			{#if d.history.length === 0}
				<p class="a-warn">제재 이력 없음</p>
			{:else}
				<ul class="a-list a-card">
					{#each d.history as h, i (i)}
						<li>
							<span>
								<b>{ACTION_LABEL[h.action] ?? h.action}</b>
								{#if h.detail?.days}{h.detail.days}일{/if}
								{#if h.detail?.note}<span class="muted"> · {h.detail.note}</span>{/if}
							</span>
							<span class="muted num">{fmtTime(h.created_at)}{h.staff_id ? '' : ' · 자동'}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if admin && data.rooms}
			<section>
				<h2 class="a-h2">대화 <span class="muted">{data.rooms.length}개</span></h2>
				{#if data.rooms.length === 0}
					<p class="a-warn">대화 기록 없음</p>
				{:else}
					<table class="a-table">
						<thead>
							<tr><th>시작</th><th>방 안 이름</th><th>상대</th><th class="r">메시지</th><th>상태</th></tr>
						</thead>
						<tbody>
							{#each data.rooms as r (r.id)}
								<tr>
									<td class="num muted"><a href="/admin/rooms/{r.id}">{fmtTime(r.created_at)}</a></td>
									<td>{r.alias}</td>
									<td>
										{#if r.partner_id}<a href="/admin/users/{r.partner_id}">{r.partner_nickname ?? r.partner_id.slice(0, 8)}</a><Sid label={data.students[r.partner_id]} />{:else}—{/if}
									</td>
									<td class="r num">{r.message_count}</td>
									<td>
										{#if r.live}<span class="pill acc">진행 중</span>
										{:else}<span class="muted">{CLOSE_LABEL[r.close_reason ?? ''] ?? '종료'}</span>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p class="a-hint">대화 내용은 끝나고 24시간 뒤 서버에서 지워집니다 (신고된 대화는 신고 사본으로 남음).</p>
				{/if}
			</section>

		{/if}
	</div>

	<aside class="a-aside">
		<section class="a-card">
			<h2 class="a-h2">활동</h2>
			<dl class="a-dl">
				<dt>경고 누적</dt>
				<dd class="num" class:danger={p.strikes > 0}>{p.strikes}회</dd>
				<dt>대화</dt>
				<dd class="num">{d.counts.rooms}개 (진행 중 {d.counts.open_rooms})</dd>
				<dt>쓴 편지</dt>
				<dd class="num">{d.counts.letters}통</dd>
				<dt>낸 신고</dt>
				<dd class="num">{d.counts.reports_filed}건</dd>
				<dt>기각된 신고</dt>
				<dd class="num" class:danger={d.counts.reports_dismissed >= 2}>{d.counts.reports_dismissed}건</dd>
			</dl>
		</section>

		{#if restricted}
			<!-- 지금 정지 중 — 한 번에 풀 수 있게 맨 위에 (Phase 44) -->
			<section class="a-card lift">
				<h2 class="a-h2">정지 중</h2>
				<p class="a-hint" style="margin-top:0"><AccountStatus account={p} /></p>
				{#if canLift}
					<form method="POST" action="?/sanction" use:enhance={askLift}>
						<input type="hidden" name="action" value="reinstate" />
						<input class="field" name="note" maxlength="1000" placeholder="푸는 이유 (기록용, 선택)" />
						<button class="btn">정지 풀기</button>
					</form>
				{:else}
					<p class="a-hint">{p.status === 'banned' ? '영구 정지는 관리자만 풀 수 있습니다.' : '운영진 계정은 관리자만 조치할 수 있습니다.'}</p>
				{/if}
			</section>
		{/if}

		<section class="a-card">
			<h2 class="a-h2">조치</h2>
			{#if d.staff_role && !admin}
				<p class="a-hint">운영진 계정은 관리자만 조치할 수 있습니다.</p>
			{:else}
				<SanctionForm isAdmin={data.staff?.role === 'admin'} banned={p.status === 'banned'} {restricted} />
			{/if}
		</section>

		<!-- 특별 업적 (Phase 44) — 베타 테스터처럼 운영진이 주는 것. 주면 학생 앱에 새 업적 축하가 뜬다 -->
		{#if data.badges.length}
			<section class="a-card">
				<h2 class="a-h2">특별 업적</h2>
				<ul class="a-list badges">
					{#each data.badges as b (b.code)}
						<li>
							<span>
								<b>{b.title}</b>
								<span class="muted"> · {b.has ? `받음 ${fmtTime(b.earned_at ?? '')}` : '없음'}</span>
							</span>
							<form method="POST" action="?/badge" use:enhance={askBadge}>
								<input type="hidden" name="code" value={b.code} />
								<input type="hidden" name="on" value={String(!b.has)} />
								<button class={b.has ? 'btn-text' : 'btn sm-inline'}>{b.has ? '거두기' : '주기'}</button>
							</form>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.tickets !== null}
			<!-- 닉네임 랜덤 변경권 (Phase 103) — 가입 · 뱃지로 받는 것에 더해 운영진이 몇 장 더 -->
			<section class="a-card">
				<h2 class="a-h2">닉네임 변경권 <span class="muted">남은 {data.tickets}장</span></h2>
				<form class="tickets" method="POST" action="?/tickets" use:enhance={askTickets}>
					<select class="field" name="n" bind:value={ticketN} aria-label="줄 장수">
						{#each [1, 2, 3, 5, 10] as n (n)}<option value={n}>{n}장</option>{/each}
					</select>
					<button class="btn sm-inline">주기</button>
				</form>
				<p class="a-hint">학생이 쓰면 닉네임이 무작위로 바뀝니다. 준 기록은 활동 기록에 남아요.</p>
			</section>
		{/if}

		<section class="a-card">
			<h2 class="a-h2">개인 공지</h2>
			<p class="a-hint" style="margin-top:0">이 학생에게만 보이는 공지 — 경고나 개인 연락. 학생 앱의 공지 · 알림(하트)에 뜨고 알림도 갑니다.</p>
			<form class="pn" method="POST" action="?/notify" use:enhance={askNotify}>
				<select class="field" name="kind" bind:value={pnKind}>
					<option value="message">개인 연락</option>
					<option value="warning">경고</option>
				</select>
				<input class="field" name="title" maxlength="80" placeholder="제목" bind:value={pnTitle} required />
				<textarea class="field" name="body" maxlength="2000" rows="4" placeholder="내용 (선택)" bind:value={pnBody}></textarea>
				<button class="btn sm">보내기</button>
			</form>
			{#if data.notices.length}
				<ul class="a-list pn-list">
					{#each data.notices as n (n.id)}
						<li>
							<span>
								{#if n.kind === 'warning'}<span class="pill red">경고</span>{/if}
								<b>{n.title}</b>
								<span class="muted"> · {fmtTime(n.created_at)} · {n.read_at ? `읽음 ${fmtTime(n.read_at)}` : '안 읽음'}</span>
							</span>
							<form method="POST" action="?/unnotify" use:enhance={askUnnotify}>
								<input type="hidden" name="id" value={n.id} />
								<button class="btn-text">거두기</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if admin}
			<section class="a-card">
				<h2 class="a-h2">학교 이메일</h2>
				{#if email}
					<p class="mono email">{email}{#if name}<span class="rname">({name})</span>{/if}</p>
					<p class="a-hint">이 열람은 활동 기록에 남습니다.</p>
				{:else}
					<p class="a-hint">열람하면 누가 언제 봤는지 기록됩니다.</p>
					<form method="POST" action="?/identity" use:enhance={askIdentity}>
						<button class="btn-ghost sm">이메일 확인</button>
					</form>
				{/if}
			</section>
		{/if}
	</aside>
</div>

<style>
	.sm {
		margin-top: 8px;
		height: 36px;
		font-size: 13px;
	}
	.email {
		margin: 0;
		font-size: 14px;
	}
	.pn {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pn textarea {
		height: auto;
		padding: 10px 14px;
		resize: vertical;
	}
	.pn-list {
		margin-top: 12px;
	}
	.pn-list li {
		align-items: center;
		gap: 8px;
	}
	.a-h1 .pill {
		font-size: 12px;
		vertical-align: 4px;
	}
	/* 정지 중 — 풀기 칸 (Phase 44) */
	.lift {
		border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
	}
	.lift form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.badges li {
		align-items: center;
		gap: 8px;
	}
	.tickets {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.tickets select {
		flex: 1;
	}
	.sm-inline {
		width: auto;
		height: 34px;
		padding: 0 16px;
		font-size: 13px;
	}
</style>
