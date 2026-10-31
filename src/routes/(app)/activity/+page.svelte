<script lang="ts">
	/**
	 * 알림 (Phase 35 — 상단 하트) — 새 메시지 · 새 편지 · 공지 · 나에게 온 개인 공지를 한 목록에 (인스타 "활동"처럼).
	 * Phase 40: 공지를 따로 나누지 않는다 — "공지사항" 화면 · "공지 ·" 머리말 없이 다른 알림과 같은 줄로, 시간순으로 섞인다.
	 *   새 알림: 안 읽은 대화 · 안 연 편지 · 안 읽은 개인 공지 · 안 본 공지 — 최근 것부터
	 *   지난 알림: 최근에 연 편지 · 읽은 개인 공지 · 지난 공지 몇 개
	 * 누르면 그 화면으로 (공지는 공지 한 개 화면, 개인 공지는 그 자리에서 펼쳐 읽는다).
	 * 이 화면을 열면 공지는 본 것으로 저장한다 (하트의 빨간 점이 꺼진다). 다만 이번에 연 동안은 "새 알림"에 그대로 둔다.
	 * 목록은 앱이 기억해 둔 것(INBOX · 편지함 · 공지)부터 바로 그리고 뒤에서 새로 읽는다.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import BackButton from '$lib/ui/BackButton.svelte';
	import LoadError from '$lib/ui/LoadError.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { INBOX } from '$lib/inbox.svelte';
	import { BOX, refreshMailbox } from '$lib/letters/mailbox.svelte';
	import { borderOf, fromLabel } from '$lib/letters/api';
	import { NOTICES, loadNotices, markNoticesSeen, readPersonal } from '$lib/notices.svelte';
	import { clearNotifications } from '$lib/push';
	import { S } from '$lib/state.svelte';
	import { agoText } from '$lib/time';

	// 화면을 열 때까지 본 공지 번호 · 안 읽었던 개인 공지 — 열자마자 본 것으로 저장해도 이번에는 "새 알림"에 남게
	let seen = $state<{ notice: number; personal: number[] } | null>(null);
	// 공지를 보고 뒤로 돌아와도 그대로 (SvelteKit snapshot)
	export const snapshot = {
		capture: () => seen,
		restore: (v: typeof seen) => (seen = v)
	};
	const snap = () => ({ notice: NOTICES.lastSeen, personal: NOTICES.personal.filter((n) => !n.read).map((n) => n.id) });

	// 공지를 못 불러왔다 — 대화 목록(INBOX.failed) · 편지함(BOX.error)과 함께, 못 불러온 것을 "모두 확인했어요"로 보이지 않는다 (UX G4)
	let noticeFailed = $state(false);
	const someFailed = $derived(INBOX.failed || !!BOX.error.received || noticeFailed);

	function load() {
		void INBOX.load();
		refreshMailbox();
		untrack(() => {
			if (NOTICES.loaded && !seen) seen = snap();
		});
		void (async () => {
			noticeFailed = !(await loadNotices(true));
			untrack(() => (seen ??= snap()));
			await markNoticesSeen();
			void clearNotifications('pn-', true);
		})();
	}
	$effect(() => untrack(load));

	const newNotice = (id: number) => id > (seen?.notice ?? NOTICES.lastSeen);
	const newPersonal = (n: { id: number; read: boolean }) => (seen ? seen.personal.includes(n.id) : !n.read);
	// 펼쳐 읽는 개인 공지
	let openP = $state<number | null>(null);
	function togglePersonal(id: number) {
		openP = openP === id ? null : id;
		if (openP === id) void readPersonal(id);
	}

	type Item = {
		key: string;
		kind: 'chat' | 'letter' | 'warning' | 'notice' | 'staff';
		title: string;
		body: string;
		at: string;
		/** 누르면 갈 곳 (없으면 그 자리에서 펼친다 — 개인 공지) */
		url?: string;
		pid?: number;
		badge?: number;
		face?: string;
		border?: 'f' | 'm' | 'x' | 'brand';
	};
	const byTime = (a: Item, b: Item) => Date.parse(b.at) - Date.parse(a.at);
	const notice = (n: (typeof NOTICES.list)[number]): Item => ({ key: `n${n.id}`, kind: 'notice', title: n.title, body: n.body, at: n.created_at, url: `/notices/${n.id}` });
	const personal = (n: (typeof NOTICES.personal)[number]): Item => ({
		key: `p${n.id}`,
		kind: n.kind === 'warning' ? 'warning' : 'staff',
		title: n.kind === 'warning' ? `경고 · ${n.title}` : n.title,
		body: n.body,
		at: n.created_at,
		pid: n.id
	});

	const fresh = $derived.by(() => {
		const out: Item[] = [];
		for (const r of INBOX.rooms) {
			if (r.unread > 0 || !r.joined)
				out.push({
					key: `c${r.room_id}`,
					kind: 'chat',
					title: r.joined ? `${r.partner_alias}님의 새 메시지` : `${r.partner_alias}님과 새로 연결됐어요`,
					body: r.joined ? (r.last_body ?? '') : '눌러서 대화를 시작해 보세요',
					at: r.last_at ?? r.expires_at,
					url: `/chat/${r.room_id}`,
					badge: r.unread,
					face: r.partner_alias
				});
		}
		for (const l of BOX.received) {
			if (l.opened || l.removed) continue;
			out.push({
				key: `l${l.id}`,
				kind: 'letter',
				title: `${fromLabel(l)}에게서 ${l.is_reply ? '답장' : '편지'}가 왔어요`,
				body: '봉투를 열어 확인해 보세요',
				at: l.created_at,
				url: `/letters/m/${l.id}`,
				border: borderOf(l, 'received')
			});
		}
		for (const n of NOTICES.personal) if (newPersonal(n)) out.push(personal(n));
		for (const n of NOTICES.list) if (newNotice(n.id)) out.push(notice(n));
		return out.sort(byTime);
	});

	const past = $derived.by(() => {
		const out: Item[] = [];
		for (const l of BOX.received.filter((x) => x.opened && !x.removed).slice(0, 5))
			out.push({ key: `l${l.id}`, kind: 'letter', title: `${fromLabel(l)}의 ${l.is_reply ? '답장' : '편지'}`, body: '다시 읽기', at: l.created_at, url: `/letters/m/${l.id}`, border: borderOf(l, 'received') });
		for (const n of NOTICES.personal.filter((x) => !newPersonal(x)).slice(0, 5)) out.push(personal(n));
		for (const n of NOTICES.list.filter((x) => !newNotice(x.id)).slice(0, 8)) out.push(notice(n));
		return out.sort(byTime);
	});
	const ready = $derived(INBOX.loaded || BOX.loaded.received || NOTICES.loaded || someFailed);
</script>

<div class="topbar">
	<BackButton href="/" history />
	<span class="title">알림</span>
</div>

<div class="page activity">
	{#snippet row(it: Item, i: number, isNew: boolean)}
		{@const expanded = it.pid != null && openP === it.pid}
		<li style:--i={i}>
			<button
				class="row"
				class:unread={isNew}
				class:expanded
				onclick={() => (it.url ? goto(it.url) : togglePersonal(it.pid!))}
				aria-expanded={it.url ? undefined : expanded}
			>
				<span class="ico {it.kind} b-{it.border ?? 'brand'}" aria-hidden="true">
					{#if it.kind === 'chat' && it.face}
						<Avatar name={it.face} size={46} />
					{:else if it.kind === 'letter'}
						<svg viewBox="0 0 24 24"><path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="currentColor" /><path d="M4.5 7l7.5 5.5L19.5 7" fill="none" stroke="rgb(120 20 50 / .55)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
					{:else if it.kind === 'warning'}
						<svg viewBox="0 0 24 24"><path d="M12 3.5l9 16H3z" fill="currentColor" /><path d="M12 10v4.5M12 17.2v.1" stroke="rgb(150 20 30)" stroke-width="2" stroke-linecap="round" /></svg>
					{:else if it.kind === 'staff'}
						<svg viewBox="0 0 24 24"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" fill="currentColor" /><path d="M8 10h8M8 13h5" stroke="rgb(0 0 0 / .28)" stroke-width="1.6" stroke-linecap="round" /></svg>
					{:else}
						<svg viewBox="0 0 24 24"><path d="M4 10v4h3l6 4V6L7 10z" fill="currentColor" /><path d="M16.5 9a4 4 0 0 1 0 6M18.8 6.8a7 7 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
					{/if}
				</span>
				<span class="mid">
					<strong>{it.title}</strong>
					{#if it.body && !expanded}<span class="body">{it.body}</span>{/if}
				</span>
				<span class="right">
					<time class="num">{agoText(it.at, S.now)}</time>
					{#if it.badge}<span class="badge num">{it.badge > 99 ? '99+' : it.badge}</span>{:else if isNew}<span class="new-dot"></span>{/if}
				</span>
			</button>
			{#if expanded && it.body}<p class="full selectable">{it.body}</p>{/if}
		</li>
	{/snippet}

	{#if !ready}
		<ul class="list" aria-label="불러오는 중">
			{#each [0, 1, 2] as i (i)}<li class="skel"><i class="skeleton"></i><span><b class="skeleton"></b><em class="skeleton"></em></span></li>{/each}
		</ul>
	{:else}
		{#if someFailed}
			<LoadError msg="알림을 다 불러오지 못했어요. 연결을 확인해 주세요." onretry={load} />
		{/if}
		<h2>새 알림</h2>
		{#if fresh.length}
			<ul class="list">{#each fresh as it, i (it.key)}{@render row(it, i, true)}{/each}</ul>
		{:else if !someFailed}
			<div class="none">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.6-4.6-7.6-10.3A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.6 2.8c0 5.7-7.6 10.3-7.6 10.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
				<p>새 알림을 모두 확인했어요</p>
			</div>
		{/if}
		{#if past.length}
			<h2>지난 알림</h2>
			<ul class="list">{#each past as it, i (it.key)}{@render row(it, i, false)}{/each}</ul>
		{/if}
	{/if}
</div>

<style>
	.activity {
		gap: 8px;
		padding-top: 6px;
		padding-bottom: calc(28px + env(safe-area-inset-bottom));
	}
	h2 {
		margin: 16px 2px 4px;
		font-size: 16px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list li {
		animation: in 0.4s calc(min(var(--i, 0), 8) * 40ms) cubic-bezier(0.25, 0.8, 0.25, 1) both;
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 4px;
		border-radius: 16px;
		text-align: left;
		transition: background 0.2s;
	}
	.row:active {
		background: var(--field);
	}
	.ico {
		flex: none;
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border-radius: 50%;
	}
	.ico svg {
		width: 22px;
		height: 22px;
	}
	.ico.letter {
		background: var(--accent-fill-deep);
		color: #fff;
	}
	.ico.letter.b-f {
		background: linear-gradient(135deg, #e0474f, #9d1830);
	}
	.ico.letter.b-m {
		background: linear-gradient(135deg, #3a7ae0, #173f8c);
	}
	/* 공지 · 운영진 연락도 다른 알림과 같은 꼴 — 색 동그라미 + 흰 그림 (테마 색을 따른다) */
	.ico.notice,
	.ico.staff {
		background: var(--accent-fill-deep);
		color: #fff;
	}
	.ico.warning {
		background: linear-gradient(135deg, #f0525c, #b3122a);
		color: #fff;
	}
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mid strong {
		font-size: 14.5px;
		font-weight: 600;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.unread .mid strong {
		font-weight: 650;
	}
	.body {
		font-size: 13px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.right {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		font-size: 12px;
		color: var(--text-2);
	}
	.new-dot {
		width: 8px;
		height: 8px;
		margin: 6px 6px 0 0;
		border-radius: 50%;
		background: var(--point-mark);
	}
	.row.expanded .mid strong {
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}
	/* 펼친 개인 공지 — 아이콘 옆 글줄에 맞춰 */
	.full {
		margin: -4px 4px 8px 62px;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--field);
		font-size: 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		animation: in 0.25s var(--ease-out) both;
	}
	.badge {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 10px;
		background: var(--point-mark);
		color: #fff;
		font-size: 11px;
		font-weight: 650;
		line-height: 20px;
		text-align: center;
	}
	.none {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 4px;
		color: var(--text-2);
	}
	.none svg {
		width: 26px;
		height: 26px;
	}
	.none p {
		margin: 0;
		font-size: 14px;
	}
	.skel {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 4px;
	}
	.skel i {
		width: 46px;
		height: 46px;
		border-radius: 50%;
	}
	.skel span {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* 모양만 — 색 · 숨 쉬기는 app.css .skeleton (G4) */
	.skel b,
	.skel em {
		height: 10px;
		width: 60%;
		border-radius: 5px;
	}
	.skel em {
		width: 35%;
	}
</style>
