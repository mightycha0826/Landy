<script lang="ts">
	/**
	 * 1500m 인증제 뱃지 — 실제 은 핀을 그대로 옮긴 그림 (Phase 90).
	 * 거울처럼 닦인 은판: 왼쪽 위로 솟은 이름표 칸에 "CNSA", 아래 긴 띠에 큰 "S_S_C_" — 모두 비스듬한 각진 글자에 파란 에나멜.
	 * 글자는 글꼴 대신 막대 몇 개로 짓는다 (사진의 각진 경주용 글씨, 기기마다 같게). 막대는 똑바로 세운 자리에 적고 글자 줄마다 한 번에 기울인다.
	 * 모양은 사진에서 잰 점 그대로 (사진을 격자에 대고 잰 것, 판 폭 ≈ 95).
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	type R = [number, number, number, number];
	const outline = '2.6 1.6 39.6 1.6 37.4 10.9 94.6 11.6 91.2 28.2 8.2 28.2 11.4 12.4 0.8 11.2';
	// 글자 막대 — 글자 칸(x, 폭)과 줄(아래 선 b · 높이 h · 가로 굵기 th · 세로 굵기 tv)로
	const line = (b: number, h: number, th: number, tv: number) => {
		const top = b - h, mid = b - h / 2 - th / 2;
		return {
			S: (x: number, w: number): R[] => [[x, top, w, th], [x, top, tv, h / 2 + th / 2], [x, mid, w, th], [x + w - tv, mid, tv, h / 2 + th / 2], [x, b - th, w, th]],
			C: (x: number, w: number, wb = w): R[] => [[x, top, w, th], [x, top, tv, h], [x, b - th, wb, th]],
			N: (x: number, w: number): R[] => [[x, top, w, th], [x, top, tv, h], [x + w - tv, top, tv, h]],
			A: (x: number, w: number): R[] => [[x, top, w, th], [x, top, tv, h], [x + w - tv, top, tv, h], [x, mid, w, th]],
			bar: (x: number, w: number): R[] => [[x, b - th, w, th]]
		};
	};
	// 작은 "CNSA" (아래 선 9.5) · 큰 "S_S_C_" (아래 선 25.3) — 기울기는 사진의 글자 왼 가장자리에서 잰 25°
	const SB = 9.5, BB = 25.3;
	const small = line(SB, 5.9, 1.35, 1.6);
	const big = line(BB, 10.5, 2.4, 2.8);
	const SMALL = [small.C(3.5, 7), small.N(11.2, 7.4), small.S(19.4, 7.6), small.A(27.8, 7)].flat();
	const BIG = [big.S(13, 12.6), big.bar(26.2, 7.4), big.S(39, 12.6), big.bar(52.2, 10), big.C(64.4, 15, 9.8), big.bar(77.2, 10.4)].flat();
</script>

<svg class="pin-art" viewBox="-2 -4.5 99 37" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><polygon points={outline} /></clipPath>
		<!-- 거울 같은 은 — 위는 밝고 가운데로 어두운 갈색 빛이 비친다 -->
		<linearGradient id="{uid}-chrome" x1="0" y1="0" x2="0.15" y2="1">
			<stop offset="0" stop-color="#f6f5f1" />
			<stop offset="0.22" stop-color="#bdb8ae" />
			<stop offset="0.5" stop-color="#77716a" />
			<stop offset="0.72" stop-color="#aaa59c" />
			<stop offset="1" stop-color="#57534d" />
		</linearGradient>
		<linearGradient id="{uid}-blue" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#5677f4" />
			<stop offset="1" stop-color="#3655dc" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.8" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 은판 두께 · 바탕 -->
	<polygon points={outline} fill="#34312d" stroke="#34312d" stroke-width="1.8" stroke-linejoin="round" transform="translate(0 1.3)" />
	<polygon points={outline} fill="url(#{uid}-chrome)" stroke="#d9d6cf" stroke-width="1.8" stroke-linejoin="round" />
	<!-- 도드라진 테 — 안쪽 가장자리에 어두운 선, 테 위는 밝게 (선을 판 모양으로 잘라 안쪽 절반만) -->
	<g clip-path="url(#{uid}-clip)" fill="none" stroke-linejoin="round">
		<polygon points={outline} stroke="#5e5a53" stroke-width="3.4" />
		<polygon points={outline} stroke="#ecebe6" stroke-width="2.2" />
	</g>

	<!-- 파란 에나멜 글자 — 먼저 어두운 테로 한 번, 그 위에 에나멜 (막대가 겹친 자리의 테는 위 칠에 덮인다) -->
	{#each [[SMALL, SB, 0.35], [BIG, BB, 0.6]] as const as [bars, b, rx], i (i)}
		<g transform="translate(0 {b}) skewX(-25) translate(0 {-b})">
			{#each bars as [x, y, w, h], j (j)}<rect {x} {y} width={w} height={h} {rx} fill="#1b2a7a" stroke="#1b2a7a" stroke-width="0.7" />{/each}
			{#each bars as [x, y, w, h], j (j)}<rect {x} {y} width={w} height={h} {rx} fill="url(#{uid}-blue)" />{/each}
		</g>
	{/each}

	<!-- 은의 빛 — 띠 위 가장자리를 따라 긴 빛 · 이름표 위 빛 · 에나멜 위 가는 빛 -->
	<g clip-path="url(#{uid}-clip)" fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M38.5 12.9H92.6" stroke-opacity="0.85" stroke-width="0.9" />
		<path d="M4 3H38" stroke-opacity="0.6" stroke-width="0.7" />
		<path d="M18 16.2H29M44 16.2H55M70 16.2H83M7 4.4H35" stroke-opacity="0.35" stroke-width="0.5" />
	</g>

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="60" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>

<style>
	.pin-art {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.sweep {
		transform-box: view-box;
		translate: -60px 0;
		animation: pin-sweep 1.9s calc(var(--d) + 0.45s) cubic-bezier(0.45, 0, 0.25, 1) forwards;
	}
	@keyframes pin-sweep {
		to {
			translate: 170px 0;
		}
	}
</style>
