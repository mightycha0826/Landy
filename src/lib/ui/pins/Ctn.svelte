<script lang="ts">
	/**
	 * 영상 제작 동아리 CTN 뱃지 — 실제 은 핀을 그대로 옮긴 그림 (Phase 104).
	 * 동아리 로고(보라 원 뒤로 옅은 원이 비스듬히 겹치고 · 오른쪽에 굵은 "CTN")를 은판으로 오린 것:
	 * 앞 원은 하늘색 에나멜, 뒤 원은 은으로 아래 오른쪽에 초승달처럼 보이고, 글자 판의 "CTN" 은 검은 에나멜에 은 테.
	 * 글자는 글꼴 대신 도형으로 짓는다 (로고의 굵은 C 고리 · T · N, 기기마다 같게).
	 * 모양은 사진에서 잰 점 그대로 (비스듬히 찍은 사진을 글자가 바로 서게 돌려 격자에 대고 잰 것, 판 폭 ≈ 81).
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	// 앞 원(에나멜) · 뒤 원(은, 로고처럼 오른쪽 아래로 반지름의 0.45 만큼 비켜 있다) · 글자 판
	const FRONT = { cx: 17.5, cy: 27, r: 12.6 };
	const BACK = { cx: 23.2, cy: 32.6, r: 12.2 };
	const PLATE = { x: 27, y: 14.6, w: 58.4, h: 29.4, rx: 4.2 };
	// 글자 — 키 16.5 · 획 5.3 (로고 비율). C 는 굵은 선으로 그린 고리(오른쪽이 열린다)
	const C = 'M41.2 25A5.6 5.6 0 1 0 41.2 32.5';
	const T = 'M45.6 20.5H62V25.8H56.5V37H51.1V25.8H45.6Z';
	const N = 'M64.2 37V20.5H69.6L76.4 30.4V20.5H81.6V37H76.3L69.5 27.1V37Z';
</script>

<svg class="pin-art" viewBox="2.5 11.5 85.5 39" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip">
			<circle cx={BACK.cx} cy={BACK.cy} r={BACK.r} />
			<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} />
			<rect x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} rx={PLATE.rx} />
		</clipPath>
		<!-- 닦인 은 — 위가 밝고 가운데로 한 번 어두워진다 -->
		<linearGradient id="{uid}-silver" x1="0" y1="0" x2="0.25" y2="1">
			<stop offset="0" stop-color="#fbfcfd" />
			<stop offset="0.3" stop-color="#c9cfd6" />
			<stop offset="0.55" stop-color="#8f969f" />
			<stop offset="0.78" stop-color="#d9dee3" />
			<stop offset="1" stop-color="#9aa1a9" />
		</linearGradient>
		<radialGradient id="{uid}-sky" cx="0.38" cy="0.32" r="0.75">
			<stop offset="0" stop-color="#e2f0ff" />
			<stop offset="0.55" stop-color="#a9cff6" />
			<stop offset="1" stop-color="#7fb1e6" />
		</radialGradient>
		<linearGradient id="{uid}-ink" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#2a2c31" />
			<stop offset="1" stop-color="#0e0f12" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.8" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 은판 두께 → 테(밝은 선) → 바탕. 세 도형을 한 판처럼: 테는 모두 먼저 긋고 바탕을 위에 덮어 안쪽 선을 지운다 -->
	{#snippet plate(fill: string, stroke: string, width: number, dy = 0)}
		<g {fill} {stroke} stroke-width={width} transform="translate(0 {dy})">
			<circle cx={BACK.cx} cy={BACK.cy} r={BACK.r} />
			<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} />
			<rect x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} rx={PLATE.rx} />
		</g>
	{/snippet}
	{@render plate('#4b5058', '#4b5058', 1.6, 1.4)}
	{@render plate('#eef1f4', '#eef1f4', 1.6)}
	{@render plate(`url(#${uid}-silver)`, 'none', 0)}

	<!-- 앞 원 — 은 테 안에 하늘색 에나멜 -->
	<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} fill="url(#{uid}-silver)" stroke="#5f656e" stroke-width="0.4" />
	<circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r - 1.3} fill="url(#{uid}-sky)" stroke="#6f8fb3" stroke-width="0.4" />

	<!-- 검은 에나멜 글자 — 먼저 은 테(굵게), 그 위에 에나멜 -->
	<g stroke-linejoin="round">
		<path d={C} fill="none" stroke="#e9edf1" stroke-width="6.4" />
		<path d="{T}{N}" fill="#e9edf1" stroke="#e9edf1" stroke-width="1.1" />
		<path d={C} fill="none" stroke="url(#{uid}-ink)" stroke-width="5.3" />
		<path d="{T}{N}" fill="url(#{uid}-ink)" />
	</g>

	<!-- 빛 — 에나멜 원 위 넓은 빛 · 판 위 가장자리 -->
	<g fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M9.5 22Q12 16.5 18.5 15.6" stroke-opacity="0.7" stroke-width="1.6" />
		<path d="M30.5 16.4H82" stroke-opacity="0.8" stroke-width="0.7" />
	</g>

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="80" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>
