<script lang="ts">
	/**
	 * 극작소 (연극 동아리) 뱃지 — 실제 에나멜 핀을 그대로 옮긴 그림 (Phase 70, CNSA 분류의 첫 뱃지).
	 * 빨간 상자 위로 솟은 검은 슬레이트(클래퍼보드: 흰 화살 셋 · 점 셋 · 줄 셋) + 오른쪽 아래 막이 걷힌 무대 상자.
	 * 에나멜 핀처럼: 칸마다 검은 금속 테두리가 도드라지고, 에나멜 위에 유리 같은 빛 · 아래로 떨어지는 그림자.
	 * 모양은 사진에서 잰 점 그대로 (정면 사진을 격자에 대고 잰 것, 사진 픽셀 × 0.142).
 * 아래 가장자리는 사진처럼 오른쪽으로 올라간다 — 앞면 아래 선 · 무대 아래 선 모두, 무대 왼쪽 아래 끝은 뾰족하게.
 * 칸 사이 금속 선 · 막 선은 굵게 (사진의 도드라진 금속 테). 모서리는 사진처럼 뾰족하게 (miter) — 화살은 끝이 곧은 채운 도형.
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	// 꼭짓점 — A·B 슬레이트 위 · C 슬레이트가 앞면에 닿는 곳 · D·E 옆면 위 · F·G 옆면 아래
	// H·I 무대 상자 위 모서리 · Q 윗면 안쪽 · J·K 무대 앞면 위 · L·M 무대 앞면 아래 · N 무대 옆면 아래 · W 앞면이 무대 뒤로 들어가는 곳
	const P = {
		A: [23, 20], B: [78.5, 6.5], C: [68.5, 40.6], D: [21.5, 33.5], E: [36.5, 49.2], F: [8.8, 78.3], G: [25.8, 96.1],
		H: [86.3, 36.4], Q: [84.8, 41.4], I: [107, 57.7], J: [102, 60.6], K: [55.7, 67.7], L: [94.2, 101.1], M: [45.8, 107.5], N: [99.8, 98.3], W: [49.3, 93.3]
	} as const;
	const poly = (...k: (keyof typeof P)[]) => k.map((n) => P[n].join(' ')).join(' ');
	const outline = poly('A', 'B', 'C', 'H', 'I', 'N', 'L', 'M', 'W', 'G', 'F', 'D');
</script>

<svg class="pin-art" viewBox="3 0 112 112" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><polygon points={outline} /></clipPath>
		<linearGradient id="{uid}-red" x1="0" y1="0" x2="0.4" y2="1">
			<stop offset="0" stop-color="#e3262b" />
			<stop offset="1" stop-color="#c3131a" />
		</linearGradient>
		<linearGradient id="{uid}-side" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#b8121a" />
			<stop offset="1" stop-color="#990b12" />
		</linearGradient>
		<linearGradient id="{uid}-slate" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#2d2d33" />
			<stop offset="1" stop-color="#141417" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.75" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 금속 판 (테두리 · 두께) — 조금 아래로 겹쳐 핀의 옆면처럼 -->
	<polygon points={outline} fill="#1b1b1f" stroke="#1b1b1f" stroke-width="5" stroke-linejoin="miter" stroke-miterlimit="4" transform="translate(0 1.6)" />
	<polygon points={outline} fill="#3b3b42" stroke="#4a4a52" stroke-width="4.4" stroke-linejoin="miter" stroke-miterlimit="4" />

	<g clip-path="url(#{uid}-clip)" stroke="#26262b" stroke-width="2.8" stroke-linejoin="miter" stroke-miterlimit="6">
		<!-- 슬레이트 -->
		<polygon points={poly('A', 'B', 'C', 'E', 'D')} fill="url(#{uid}-slate)" />
		<!-- 빨간 상자: 옆면 · 앞면 -->
		<polygon points={poly('D', 'E', 'G', 'F')} fill="url(#{uid}-side)" />
		<polygon points={poly('E', 'C', 'H', 'Q', 'J', 'K', 'W', 'G')} fill="url(#{uid}-red)" />
		<!-- 무대 상자: 가는 윗면 · 옆면 · 앞면 (앞면 위로는 큰 상자의 앞면이 이어진다) -->
		<polygon points={poly('H', 'I', 'J', 'Q')} fill="#ad0f16" />
		<polygon points={poly('J', 'I', 'N', 'L')} fill="url(#{uid}-side)" />
		<polygon points={poly('K', 'J', 'L', 'M')} fill="url(#{uid}-red)" />
	</g>

	<!-- 슬레이트 무늬 (흰 에나멜) -->
	{#each [[37.5, 23.2], [50, 20.2], [62.5, 17.1]] as [x, y] (x)}
		<polygon points="-3.4 -3.6 -0.4 -3.6 2.8 0 -0.4 3.6 -3.4 3.6 -0.2 0" fill="#f3f4f7" transform="translate({x} {y}) rotate(-13.7)" />
	{/each}
	<g fill="none" stroke="#f3f4f7" stroke-linecap="butt" stroke-linejoin="miter">
		<path d="M28.7 34.2L65 27.8M33 39.9L63.6 34.2M37.9 45.4L61.8 40.9" stroke-width="2.1" />
		<path d="M43.2 31.2V37.6M48.2 37V43.2" stroke-width="1.8" />
	</g>
	<g fill="#f3f4f7">
		<circle cx="26.8" cy="25.8" r="1.35" />
		<circle cx="24.6" cy="29.6" r="1.25" />
		<circle cx="28.7" cy="29.9" r="1.25" />
	</g>

	<!-- 무대 막 — 위로 드리운 휘장 두 겹 · 양쪽으로 걷어 묶은 막 (금속 선) -->
	<g fill="none" stroke="#3d0a0e" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="miter">
		<path d="M57 70.8C69 77.2 87 74.2 99.6 64M57.8 74.4C70 81 88 78 99 67.2" />
		<path d="M59.4 72.4C63.8 80 61.2 88.4 53.6 95.6M56.4 75.6C57.8 83.4 56.2 90.2 52.4 95.4M53 96L46.8 106.4M53.4 96L54 105.2M53.2 96L50.4 105.8" />
		<path d="M99 64.8C95.6 72.6 94.6 80.8 94.4 88.2M100.2 67.4C97.8 74.6 96.6 81.6 95.8 88.4M94.8 88.8L91.8 101M95.4 88.8L94.2 100.6" />
	</g>

	<!-- 에나멜 위 유리 빛 — 윗 모서리마다 가는 흰 빛, 오른쪽 위에 넓은 빛 -->
	<g clip-path="url(#{uid}-clip)" fill="none" stroke="#fff" stroke-linecap="butt">
		<path d="M39.5 52.6L67 45.2M24 38.5L34 48.4" stroke-opacity="0.45" stroke-width="1.4" />
		<path d="M88.6 40.2L103.4 55.4" stroke-opacity="0.35" stroke-width="1.2" />
		<path d="M12.5 77L22 40" stroke-opacity="0.2" stroke-width="2.2" />
		<path d="M91.6 86L95.4 69" stroke-opacity="0.18" stroke-width="1.6" />
		<path d="M28 21.5L74 10.5" stroke-opacity="0.25" stroke-width="1.2" />
	</g>

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="140" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>
