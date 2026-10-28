<script lang="ts">
	/**
	 * 새 업적 축하 (Phase 31 · 35 다시 만듦) — 탭 첫 화면(홈 · 편지 · 프로필)에서만 띄운다 (대화 중에는 방해하지 않는다).
	 * 새로 딴 업적이 있는지는 1분마다 보내는 박동(heartbeat)의 대답이 알려 준다(Phase 55) — 있을 때만 목록을 받아 온다. 닫으면 "봤음"으로 서버에 남긴다.
	 * 움직임 (Phase 35 — 기계적이지 않게): 뒤에서 빛이 퍼지고 → 메달이 동전처럼 돌며 용수철처럼 튀어나오고(한 개씩 조금 늦게) →
	 * 색종이가 메달에서 위로 터졌다가 제각각 흔들리며 떨어진다 (조각마다 방향 · 속도 · 회전이 다르다).
	 * 동작 줄이기면 app.css 가 애니메이션을 끄고 그대로 멈춰 보인다.
	 */
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { focustrap } from '$lib/focustrap';
	import { backClose, navigateFromOverlay } from '$lib/overlay.svelte';
	import Badge from './Badge.svelte';
	import { SPECIAL_BADGES } from './badgeIcons';
	import { PIN_BADGES } from './pins';
	import { fetchNewAchievements, markAchievementsSeen, TIER_NAME, type BadgeLite } from '$lib/achievements';
	import { UI } from '$lib/state.svelte';
	import { touring } from '$lib/tour.svelte';
	import { accountIsCurrent, accountToken } from '$lib/accountScope';
	const account = accountToken();

	let { preview = null }: { preview?: BadgeLite[] | null } = $props();

	let fresh = $state<BadgeLite[]>([]);
	let leaving = $state(false);
	const onRoot = $derived(['/', '/letters', '/me'].includes(page.url.pathname));

	$effect(() => {
		if (preview) {
			fresh = preview;
			return;
		}
		// 박동이 "새 업적 있음"(UI.achNew)이라고 할 때만 받아 온다 (Phase 55 — 예전엔 10분마다 따로 물었다).
		// fresh 를 읽고 쓰는 일은 추적하지 않는다 — 추적하면 빈 목록을 넣을 때마다 이 effect 가 다시 돌아 요청이 끝없이 나간다
		if (!UI.achNew) return;
		untrack(() => {
			UI.achNew = false;
			if (fresh.length) return; // 이미 떠 있으면 그대로
			void fetchNewAchievements().then((got) => {
				if (!accountIsCurrent(account) || !got.length) return;
				fresh = got;
				UI.celebrating = true; // 안내 뒤에서 기다리는 동안에도 — 다른 저절로 뜨는 창(매너 평가 · 알림 권한)은 그 뒤에
			}).catch(() => {});
		});
	});

	async function close(view = false) {
		if (leaving) return;
		leaving = true;
		await new Promise((r) => setTimeout(r, 240));
		if (!accountIsCurrent(account)) return;
		// 보러 가기 — 이 창의 뒤로가기 칸을 업적 화면으로 바꿔 끼운다 (창을 닫으며 이동, lib/overlay.svelte.ts)
		if (view) void navigateFromOverlay('/me/achievements');
		fresh = [];
		UI.celebrating = leaving = false;
		if (!preview) await markAchievementsSeen().catch(() => {});
	}
	// 사용법 안내(튜토리얼)가 뜰 차례거나 떠 있으면 그 뒤에 (Phase 44 · 89)
	const showing = $derived(!!fresh.length && (onRoot || !!preview) && !touring());
	// 안드로이드 뒤로가기로 닫힌다 — 저절로 뜨는 창이라 누른 적이 있는 화면에서만 기록을 쌓는다
	backClose(() => void close(), { auto: true, open: () => showing });
	const top = $derived(fresh.slice(0, 6));
	const one = $derived(fresh.length === 1);

	// 색종이 — 조각마다 제각각 (터지는 방향 · 높이 · 떨어지는 곳 · 회전 · 시간)
	const COLORS = ['var(--g-orange)', 'var(--g-pink)', '#f2c14e', '#7059f5', '#14a37f', '#3b8af6', 'var(--g-coral)'];
	const rnd = (a: number, b: number) => a + Math.random() * (b - a);
	const bits = Array.from({ length: 34 }, (_, i) => {
		const ang = rnd(-150, -30) * (Math.PI / 180);
		const pow = rnd(90, 210);
		return {
			c: COLORS[i % COLORS.length],
			bx: Math.cos(ang) * pow,
			by: Math.sin(ang) * pow,
			fx: Math.cos(ang) * pow * rnd(1.2, 1.8) + rnd(-30, 30),
			fy: rnd(160, 320),
			r: rnd(-720, 720),
			rx: rnd(0, 720),
			w: rnd(5, 9),
			h: rnd(8, 14),
			d: rnd(1.6, 2.6),
			t: rnd(0, 0.25),
			round: i % 5 === 0
		};
	});

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Escape') void close();
	}
</script>

<svelte:window onkeydown={fresh.length ? onkey : undefined} />

{#if showing}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="scrim" class:leaving role="presentation" onclick={() => close()}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="party" role="dialog" aria-modal="true" aria-label="새 업적" tabindex="-1" onclick={(e) => e.stopPropagation()} use:focustrap>
			<div class="stage" aria-hidden="true">
				<i class="glow"></i>
				<i class="rays"></i>
				<div class="confetti">
					{#each bits as b, i (i)}
						<i
							class:round={b.round}
							style:--c={b.c}
							style:--bx="{b.bx}px"
							style:--by="{b.by}px"
							style:--fx="{b.fx}px"
							style:--fy="{b.fy}px"
							style:--r="{b.r}deg"
							style:--rx="{b.rx}deg"
							style:--w="{b.w}px"
							style:--h="{b.h}px"
							style:--dur="{b.d}s"
							style:--t="{0.35 + b.t}s"
						></i>
					{/each}
				</div>
			</div>
			<div class="medals" class:one>
				{#each top as b, i (b.code)}
					<div class="m">
						<Badge code={b.code} icon={b.icon} tier={b.tier} title={b.title} size={one ? 116 : 68} label shine enter delay={120 + i * 110} />
						{#if !one}<span style:--i={i}>{b.title}</span>{/if}
					</div>
				{/each}
			</div>
			<p class="kicker">새 업적</p>
			<h2>{one ? (PIN_BADGES[fresh[0].code] ? (fresh[0].title.endsWith('뱃지') ? `${fresh[0].title}!` : `CNSA 뱃지 ${fresh[0].title}!`) : SPECIAL_BADGES.has(fresh[0].code) ? `특별 업적 ${fresh[0].title}!` : `${fresh[0].title} ${TIER_NAME[fresh[0].tier]} 등급!`) : `업적 ${fresh.length}개를 모았어요!`}</h2>
			{#if fresh.length > top.length}<p class="more muted">외 {fresh.length - top.length}개</p>{/if}
			<div class="acts">
				<button class="btn" onclick={() => close(true)}>업적 보러 가기</button>
				<button class="later u-tap" onclick={() => close()}>닫기</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 55;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(14 6 9 / 0.55);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		animation: fade 0.35s ease-out;
		transition: opacity 0.24s ease-in;
	}
	.scrim.leaving {
		opacity: 0;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.party {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		width: 100%;
		max-width: 360px;
		padding: 26px 20px 16px;
		border-radius: 32px;
		background: var(--surface);
		box-shadow: var(--shadow-2);
		text-align: center;
		outline: none;
		animation: rise 0.6s cubic-bezier(0.2, 0.9, 0.25, 1.08) both;
		transition: transform 0.24s ease-in;
	}
	.leaving .party {
		transform: scale(0.95) translateY(10px);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(40px) scale(0.92);
		}
	}
	/* 메달 뒤 — 빛 번짐 · 천천히 도는 빛살 */
	.stage {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 190px;
		pointer-events: none;
	}
	.glow {
		position: absolute;
		left: 50%;
		top: 100px;
		width: 240px;
		height: 240px;
		margin: -120px 0 0 -120px;
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, #f2c14e 55%, transparent), color-mix(in srgb, var(--g-pink) 22%, transparent) 45%, transparent 70%);
		animation: bloom 1.2s 0.1s cubic-bezier(0.2, 0.8, 0.3, 1) both;
	}
	@keyframes bloom {
		from {
			transform: scale(0.2);
			opacity: 0;
		}
	}
	.rays {
		position: absolute;
		left: 50%;
		top: 100px;
		width: 300px;
		height: 300px;
		margin: -150px 0 0 -150px;
		border-radius: 50%;
		background: repeating-conic-gradient(from 0deg, rgb(255 214 120 / 0.28) 0 7deg, transparent 7deg 22deg);
		-webkit-mask: radial-gradient(circle, #000 20%, transparent 68%);
		mask: radial-gradient(circle, #000 20%, transparent 68%);
		animation:
			bloom 1.2s 0.2s cubic-bezier(0.2, 0.8, 0.3, 1) both,
			turn 18s linear infinite;
	}
	@keyframes turn {
		to {
			rotate: 360deg;
		}
	}
	/* 색종이 — 메달에서 위로 터졌다가(감속) 흔들리며 떨어진다(가속) */
	.confetti {
		position: absolute;
		left: 50%;
		top: 100px;
	}
	.confetti i {
		position: absolute;
		width: var(--w);
		height: var(--h);
		margin: calc(var(--h) / -2) 0 0 calc(var(--w) / -2);
		border-radius: 2px;
		background: var(--c);
		opacity: 0;
		animation: burst var(--dur) var(--t) both;
	}
	.confetti i.round {
		border-radius: 50%;
		height: var(--w);
	}
	@keyframes burst {
		0% {
			opacity: 1;
			transform: translate(0, 0) rotate(0) rotateX(0) scale(0.4);
			animation-timing-function: cubic-bezier(0.1, 0.8, 0.3, 1);
		}
		28% {
			opacity: 1;
			transform: translate(var(--bx), var(--by)) rotate(calc(var(--r) * 0.3)) rotateX(calc(var(--rx) * 0.3)) scale(1);
			animation-timing-function: cubic-bezier(0.5, 0, 0.8, 0.6);
		}
		85% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(var(--fx), var(--fy)) rotate(var(--r)) rotateX(var(--rx)) scale(0.9);
		}
	}
	.medals {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 14px 10px;
		min-height: 150px;
		margin-bottom: 4px;
	}
	.medals.one {
		min-height: 160px;
	}
	.m {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 84px;
		font-size: 12px;
		font-weight: 600;
	}
	.medals.one .m {
		width: auto;
	}
	.m span {
		animation: up 0.45s calc(0.6s + var(--i, 0) * 0.11s) ease-out both;
	}
	.kicker {
		margin: 0;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.1em;
		background: var(--brand);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: up 0.5s 0.55s ease-out both;
	}
	h2 {
		margin: 0 0 4px;
		font-family: var(--display);
		font-size: 23px;
		font-weight: 650;
		letter-spacing: -0.01em;
		animation: up 0.5s 0.65s ease-out both;
	}
	@keyframes up {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	.more {
		margin: 0;
		font-size: 12px;
	}
	.acts {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		width: 100%;
		margin-top: 8px;
		animation: up 0.5s 0.8s ease-out both;
	}
	.later {
		height: 44px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>
