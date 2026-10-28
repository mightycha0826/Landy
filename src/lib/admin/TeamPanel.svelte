<script lang="ts">
	/**
	 * 운영진 현황 (Phase 49) — 디스코드 멤버 목록처럼 오른쪽에. 역할별로 묶고, 접속 상태 점 · 이름(역할 색) · 하는 일.
	 *   접속 중  마지막 요청 2분 안 (초록) — "채팅 신고 보는 중"
	 *   자리 비움 10분 안 (노랑)
	 *   오프라인  그 밖 (회색) — "3시간 전"
	 * 목록은 페이지를 옮길 때마다(hooks 의 역할 확인과 같은 요청) 새로 오고, 가만히 있으면 1분마다(탭이 보일 때만) /admin/team.
	 */
	import { ROLE_COLOR, ROLE_LABEL, activityOf, type StaffRole, type TeamMember } from '$lib/adminRoles';
	import { agoText } from '$lib/time';

	let { team }: { team: TeamMember[] } = $props();

	let fresh = $state<TeamMember[] | null>(null);
	let panel: HTMLElement | undefined = $state();
	let now = $state(Date.now());
	// 페이지를 옮겨 새 목록이 오면 그걸 쓴다
	$effect(() => {
		void team;
		fresh = null;
	});
	const list = $derived(fresh ?? team);

	$effect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const pull = async () => {
			now = Date.now();
			if (document.visibilityState !== 'visible') return;
			// 좁은 화면(판이 숨겨짐)에선 부르지 않는다 (Phase 54 — 안 보이는 판 때문에 1분마다 DB 요청이 나가던 것)
			if (!panel || panel.offsetParent === null) return;
			try {
				const r = await fetch('/admin/team', { headers: { accept: 'application/json' } });
				if (r.ok) fresh = (await r.json()).team;
			} catch {
				/* 오프라인 — 다음에 */
			}
		};
		const onVis = () => document.visibilityState === 'visible' && void pull();
		timer = setInterval(pull, 60_000);
		document.addEventListener('visibilitychange', onVis);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	type State = 'on' | 'idle' | 'off';
	const stateOf = (m: TeamMember): State => {
		if (m.me) return 'on';
		const age = m.last_seen ? now - new Date(m.last_seen).getTime() : Infinity;
		return age < 120_000 ? 'on' : age < 600_000 ? 'idle' : 'off';
	};
	const ORDER: StaffRole[] = ['admin', 'developer', 'moderator', 'beta'];
	const groups = $derived(
		ORDER.map((role) => ({
			role,
			members: list
				.filter((m) => m.role === role)
				.sort((a, b) => ['on', 'idle', 'off'].indexOf(stateOf(a)) - ['on', 'idle', 'off'].indexOf(stateOf(b)))
		})).filter((g) => g.members.length)
	);
	const online = $derived(list.filter((m) => stateOf(m) !== 'off').length);
</script>

<aside class="team" aria-label="운영진 현황" bind:this={panel}>
	<p class="head">운영진 <b class="num">{online}</b><span>/ {list.length} 접속</span></p>
	{#each groups as g (g.role)}
		<p class="group">{ROLE_LABEL[g.role]} — {g.members.length}</p>
		<ul>
			{#each g.members as m (m.id)}
				{@const st = stateOf(m)}
				<li class={st}>
					<span class="av" style:--c={ROLE_COLOR[m.role]} aria-hidden="true">
						{[...m.name][0]}
						<i class="dot {st}"></i>
					</span>
					<span class="txt">
						<span class="name" style:color={st === 'off' ? undefined : ROLE_COLOR[m.role]}>
							{m.name}{#if m.owner}<small class="own" title="최고 관리자">최고</small>{/if}{#if m.me}<small class="me">나</small>{/if}
						</span>
						<span class="sub">
							{#if st === 'off'}{m.last_seen ? `${agoText(m.last_seen, now)} 접속` : '아직 접속 안 함'}
							{:else if st === 'idle'}자리 비움 · {activityOf(m.path)}
							{:else}{activityOf(m.path)}{/if}
						</span>
					</span>
					<span class="sr-only">{st === 'on' ? '접속 중' : st === 'idle' ? '자리 비움' : '오프라인'}</span>
				</li>
			{/each}
		</ul>
	{/each}
</aside>

<style>
	.team {
		position: sticky;
		top: 0;
		height: 100dvh;
		overflow-y: auto;
		padding: 20px 12px;
		border-left: 1px solid var(--line);
		background: color-mix(in srgb, var(--field) 45%, var(--bg));
		scrollbar-width: thin;
	}
	.head {
		margin: 0 8px 14px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.head b {
		margin-left: 2px;
		color: #16a34a;
	}
	.head span {
		margin-left: 3px;
		font-weight: 500;
	}
	.group {
		margin: 14px 8px 6px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 8px;
	}
	li:hover {
		background: var(--field);
	}
	li.off {
		opacity: 0.55;
	}
	.av {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--c);
		color: #fff;
		font-size: 14px;
		font-weight: 650;
	}
	.dot {
		position: absolute;
		right: -2px;
		bottom: -2px;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 3px solid color-mix(in srgb, var(--field) 45%, var(--bg));
		background: #9ca3af;
	}
	.dot.on {
		background: #22c55e;
	}
	.dot.idle {
		background: #f59e0b;
	}
	.txt {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}
	.name {
		overflow: hidden;
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.me {
		margin-left: 5px;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--field);
		color: var(--text-2);
		font-size: 10px;
		font-weight: 600;
		vertical-align: 1px;
	}
	.own {
		margin-left: 5px;
		padding: 0 5px;
		border-radius: 4px;
		background: color-mix(in srgb, #f59e0b 20%, transparent);
		color: #b45309;
		font-size: 10px;
		font-weight: 650;
		vertical-align: 1px;
	}
	.sub {
		overflow: hidden;
		font-size: 12px;
		color: var(--text-2);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
</style>
