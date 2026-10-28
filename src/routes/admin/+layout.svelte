<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import '$lib/admin/admin.css';
	import ConfirmDialog from '$lib/admin/ConfirmDialog.svelte';
	import TeamPanel from '$lib/admin/TeamPanel.svelte';
	import { ROLE_COLOR, ROLE_LABEL, canSee } from '$lib/adminRoles';

	let { data, children } = $props();

	// 운영자 화면은 데스크톱 폭을 쓴다 (학생 앱은 520px 캔버스)
	$effect(() => {
		document.body.classList.add('admin');
		return () => document.body.classList.remove('admin');
	});

	// 예전 서비스워커(v6 까지)는 운영자 데이터까지 캐시해서 옛 화면을 계속 돌려줬다.
	// 새 워커를 바로 받아오게 하고, 그 사이에 쓰일 수 있는 캐시된 운영자 응답은 지금 지운다.
	$effect(() => {
		void (async () => {
			try {
				await (await navigator.serviceWorker?.getRegistration())?.update();
			} catch {
				/* 오프라인 등 — 다음에 다시 */
			}
			try {
				for (const name of await caches.keys()) {
					const c = await caches.open(name);
					for (const req of await c.keys())
						if (new URL(req.url).pathname.startsWith('/admin')) await c.delete(req);
				}
			} catch {
				/* caches 를 못 쓰는 환경 */
			}
		})();
	});

	// 메뉴 (Phase 48 — 하는 일별로 묶은 왼쪽 사이드바. 좁은 화면은 위쪽 한 줄로 밀기)
	// 역할(Phase 49)마다 볼 수 있는 메뉴만 — 권한표는 lib/adminRoles.ts
	const GROUPS: { title: string; items: { href: string; label: string; ic: string }[] }[] = [
		{ title: '지켜보기', items: [{ href: '/admin/live', label: '실시간', ic: 'M3 12h4l3-8 4 16 3-8h4' }] },
		{
			title: '신고 처리',
			items: [
				{ href: '/admin', label: '채팅 신고', ic: 'M4 5h16v11H9l-5 4V5z' },
				{ href: '/admin/letters', label: '편지 신고', ic: 'M3 6h18v12H3zM3 7l9 6 9-6' }
			]
		},
		{
			title: '사람 · 대화',
			items: [
				{ href: '/admin/users', label: '사용자', ic: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4.5-6 8-6s7 2 8 6' },
				{ href: '/admin/badges', label: '뱃지', ic: 'M12 15a6 6 0 100-12 6 6 0 000 12zM8.5 13.9L7 21l5-2.6 5 2.6-1.5-7.1' },
				{ href: '/admin/badge-requests', label: '뱃지 요청', ic: 'M4 8.5A1.5 1.5 0 015.5 7h2.2l1.3-2h6l1.3 2h2.2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5zM12 15.9a3.4 3.4 0 100-6.8 3.4 3.4 0 000 6.8z' },
				{ href: '/admin/rooms', label: '전체 대화', ic: 'M3 5h12v9H7l-4 3V5zM9 17h8l4 3V9h-3' }
			]
		},
		{
			title: '소통',
			items: [
				{ href: '/admin/notices', label: '공지사항', ic: 'M4 10v4h4l6 5V5L8 10H4zM18 9a4 4 0 010 6' },
				{ href: '/admin/inquiries', label: '문의', ic: 'M12 21a9 9 0 10-8-5l-1 5 5-1a9 9 0 004 1zM9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1-1.5 2M12 16.5v.01' }
			]
		},
		{
			title: '운영',
			items: [
				{ href: '/admin/settings', label: '운영 설정', ic: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1.5V4h-4v2.5L9 8 7 7l-2 4 2 1v0l-2 1 2 4 2-1 2 1.5V20h4v-2.5l2-1.5 2 1 2-4-2-1z' },
				{ href: '/admin/audit', label: '활동 기록', ic: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
			]
		}
	];
	// 운영진 관리 (Phase 50) — 최고 관리자에게만
	const STAFF_ITEM = { href: '/admin/staff', label: '운영진 관리', ic: 'M16 11a3 3 0 100-6 3 3 0 000 6zM8 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M15 14.6c2.8-.4 5.4 1.3 6 4.9' };
	const NAV = $derived(
		GROUPS.map((g) => ({
			...g,
			items: [...g.items.filter((n) => canSee(data.staff, n.href)), ...(g.title === '운영' && data.staff?.owner ? [STAFF_ITEM] : [])]
		})).filter((g) => g.items.length)
	);
	const active = (href: string) =>
		href === '/admin'
			? page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/reports')
			: page.url.pathname.startsWith(href);

	// 고친 칸 표시 (Phase 48) — 폼 안의 값을 바꾸면 그 줄(label · .row)에 표시, 폼에는 data-dirty(저장 단추가 눈에 띄게).
	// 저장이 성공하면 lib/admin/confirm.ts(ack)가 지운다
	$effect(() => {
		const on = (e: Event) => {
			const t = e.target as HTMLElement | null;
			const form = t?.closest?.('main form');
			if (!form || t?.getAttribute('type') === 'hidden') return;
			(form as HTMLElement).dataset.dirty = '1';
			(t!.closest('label, .row') as HTMLElement | null)?.setAttribute('data-changed', '');
		};
		document.addEventListener('input', on);
		document.addEventListener('change', on);
		return () => {
			document.removeEventListener('input', on);
			document.removeEventListener('change', on);
		};
	});

	async function logout() {
		const res = await fetch('/admin/session', { method: 'DELETE' });
		if (!res.ok) { window.alert('로그아웃하지 못했어요. 다시 시도해 주세요'); return; }
		void goto('/admin/login', { replaceState: true });
	}
</script>

<svelte:head>
	<title>Landy 운영</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="shell" class:solo={!data.staff}>
	{#if data.staff}
		<aside class="side">
			<a class="brand" href="/admin"><b class="wordmark">Landy</b> <span>운영</span></a>
			<nav aria-label="운영 메뉴">
				{#each NAV as g (g.title)}
					<p class="group">{g.title}</p>
					{#each g.items as n (n.href)}
						<a href={n.href} class:on={active(n.href)} aria-current={active(n.href) ? 'page' : undefined}>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d={n.ic} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
							{n.label}
						</a>
					{/each}
				{/each}
			</nav>
			<div class="me">
				<span class="who"><i class="role" style:background={data.staff.owner ? '#f59e0b' : ROLE_COLOR[data.staff.role]}></i>{data.staff.owner ? '최고 관리자' : ROLE_LABEL[data.staff.role]}</span>
				<button class="out" onclick={logout}>로그아웃</button>
			</div>
		</aside>
	{/if}

	<main class="wrap">
		{#if data.staff && data.maintenance}
			<!-- 서버 점검 중 (Phase 52) — 켜 둔 채 잊지 않게 모든 운영 화면 위에 -->
			<a class="maint-bar" href="/admin/settings">🔧 서버 점검 중 — 학생 앱이 닫혀 있어요 <span>운영 설정에서 끄기 ›</span></a>
		{:else if data.staff && data.maintenanceAt}
			<!-- 점검 예약 (Phase 53) -->
			<a class="maint-bar soon" href="/admin/settings"
				>⏰ 서버 점검 예약 — {new Date(data.maintenanceAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })}부터 <span>운영 설정에서 바꾸기 ›</span></a
			>
		{/if}
		{@render children()}
	</main>

	{#if data.staff && data.team}
		<TeamPanel team={data.team} />
	{/if}
</div>

<ConfirmDialog />

<style>
	/* Phase 48 — 넓은 화면: 왼쪽 사이드바(하는 일별 묶음) + 오른쪽 본문. 좁은 화면(≤900): 위쪽 머리글 + 옆으로 미는 메뉴 한 줄 */
	:global(body.admin #app) {
		max-width: 1560px;
	}
	/* 왼쪽 메뉴 · 본문 · 오른쪽 운영진 현황(Phase 49, 넓은 화면만) */
	.shell {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 250px;
		min-height: 100dvh;
	}
	@media (max-width: 1180px) {
		.shell {
			grid-template-columns: 220px minmax(0, 1fr);
		}
		.shell > :global(.team) {
			display: none;
		}
	}
	.shell.solo {
		grid-template-columns: minmax(0, 1fr);
	}
	.side {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		height: 100dvh;
		padding: 20px 12px 16px;
		border-right: 1px solid var(--line);
		background: color-mix(in srgb, var(--field) 45%, var(--bg));
	}
	/* 로고(브랜드 글씨) + "운영" — 학생 앱과 같은 로고 (Phase 58) */
	.brand {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 0 10px 14px;
		white-space: nowrap;
		color: var(--text);
		font-weight: 650;
		font-size: 17px;
		letter-spacing: -0.03em;
		text-decoration: none;
	}
	.brand .wordmark {
		font-size: 24px;
		line-height: 1;
	}
	.brand span {
		color: var(--accent);
		font-weight: 600;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
		scrollbar-width: none;
	}
	nav::-webkit-scrollbar {
		display: none;
	}
	.group {
		margin: 14px 10px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.group:first-child {
		margin-top: 0;
	}
	nav a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border-radius: 10px;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}
	nav a:hover {
		background: var(--field);
		color: var(--text);
	}
	nav a.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08), inset 3px 0 0 var(--accent);
	}
	nav svg {
		flex: none;
		width: 18px;
		height: 18px;
	}
	nav a.on svg {
		color: var(--accent);
	}
	.me {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: auto;
		padding: 12px 10px 0;
		border-top: 1px solid var(--line);
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.role {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #22c55e;
	}
	.out {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.out:hover {
		color: var(--danger);
	}
	.maint-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		margin: -8px 0 18px;
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, #f59e0b 16%, var(--bg));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59e0b 45%, transparent);
		color: #92400e;
		font-size: 14px;
		font-weight: 650;
		text-decoration: none;
	}
	.maint-bar span {
		font-weight: 600;
	}
	.maint-bar.soon {
		background: color-mix(in srgb, #2563eb 10%, var(--bg));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #2563eb 35%, transparent);
		color: #1d4ed8;
	}
	.wrap {
		min-width: 0;
		padding: 28px 32px 48px;
	}
	/* 좁은 화면: 머리글(이름 · 로그아웃) + 메뉴 한 줄(옆으로 밀기), 묶음 제목은 숨긴다 */
	@media (max-width: 900px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			z-index: 10;
			display: grid;
			grid-template-columns: 1fr auto;
			align-items: center;
			height: auto;
			padding: 10px 16px 6px;
			border-right: 0;
			border-bottom: 1px solid var(--line);
			background: var(--bg);
		}
		.brand {
			padding: 0;
		}
		nav {
			grid-column: 1 / -1;
			grid-row: 2;
			flex-direction: row;
			margin: 8px -16px 0;
			padding: 0 12px;
			overflow-x: auto;
		}
		.group {
			display: none;
		}
		nav a {
			flex: none;
			padding: 7px 10px;
		}
		nav a.on {
			box-shadow: inset 0 -2px 0 var(--accent);
			border-radius: 10px 10px 0 0;
		}
		.me {
			grid-column: 2;
			grid-row: 1;
			margin: 0;
			padding: 0;
			border: 0;
			gap: 14px;
		}
		.wrap {
			padding: 20px 24px 40px;
		}
	}
	@media (max-width: 640px) {
		.wrap {
			padding: var(--pad);
		}
	}
</style>
