<script lang="ts">
	import { can } from '$lib/adminRoles';
	import { page } from '$app/state';
	import { fmtClock, type LiveUser } from '$lib/adminTypes';
	import { ROLE_LABEL } from '$lib/adminRoles';
	import { agoText } from '$lib/time';
	import Sid from '$lib/admin/Sid.svelte';
	import { isRestricted } from '$lib/restriction';
	import { whileVisible } from '$lib/visible';

	let { data } = $props();
	const admin = $derived(can(data.staff, 'identity')); // 학생 신원 권한 (Phase 51 표)

	const REFRESH_MS = 20_000;
	let fresh = $state<LiveUser[] | null>(null);
	let now = $state(Date.now());
	let failed = $state(false);
	const users = $derived(fresh ?? data.users);

	// 탭이 보이는 동안만 20초마다 상태를 다시 받는다
	$effect(() => {
		async function tick() {
			try {
				const res = await fetch('/admin/live/status', { cache: 'no-store' });
				if (res.redirected) return void (location.href = '/admin/login');
				if (!res.ok) throw new Error(String(res.status));
				fresh = await res.json();
				failed = false;
			} catch {
				failed = true;
			}
			now = Date.now();
		}
		return whileVisible(() => void tick(), REFRESH_MS);
	});

	// "대화 중" = 둘 다 그 대화 화면을 보고 있을 때만 (Phase 35). 대화방은 열려 있지만 둘 다 보고 있지 않으면 "대화방 있음"
	type St = 'chat' | 'room' | 'seeking' | 'online' | 'offline';
	const RANK: Record<St, number> = { chat: 0, room: 1, seeking: 2, online: 3, offline: 4 };
	const LABEL: Record<St, string> = { chat: '대화 중', room: '대화방 있음', seeking: '매칭 대기', online: '접속 중', offline: '오프라인' };
	const stOf = (u: LiveUser): St =>
		(u.talking ?? 0) > 0 ? 'chat' : u.room_count > 0 ? 'room' : u.seeking ? 'seeking' : u.online ? 'online' : 'offline';
	const restricted = (u: LiveUser) => isRestricted(u, now);

	type Tab = St | 'all' | 'restricted';
	const TAB_KEYS: Tab[] = ['all', 'chat', 'room', 'seeking', 'online', 'offline', 'restricted'];
	const fromUrl = page.url.searchParams.get('tab') as Tab | null;
	// 탭 링크는 ?tab= 주소라, 화면이 준비되기 전에 눌러도 그 탭으로 열린다
	let tab = $state<Tab>(fromUrl && TAB_KEYS.includes(fromUrl) ? fromUrl : 'all');
	let q = $state('');

	// 켜져 있는 사람의 last_seen 은 30초마다 앞으로 밀리므로, 그걸로 정렬하면 갱신 때마다 줄이 뒤섞인다.
	// 상태 → 앱 켜짐 먼저 → (오프라인만) 마지막 접속 → 이름 순으로 고정한다.
	const seen = (u: LiveUser) => Date.parse(u.last_seen ?? '1970-01-01');
	const rows = $derived(
		users
			.map((u) => ({ u, st: stOf(u), label: data.students[u.id] ?? '' }))
			.sort(
				(a, b) =>
					RANK[a.st] - RANK[b.st] ||
					Number(b.u.online) - Number(a.u.online) ||
					(a.st === 'offline' ? seen(b.u) - seen(a.u) : 0) ||
					(a.u.nickname ?? '').localeCompare(b.u.nickname ?? '', 'ko') ||
					a.u.id.localeCompare(b.u.id)
			)
	);
	const count = $derived({
		all: rows.length,
		chat: rows.filter((r) => r.st === 'chat').length,
		room: rows.filter((r) => r.st === 'room').length,
		seeking: rows.filter((r) => r.st === 'seeking').length,
		online: rows.filter((r) => r.st === 'online').length,
		offline: rows.filter((r) => r.st === 'offline').length,
		restricted: rows.filter((r) => restricted(r.u)).length
	});
	const shown = $derived.by(() => {
		const k = q.trim().toLowerCase();
		return rows.filter(
			(r) =>
				(tab === 'all' || (tab === 'restricted' ? restricted(r.u) : r.st === tab)) &&
				(!k ||
					(r.u.nickname ?? '').toLowerCase().includes(k) ||
					r.label.includes(k) ||
					r.u.id.startsWith(k))
		);
	});

	const TABS: { v: Tab; label: string }[] = [
		{ v: 'all', label: '전체' },
		{ v: 'chat', label: '대화 중' },
		{ v: 'room', label: '대화방 있음' },
		{ v: 'seeking', label: '매칭 대기' },
		{ v: 'online', label: '접속 중' },
		{ v: 'offline', label: '오프라인' },
		{ v: 'restricted', label: '이용 제한' }
	];

	const since = (iso: string | null) => (iso ? agoText(iso, now) : '—');
	const clock = $derived(fmtClock(now));
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">실시간 현황</h1>
		<p class="a-sub">
			전체 사용자와 지금 상태 · 20초마다 자동 갱신 ({clock})
			{#if failed}<span class="danger"> · 갱신 실패, 다시 시도 중</span>{/if}
		</p>
	</div>
	<input
		class="field search"
		bind:value={q}
		placeholder={admin ? '익명 이름, 학번, 이름' : '익명 이름, ID 앞자리'}
		autocomplete="off"
	/>
</header>

<nav class="a-tabs">
	{#each TABS as t (t.v)}
		<a
			href="?tab={t.v}"
			class:on={tab === t.v}
			onclick={(e) => {
				e.preventDefault();
				tab = t.v;
			}}>{t.label} <span class="n">{count[t.v]}</span></a
		>
	{/each}
</nav>

{#if shown.length === 0}
	<p class="a-empty">{q ? '검색 결과 없음' : '해당하는 사용자 없음'}</p>
{:else}
	<table class="a-table">
		<thead>
			<tr>
				<th>상태</th>
				<th>익명 이름</th>
				<th>대화</th>
				<th>마지막 접속</th>
			</tr>
		</thead>
		<tbody>
			{#each shown as { u, st } (u.id)}
				<tr>
					<td class="st-cell">
						<span class="dot" class:off={!u.online} title={u.online ? '앱 켜짐' : '앱 꺼짐'}></span>
						<span class="s s-{st}">{LABEL[st]}</span>
					</td>
					<td>
						<a href="/admin/users/{u.id}"><b>{u.nickname ?? '(이름 없음)'}</b></a><Sid label={data.students[u.id]} />
						{#if u.staff_role}<span class="pill acc">{ROLE_LABEL[u.staff_role]}</span>{/if}
						{#if u.status === 'banned'}<span class="pill red">영구정지</span>
						{:else if restricted(u)}<span class="pill red">정지</span>{/if}
						{#if !u.onboarded}<span class="pill">가입 중</span>{/if}
					</td>
					<td>
						{#if u.room_count === 0}<span class="muted">—</span>
						{:else if admin && u.rooms}
							{#each u.rooms as id, i (id)}
								{#if i > 0}<span class="muted"> · </span>{/if}<a href="/admin/rooms/{id}">열기{u.rooms.length > 1 ? ` ${i + 1}` : ''} →</a>
							{/each}
						{:else}{u.room_count}개{/if}
					</td>
					<td class="num muted">{u.online ? '지금' : since(u.last_seen)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="a-hint">
		접속 중 = 앱이 화면에 켜져 있음(약 1분 안에 신호). 대화 중 = 두 사람이 모두 그 대화 화면을 보고 있음.
		대화방 있음 = 대화방은 열려 있지만 둘 다 보고 있지는 않음(시간이 멈춰 있음). 점은 지금 앱을 보고 있는지를 뜻합니다.
		{#if !admin}어느 대화인지는 관리자만 볼 수 있습니다.{/if}
	</p>
{/if}

<style>
	.search {
		width: min(100%, 300px);
	}
	.n {
		margin-left: 2px;
		font-size: 12px;
		color: var(--text-2);
		font-weight: 600;
	}
	.st-cell {
		white-space: nowrap;
	}
	.dot.off {
		background: var(--line);
	}
	.s {
		font-weight: 600;
		font-size: 13px;
	}
	.s-chat {
		color: var(--accent);
	}
	.s-room {
		color: #7c3aed;
	}
	.s-seeking {
		color: #d97706;
	}
	.s-online {
		color: #16a34a;
	}
	.s-offline {
		color: var(--text-2);
		font-weight: 500;
	}
</style>
