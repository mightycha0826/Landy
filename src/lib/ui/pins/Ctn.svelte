<script lang="ts">
	/**
	 * 영상 제작 동아리 CTN 뱃지 — 실제 은 핀을 그대로 옮긴 그림 (Phase 104).
	 * 왼쪽에 큰 하늘색 에나멜 원, 그 뒤 오른쪽 아래로 은 원이 비켜 나와 초승달처럼 보이고(동아리 로고의 두 원),
	 * 오른쪽은 글자 "CTN" 을 따라 오린 은판 — 위는 곧고 아래 가장자리는 글자마다 볼록하게 따라간다. 글자는 검은 에나멜에 가는 은 테.
	 * 글자는 로고보다 가는 획(키의 1/5)으로, 글꼴 대신 도형으로 짓는다 (기기마다 같게). C 는 앞 원의 오른쪽 가장자리에 걸친다.
	 * 모양은 사진에서 잰 점 그대로 (비스듬히 찍은 사진을 글자가 바로 서게 돌려 격자에 대고 잰 것, 핀 폭 ≈ 81).
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	const FRONT = { cx: 17.5, cy: 26.6, r: 14 }; // 하늘색 원 (은 테 포함)
	const BACK = { cx: 22, cy: 36, r: 13 }; // 뒤의 은 원 — 아래 오른쪽만 보인다
	// 글자 — 키 17.5, 획 ≈ 3.5. C 는 획 굵기의 선으로 그린 타원 고리(오른쪽이 열린다)
	const C = 'M42.7 25.4A6.4 7.05 0 1 0 42.7 33.5';
	const T = 'M45.7 20.3H62V23.3H55.8V38.3H52.1V23.3H45.7Z';
	const N = 'M63 39V20.5H66.8L77 33.2V20.5H80.5V39H76.7L66.6 26.3V39Z';
	const RING = { cx: 37.4, cy: 29.45, rx: 6.4, ry: 7.05 }; // C 고리의 가운데 선 — 판은 C 속까지 메운다
	const STROKE = 3.5;
	// 글자 판 — 위는 곧은 띠, 아래는 글자를 1.8 만큼 부풀린 모양이 이어져 물결진다
	const BAND = 'M37 18.8H81.6Q84.2 18.8 84.2 21.4V37.6Q84.2 39.6 82 39.6H37Z';
	const GROW = 3.6;
</script>

<svg class="pin-art" viewBox="2.5 11.5 83.5 39" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip">
			<circle cx={BACK.cx} cy={BACK.cy} r={BACK.r} />
			<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} />
			<path d={BAND} />
		</clipPath>
		<!-- 거울처럼 닦인 은 — 옷감의 푸른 빛이 비친다 -->
		<linearGradient id="{uid}-silver" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="10" y2="50">
			<stop offset="0" stop-color="#f7f9fc" />
			<stop offset="0.28" stop-color="#c3cbd6" />
			<stop offset="0.52" stop-color="#8d97a6" />
			<stop offset="0.75" stop-color="#d3dae3" />
			<stop offset="1" stop-color="#a2abb7" />
		</linearGradient>
		<radialGradient id="{uid}-sky" cx="0.35" cy="0.3" r="0.8">
			<stop offset="0" stop-color="#c9ecfd" />
			<stop offset="0.6" stop-color="#9fd5f3" />
			<stop offset="1" stop-color="#86c3ea" />
		</radialGradient>
		<radialGradient id="{uid}-glare" cx="0.78" cy="0.72" r="0.42">
			<stop offset="0" stop-color="#fff" stop-opacity="0.85" />
			<stop offset="1" stop-color="#fff" stop-opacity="0" />
		</radialGradient>
		<linearGradient id="{uid}-ink" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#25282e" />
			<stop offset="1" stop-color="#0d0e11" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.8" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 글자 판 한 덩어리 (곧은 띠 + 부풀린 글자) — 테는 모두 먼저 긋고 바탕을 위에 덮어 안쪽 선을 지운다 -->
	{#snippet band(fill: string, edge: number, dy = 0)}
		<g {fill} stroke={fill} stroke-linejoin="round" transform="translate(0 {dy})">
			<path d={BAND} stroke-width={edge} />
			<ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} stroke-width={STROKE + GROW + edge} />
			<path d="{T}{N}" stroke-width={GROW + edge} />
		</g>
	{/snippet}

	<!-- 두께 (아래로 겹친 그림자) -->
	<g fill="#454b55" transform="translate(0 1.3)">
		<circle cx={BACK.cx} cy={BACK.cy} r={BACK.r + 0.6} />
		<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r + 0.6} />
	</g>
	{@render band('#454b55', 1.2, 1.3)}

	<!-- 뒤의 은 원 → 앞의 하늘색 원(은 테) -->
	<circle cx={BACK.cx} cy={BACK.cy} r={BACK.r} fill="url(#{uid}-silver)" stroke="#eef2f6" stroke-width="1.2" />
	<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} fill="url(#{uid}-silver)" stroke="#eef2f6" stroke-width="1.2" />
	<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r - 1.2} fill="url(#{uid}-sky)" stroke="#5d8fb8" stroke-width="0.35" />
	<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r - 1.2} fill="url(#{uid}-glare)" />

	<!-- 글자 판 — 앞 원의 오른쪽 가장자리를 덮는다 -->
	{@render band('#eef2f6', 1.2)}
	{@render band(`url(#${uid}-silver)`, 0)}

	<!-- 검은 에나멜 글자 — 가는 은 테 위에 에나멜 -->
	<g stroke-linejoin="miter">
		<path d={C} fill="none" stroke="#f1f4f7" stroke-width={STROKE + 1} />
		<path d="{T}{N}" fill="#f1f4f7" stroke="#f1f4f7" stroke-width="1" />
		<path d={C} fill="none" stroke="url(#{uid}-ink)" stroke-width={STROKE} />
		<path d="{T}{N}" fill="url(#{uid}-ink)" />
	</g>

	<!-- 빛 — 원의 왼쪽 위 테 · 판 위 가장자리 · 뒤 원 아래의 강한 빛 -->
	<g fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M5.4 22Q8 14 17 13.3" stroke-opacity="0.75" stroke-width="0.9" />
		<path d="M40 19.7H81" stroke-opacity="0.85" stroke-width="0.6" />
		<path d="M13.6 44.4Q21 48.6 29.8 45.4" stroke-opacity="0.7" stroke-width="1.2" />
	</g>

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="80" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>
