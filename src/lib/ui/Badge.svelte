<script lang="ts">
	/**
	 * 업적 메달 (Phase 31 · 35 다시 그림) — 동 · 은 · 금 금속 테두리(톱니 결) + 가운데 면에 새긴 선 그림(badgeIcons, 이모지 대신).
	 * 잠긴 업적(tier 0)은 흑백. shine 이면 빛이 한 번 부드럽게 스친다. enter 면 동전이 돌며 튀어나온다 (축하 화면).
	 * 동작 줄이기면 app.css 가 애니메이션을 끈다.
	 * CNSA 뱃지 (Phase 70, pins/) — 동그란 메달 대신 실제 에나멜 핀 모양 그대로. 잠겼으면 흑백 · 흐리게.
	 * Phase 84 — Landy 뱃지도 동그란 메달 대신 아이콘 모양 그대로 오려 낸 입체 핀 (CNSA 핀과 어울리게):
	 *   금속 판(아이콘 선을 굵게 따라 오린 누끼, 등급 색 동 · 은 · 금 · 특별은 무지갯빛) → 아래로 비치는 두께(옆면) →
	 *   닫힌 모양 안은 뱃지마다 다른 색 에나멜(ENAMEL) → 아이콘 선은 도드라진 금속 선 → 에나멜 윗면의 광택.
	 *   잠긴 것은 회색 판. shine 이면 빛이 핀 모양 안에서만 한 번 스친다(mask). 이모지만 있는 옛 코드는 예전 동전 그대로.
	 */
	import { TIER_NAME, type Tier } from '$lib/achievements';
	import { BADGE_ICONS, ENAMEL, FALLBACK_ICON, SPECIAL_BADGES } from './badgeIcons';
	import { PIN_BADGES } from './pins';

	let {
		code = '',
		icon = '',
		tier,
		title = '',
		size = 56,
		shine = false,
		label = false,
		enter = false,
		delay = 0
	}: {
		code?: string;
		/** 예전 이모지 — 그림이 없는 코드일 때만 */
		icon?: string;
		tier: Tier;
		title?: string;
		size?: number;
		shine?: boolean;
		label?: boolean;
		/** 축하 화면 — 돌며 튀어나온다 */
		enter?: boolean;
		/** enter · shine 시작을 늦춘다 (ms) */
		delay?: number;
	} = $props();

	const path = $derived(BADGE_ICONS[code] ?? (icon ? null : FALLBACK_ICON));
	// 운영진이 주는 특별 업적 (Phase 44) — 동 · 은 · 금이 아니라 "특별" (가진 사람만 무지갯빛)
	const special = $derived(SPECIAL_BADGES.has(code));
	const Pin = $derived(PIN_BADGES[code] as (typeof PIN_BADGES)[string] | undefined);
	const tierName = $derived(Pin && tier > 0 ? 'CNSA' : special && tier > 0 ? '특별' : TIER_NAME[tier]);
	const enamel = $derived(ENAMEL[code] ?? '#b96cf5');
	const uid = $props.id();
</script>

<span class="medal t{tier}" class:sp={special && tier > 0} class:pin={!!Pin} class:shine class:enter style:--s="{size}px" style:--d="{delay}ms" role="img" aria-label="{title} {tierName}">
	{#if Pin}
		<span class="coin art" aria-hidden="true"><Pin shine={shine && tier > 0} {delay} /></span>
	{:else if path}
		<!-- 아이콘 모양 핀 (Phase 84) — 좌표는 아이콘 칸(24) 그대로, 굵은 테두리가 들어가게 둘레를 넉넉히 -->
		<span class="coin die" aria-hidden="true" style:--enamel={enamel}>
			<svg viewBox="-3.3 -3 30.6 30.6">
				<defs>
					<linearGradient id="{uid}-metal" x1="0" y1="0" x2="0.35" y2="1">
						<stop offset="0" style:stop-color="var(--m1)" />
						<stop offset="0.5" style:stop-color="var(--m2)" />
						<stop offset="1" style:stop-color="var(--m3)" />
					</linearGradient>
					<linearGradient id="{uid}-wire" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" style:stop-color="var(--w1)" />
						<stop offset="1" style:stop-color="var(--m2)" />
					</linearGradient>
					<linearGradient id="{uid}-gloss" x1="0" y1="0" x2="0.2" y2="1">
						<stop offset="0" stop-color="#fff" stop-opacity="0.55" />
						<stop offset="0.42" stop-color="#fff" stop-opacity="0.12" />
						<stop offset="0.5" stop-color="#fff" stop-opacity="0" />
					</linearGradient>
					<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stop-color="#fff" stop-opacity="0" />
						<stop offset="0.5" stop-color="#fff" stop-opacity="0.85" />
						<stop offset="1" stop-color="#fff" stop-opacity="0" />
					</linearGradient>
					<mask id="{uid}-cut" maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36">
						<path d={path} fill="#fff" stroke="#fff" class="cut" />
					</mask>
				</defs>
				<!-- 두께 — 판 아래로 비치는 옆면 -->
				<path d={path} class="side" />
				<!-- 금속 판 (아이콘을 따라 오린 누끼) -->
				<path d={path} class="plate" fill="url(#{uid}-metal)" stroke="url(#{uid}-metal)" />
				<!-- 에나멜 (닫힌 모양 안) + 윗면 광택 -->
				<path d={path} class="enamel" />
				<path d={path} class="gloss" fill="url(#{uid}-gloss)" />
				<!-- 도드라진 금속 선 — 아래로 살짝 그림자 -->
				<path d={path} class="wire-sh" />
				<path d={path} class="wire" stroke="url(#{uid}-wire)" />
				{#if shine && tier > 0}
					<g mask="url(#{uid}-cut)"><rect class="sweep" x="-30" y="-6" width="18" height="36" fill="url(#{uid}-sweep)" /></g>
				{/if}
			</svg>
		</span>
	{:else}
		<span class="coin" aria-hidden="true">
			<span class="rim">
				<span class="disk">
					<span class="emo">{icon}</span>
				</span>
			</span>
		</span>
	{/if}
	{#if label && tier > 0}<span class="tier" aria-hidden="true">{tierName}</span>{/if}
</span>

<style>
	.medal {
		--s: 56px;
		position: relative;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		flex: none;
		perspective: calc(var(--s) * 6);
	}
	.coin {
		position: relative;
		display: block;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		transform-style: preserve-3d;
		filter: drop-shadow(0 calc(var(--s) * 0.06) calc(var(--s) * 0.09) rgb(0 0 0 / 0.22));
	}
	/* 테두리 — 금속 + 가는 톱니 결 */
	.rim {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		padding: calc(var(--s) * 0.085);
		background:
			repeating-conic-gradient(from 0deg, rgb(255 255 255 / 0.16) 0 3deg, rgb(0 0 0 / 0.08) 3deg 6deg),
			var(--metal);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.7),
			inset 0 -1px 1px rgb(0 0 0 / 0.25);
		overflow: hidden;
	}
	.disk {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: var(--face);
		box-shadow:
			inset 0 calc(var(--s) * 0.035) calc(var(--s) * 0.05) rgb(0 0 0 / 0.22),
			inset 0 calc(var(--s) * -0.02) calc(var(--s) * 0.04) rgb(255 255 255 / 0.5),
			0 0 0 1px rgb(0 0 0 / 0.06);
	}
	.emo {
		font-size: calc(var(--s) * 0.42);
		line-height: 1;
	}
	/* ── 아이콘 모양 핀 (Phase 84) ── 판 · 에나멜 · 선 굵기는 아이콘 칸(24) 단위 */
	.die {
		border-radius: 0;
		filter: drop-shadow(0 calc(var(--s) * 0.05) calc(var(--s) * 0.06) rgb(0 0 0 / 0.28));
	}
	.die svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.die path {
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.die .cut,
	.die .plate,
	.die .side {
		stroke-width: 5.4;
	}
	.die .side {
		fill: var(--edge);
		stroke: var(--edge);
		transform: translateY(1.15px);
	}
	.die .enamel {
		fill: var(--enamel);
		stroke: none;
	}
	.die .gloss {
		stroke: none;
	}
	.die .wire,
	.die .wire-sh {
		fill: none;
		stroke-width: 1.85;
	}
	.die .wire-sh {
		stroke: rgb(0 0 0 / 0.3);
		transform: translateY(0.45px);
	}
	/* 금속 — 등급마다 (위가 밝고 아래가 어둡다) · 옆면 · 선의 빛 */
	.die.coin {
		--m1: #fff3c4;
		--m2: #e3a823;
		--m3: #a06b05;
		--edge: #7a5000;
		--w1: #fffbe6;
	}
	.t1 .die {
		--m1: #ffd9b3;
		--m2: #c27a43;
		--m3: #8a4f22;
		--edge: #5e3313;
		--w1: #ffe7cf;
	}
	.t2 .die {
		--m1: #ffffff;
		--m2: #b9c3cd;
		--m3: #7b8692;
		--edge: #56606b;
		--w1: #ffffff;
	}
	.t3 .die {
		--m1: #fff3c4;
		--m2: #e3a823;
		--m3: #a06b05;
		--edge: #7a5000;
		--w1: #fffbe6;
	}
	/* 특별 업적 — 무지갯빛 판 */
	.medal.sp .die {
		--m1: #c9b8ff;
		--m2: #7aa8ff;
		--m3: #b05ec9;
		--edge: #4b3aa8;
		--w1: #ffffff;
	}
	/* 잠긴 것 — 회색 판 · 빈 에나멜 */
	.t0 .die {
		--m1: var(--field);
		--m2: var(--field);
		--m3: var(--line);
		--edge: var(--line);
		--w1: var(--surface);
		--enamel: var(--surface) !important;
		filter: none;
		opacity: 0.7;
	}
	.t0 .die .gloss,
	.t0 .die .wire-sh {
		display: none;
	}
	/* 빛이 핀 모양 안에서 한 번 스친다 */
	.die .sweep {
		transform: translateX(0);
		animation: die-sweep 1.9s calc(var(--d) + 0.45s) cubic-bezier(0.45, 0, 0.25, 1) forwards;
	}
	@keyframes die-sweep {
		to {
			transform: translateX(64px);
		}
	}

	/* 금속 — 위에서 비치는 빛 방향으로 */
	.t1 {
		--metal: conic-gradient(from 200deg, #8a5329, #e6a877, #a4652f, #f3c89c, #8a5329);
		--face: radial-gradient(circle at 35% 28%, #f9dcbd, #d69863 55%, #9a5f30);
		--ink: #6b3a14;
		--tier: #9a5a2b; /* 등급 글씨 바탕 — 흰 글씨 4.5:1 넘게 (금속색보다 진하게) */
	}
	.t2 {
		--metal: conic-gradient(from 200deg, #7f8994, #eef2f6, #98a3ae, #ffffff, #7f8994);
		--face: radial-gradient(circle at 35% 28%, #ffffff, #d7dde4 55%, #9aa4ae);
		--ink: #4a5561;
		--tier: #66707b;
	}
	.t3 {
		--metal: conic-gradient(from 200deg, #a8740a, #ffe38a, #c8900f, #fff4c2, #a8740a);
		--face: radial-gradient(circle at 35% 28%, #fff6d0, #f5c95a 55%, #c48a0c);
		--ink: #7a5200;
		--tier: #9b6c05;
	}
	/* 특별 업적 — 무지갯빛 테두리 · 진주빛 면 (운영진이 주는 것, Phase 44). 등급과 상관없이 이 모양 */
	.medal.sp {
		--metal: conic-gradient(from 200deg, #7b5cff, #3ec7ff, #7af0c4, #ffd36e, #ff7ab8, #7b5cff);
		--face: radial-gradient(circle at 35% 28%, #ffffff, #eef0ff 50%, #c9c6f5);
		--ink: #4b3aa8;
		--tier: linear-gradient(90deg, #6a4df0, #d04fa8);
	}
	.t0 {
		--metal: linear-gradient(var(--field), var(--field));
		--face: var(--surface);
		--ink: var(--text-2);
	}
	.t0 .coin {
		filter: none;
	}
	.t0 .rim {
		background: var(--field);
		box-shadow: none;
	}
	.t0 .emo {
		filter: grayscale(1);
		opacity: 0.35;
	}

	/* CNSA 뱃지 — 핀 그림이 칸을 채운다. 잠긴 것은 흑백 · 흐리게 */
	.pin .art {
		border-radius: 0;
		filter: drop-shadow(0 calc(var(--s) * 0.05) calc(var(--s) * 0.06) rgb(0 0 0 / 0.3));
	}
	.pin {
		--tier: #b3121a;
	}
	.pin.t0 .art {
		filter: grayscale(1);
		opacity: 0.35;
	}
	/* 빛이 한 번 부드럽게 스친다 (비스듬한 넓은 빛 띠) */
	.shine .rim::after {
		content: '';
		position: absolute;
		inset: -30%;
		background: linear-gradient(115deg, transparent 35%, rgb(255 255 255 / 0.18) 44%, rgb(255 255 255 / 0.8) 50%, rgb(255 255 255 / 0.18) 56%, transparent 65%);
		transform: translateX(-130%);
		animation: sweep 1.9s calc(var(--d) + 0.45s) cubic-bezier(0.45, 0, 0.25, 1) forwards;
		pointer-events: none;
	}
	@keyframes sweep {
		to {
			transform: translateX(130%);
		}
	}

	/* 축하 — 동전이 돌면서 튀어나와 살짝 흔들리다 멈춘다 (용수철처럼) */
	.enter .coin {
		animation:
			coin-spin 1.25s var(--d) cubic-bezier(0.16, 0.84, 0.3, 1) both,
			coin-pop 0.9s var(--d) both;
		animation-timing-function: cubic-bezier(0.16, 0.84, 0.3, 1), cubic-bezier(0.34, 1.56, 0.64, 1);
		animation-timing-function: cubic-bezier(0.16, 0.84, 0.3, 1),
			linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1);
	}
	@keyframes coin-spin {
		from {
			transform: rotateY(-720deg);
		}
	}
	@keyframes coin-pop {
		from {
			scale: 0.2;
			opacity: 0;
		}
		12% {
			opacity: 1;
		}
	}
	.enter .tier {
		animation: tier-in 0.5s calc(var(--d) + 0.7s) cubic-bezier(0.3, 1.4, 0.5, 1) both;
	}
	@keyframes tier-in {
		from {
			transform: translateY(-6px) scale(0.6);
			opacity: 0;
		}
	}
	.tier {
		margin-top: -8px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--tier);
		color: #fff;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.02em;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
		z-index: 1;
	}
</style>
