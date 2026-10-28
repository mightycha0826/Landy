<script lang="ts" module>
	/** 투입구 자리 — 우체통을 담은 틀(흔들리지 않는 바깥 상자)의 자리에서 그림 비율로 (Phase 79: 덜컹이는 중에 재도 어긋나지 않게) */
	export const slotRect = (r: DOMRect) => {
		const u = r.width / 300;
		return { left: r.left + 70 * u, top: r.top + 135 * u, width: 160 * u, height: 12 * u };
	};
</script>

<script lang="ts">
	/**
	 * 우체통 (Phase 71 · 72 · 73 · 74 · 75 · 79) — 벽에 걸린 우편함을 정면에서 본 2D 네모. 앱의 얼굴 그대로 (docs · app.css 토큰):
	 * 연한 붉은 그라디언트(테마와 상관없이 늘 붉다 — app.css --post-*, 대각선) · 큰 둥근 모서리 · 흰 봉투 문양(로고처럼 흰 모양) ·
	 * 반투명 흰 테 안의 투입구 · 브랜드색 빛 그림자(--glow 처럼). 알림 숫자 · "+✉" 는 앱의 흰 알약.
	 *   count — 안에 든(안 읽은) 편지 수: 오른쪽 위에 빨간 점(Phase 79 — 전엔 숫자 · 투입구에 봉투 끝이 삐죽 나왔다).
	 *   drop — 바뀔 때마다 봉투 한 통이 위에서 떨어져 투입구로 쏙 → 통이 출렁 → 위에 "+✉" · 빨간 점이 톡 (편지가 왔다). dropN 은 몇 통인지.
	 *          떨어지는 동안은 그 편지들을 아직 안에 없는 셈으로 친다 (점은 들어간 다음에).
	 *   knock — 바뀔 때마다 통이 두 번 덜컹 (Phase 79 — 우체통을 눌러 편지를 꺼낼 때, 편지 화면이 부른다).
	 *   added — 바뀔 때마다 출렁 + 위에 "+✉" 만 (편지를 보내고 편지함으로 돌아왔을 때). bump — 출렁만.
	 *   slot — 투입구 자리 (보낼 때 봉투를 맞춰 넣으려고 부르는 쪽이 잰다).
	 * 폭은 부르는 쪽이 정한다 (높이는 그림 비율대로). 동작 줄이기면 움직이지 않는다 (CSS 는 app.css 가 끄고, 여기서 쓰는 WAAPI 는 직접 거른다).
	 */
	import { untrack } from 'svelte';
	import { reducedMotion } from '../motion';

	let {
		count = 0,
		drop = 0,
		dropN = 1,
		added = 0,
		bump = 0,
		knock = 0,
		slot = $bindable()
	}: {
		count?: number;
		drop?: number;
		dropN?: number;
		added?: number;
		bump?: number;
		knock?: number;
		slot?: Element;
	} = $props();
	const uid = $props.id();

	let box = $state<HTMLElement>();
	let falling = $state<SVGGElement>();
	let plus = $state<HTMLElement>();
	let plusN = $state(1);

	// 출렁 — 벽에 걸린 통이 살짝 흔들린다 (위 걸이를 축으로)
	const wobble = () =>
		box?.animate(
			[
				{ transform: 'rotate(0deg) translateY(0)' },
				{ transform: 'rotate(-1.2deg) translateY(2px)', offset: 0.25 },
				{ transform: 'rotate(0.8deg) translateY(0)', offset: 0.55 },
				{ transform: 'rotate(-0.3deg)', offset: 0.8 },
				{ transform: 'rotate(0deg)' }
			],
			{ duration: 620, easing: 'ease-out' }
		);
	// 덜컹 덜컹 — 두 번 (한 번에 0.4초쯤: 아래로 툭 · 반대로 · 제자리)
	const knockKnock = () =>
		box?.animate(
			[
				{ transform: 'rotate(0deg) translateY(0)' },
				{ transform: 'rotate(-2deg) translateY(4px)', offset: 0.1 },
				{ transform: 'rotate(1.3deg) translateY(0)', offset: 0.26 },
				{ transform: 'rotate(0deg)', offset: 0.42 },
				{ transform: 'rotate(2deg) translateY(4px)', offset: 0.54 },
				{ transform: 'rotate(-1.3deg) translateY(0)', offset: 0.7 },
				{ transform: 'rotate(0.4deg)', offset: 0.85 },
				{ transform: 'rotate(0deg)' }
			],
			{ duration: 860, easing: 'ease-out' }
		);
	// "+✉" — 위 가장자리에서 톡 튀어나와 잠깐 머물다 떠오르며 사라진다
	const pop = (n: number) => {
		plusN = n;
		plus?.animate(
			[
				{ opacity: 0, transform: 'translate(-50%, -10%) scale(0.5) rotate(-4deg)' },
				{ opacity: 1, transform: 'translate(-50%, -80%) scale(1.08) rotate(2deg)', offset: 0.18 },
				{ opacity: 1, transform: 'translate(-50%, -74%) scale(1) rotate(0)', offset: 0.3 },
				{ opacity: 1, transform: 'translate(-50%, -82%) scale(1)', offset: 0.75 },
				{ opacity: 0, transform: 'translate(-50%, -160%) scale(0.96)' }
			],
			{ duration: 1700, easing: 'ease-out' }
		);
	};

	// 처음 값은 장면 없이 — 바뀔 때만
	// svelte-ignore state_referenced_locally
	const last = { bump, added, drop, knock };
	$effect(() => {
		if (bump === last.bump) return;
		last.bump = bump;
		if (!reducedMotion()) wobble();
	});
	$effect(() => {
		if (knock === last.knock) return;
		last.knock = knock;
		if (!reducedMotion()) knockKnock();
	});
	$effect(() => {
		if (added === last.added) return;
		last.added = added;
		if (reducedMotion()) return;
		wobble();
		pop(1);
	});
	// 편지가 떨어져 투입구로 — 위에서 비스듬히 내려와 투입구 선에서 아래부터 사라진다(들어간다)
	$effect(() => {
		if (drop === last.drop) return;
		last.drop = drop;
		if (reducedMotion() || !falling) return;
		const n = dropN;
		held = Math.max(0, untrack(() => count) - n);
		falling
			.animate(
				[
					{ transform: 'translateY(-150px) rotate(-14deg)', opacity: 0 },
					{ transform: 'translateY(-16px) rotate(3deg)', opacity: 1, offset: 0.55 },
					{ transform: 'translateY(0) rotate(0) scaleY(1)', opacity: 1, offset: 0.72 },
					{ transform: 'translateY(0) rotate(0) scaleY(0)', opacity: 1 }
				],
				{ duration: 800, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }
			)
			.finished.then(
				() => {
					held = null;
					wobble();
					pop(n);
				},
				() => (held = null)
			);
	});

	// 떨어지는 중인 편지는 아직 밖에 — 들어간 다음에 점이 생긴다
	let held = $state<number | null>(null);
	const inside = $derived(held ?? count);
</script>

<span class="postbox" bind:this={box}>
	<svg viewBox="0 0 300 210" aria-hidden="true">
		<defs>
			<!-- 연한 붉은 그라디언트 (app.css --post-a/b/c — 테마 색을 따르지 않는다) -->
			<linearGradient id="{uid}-brand" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" style:stop-color="var(--post-a)" />
				<stop offset="0.5" style:stop-color="var(--post-b)" />
				<stop offset="1" style:stop-color="var(--post-c)" />
			</linearGradient>
			<linearGradient id="{uid}-sheen" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#fff" style:stop-opacity="var(--post-sheen)" />
				<stop offset="0.45" stop-color="#fff" stop-opacity="0" />
			</linearGradient>
		</defs>

		<!-- 몸통 — 둥근 네모, 위쪽에 은은한 빛 · 가는 흰 테 -->
		<rect x="14" y="10" width="272" height="190" rx="34" fill="url(#{uid}-brand)" />
		<rect x="14" y="10" width="272" height="190" rx="34" fill="url(#{uid}-sheen)" />
		<rect x="15.5" y="11.5" width="269" height="187" rx="32.5" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="1.5" />

		<!-- 흰 봉투 문양 -->
		<g fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
			<rect x="120" y="46" width="60" height="42" rx="7" />
			<path d="M123 50l27 20 27-20" />
		</g>

		<!-- 투입구 — 반투명 흰 테 · 짙은 구멍 -->
		<rect x="58" y="126" width="184" height="30" rx="15" fill="#fff" fill-opacity="0.28" />
		<rect class="slot" x="70" y="135" width="160" height="12" rx="6" fill="#7a1330" fill-opacity="0.78" bind:this={slot} />
		<rect x="70" y="135" width="160" height="4" rx="2" fill="#4a0a1e" fill-opacity="0.45" />

		<!-- 편지가 떨어져 들어간다 (drop) — 평소엔 안 보인다 -->
		<g class="falling" bind:this={falling}>
			<rect x="130" y="113" width="40" height="28" rx="2.5" fill="#fffaf0" stroke="#ecdcc2" stroke-width="1" />
			<path d="M131 114L150 127L169 114" fill="none" stroke="#e3cfae" stroke-width="1.1" />
			<circle cx="150" cy="127" r="3.4" fill="#e0405f" />
		</g>

		<!-- 편지가 왔다 — 오른쪽 위 모서리에 빨간 점 (바탕색 테로 통과 떼어 놓고, 은은히 퍼지는 고리) -->
		{#if inside > 0}
			<g class="dot">
				<circle class="ping" cx="276" cy="20" r="13" />
				<circle cx="276" cy="20" r="13" fill="#ff2d3f" style:stroke="var(--bg)" stroke-width="4.5" paint-order="stroke" />
				<circle cx="272" cy="16" r="4" fill="#fff" fill-opacity="0.35" />
			</g>
		{/if}
	</svg>
	<!-- "+✉" — 편지가 들어왔다 (종이 꼬리표처럼) -->
	<span class="plus" bind:this={plus} aria-hidden="true">
		<b>+{plusN > 1 ? plusN : ''}</b>
		<svg viewBox="0 0 24 18"><rect x="1.5" y="1.5" width="21" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M2.5 3l9.5 7 9.5-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" /></svg>
	</span>
</span>

<style>
	.postbox {
		position: relative;
		display: block;
		width: 100%;
		transform-origin: 50% 0;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
		/* 브랜드색 빛 그림자 — 버튼의 --glow 와 같은 결 */
		filter: var(--post-glow); /* app.css — 다크 모드에서는 어둡게 */
	}
	.falling {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: 50% 100%;
	}
	.plus {
		position: absolute;
		left: 50%;
		top: 2%;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 6px 13px 6px 12px;
		border-radius: 999px;
		background: var(--surface);
		color: var(--accent);
		box-shadow: var(--shadow-2);
		opacity: 0;
		transform: translate(-50%, -74%);
		pointer-events: none;
	}
	.plus b {
		font-size: 17px;
		font-weight: 650;
		line-height: 1;
	}
	.plus svg {
		width: 22px;
		height: 17px;
		filter: none;
	}
	/* 빨간 점 — 톡 하고 나타나고, 고리가 천천히 퍼진다 */
	.dot {
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: dot-in 0.45s cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	@keyframes dot-in {
		from {
			transform: scale(0);
		}
	}
	.ping {
		fill: #ff2d3f;
		transform-box: fill-box;
		transform-origin: 50% 50%;
		animation: ping 2.2s 0.5s ease-out infinite;
	}
	@keyframes ping {
		from {
			opacity: 0.55;
			transform: scale(1);
		}
		70%,
		to {
			opacity: 0;
			transform: scale(2.1);
		}
	}
</style>
