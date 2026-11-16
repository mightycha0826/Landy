<script lang="ts">
	/**
	 * CNSA 뱃지 (충남삼성고 학생 뱃지) — 실제 에나멜 핀을 그대로 옮긴 그림 (Phase 71).
	 * 비스듬히 겹친 두 상자: 왼쪽 상자(남색 윗면 · 하늘색 왼면 · 파란 앞면) 앞으로 큰 하늘색 앞면의 상자가 내려앉고, 그 윗면이 남색 세모로 조금 보인다.
	 * 옅은 금색 판 위에 칸마다 에나멜 — 칸 사이로 금속 선이 드러나고, 위 · 아래 가운데는 판이 한 칸씩 꺾인다(두 상자가 어긋난 자리).
	 * 모양은 사진에서 잰 점 그대로 (사진을 격자에 대고 잰 것, 사진 픽셀 × 0.2).
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	type Pt = readonly [number, number];
	const pts = (...p: Pt[]) => p.map((q) => q.join(' ')).join(' ');
	// 금속 판 바깥 선 — 왼쪽 끝에서 시계 방향 (위 · 아래 가운데의 꺾인 자리 포함)
	const outline = pts([2, 35.4], [45.2, 2.2], [52.6, 1.6], [54.4, 21.4], [69.6, 13.4], [97, 24.2], [99.6, 76.6], [56, 109.4], [52.8, 88.6], [25, 99.6], [6.4, 88.4]);
	// 에나멜 칸
	const top = pts([8.4, 36.6], [44, 12.2], [47, 31.4], [27.4, 43.4]);
	const left = pts([7.6, 40.6], [26, 48.2], [29.2, 91], [10.4, 84.4]);
	const mid = pts([29.6, 48], [66.4, 22], [67.4, 39.6], [49.6, 51.4], [49, 80.6], [31.6, 91.4]);
	const tri = pts([69.6, 21], [87.6, 28.6], [71.2, 38.4]);
	const front = pts([51.6, 58.6], [91.2, 32.6], [94.4, 76], [56.4, 102.6]);
</script>

<svg class="pin-art" viewBox="-4.5 0 111 111" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><polygon points={outline} /></clipPath>
		<!-- 옅은 금 (사진의 샴페인 금색) -->
		<linearGradient id="{uid}-gold" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#fbf1cf" />
			<stop offset="0.35" stop-color="#dcc382" />
			<stop offset="0.6" stop-color="#c3a55a" />
			<stop offset="0.8" stop-color="#f1e1aa" />
			<stop offset="1" stop-color="#a98a45" />
		</linearGradient>
		<linearGradient id="{uid}-navy" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#27399a" />
			<stop offset="1" stop-color="#1b2774" />
		</linearGradient>
		<linearGradient id="{uid}-mid" x1="0" y1="0" x2="0.6" y2="1">
			<stop offset="0" stop-color="#3060dc" />
			<stop offset="1" stop-color="#2447bd" />
		</linearGradient>
		<linearGradient id="{uid}-sky" x1="0" y1="0" x2="0.5" y2="1">
			<stop offset="0" stop-color="#55aef0" />
			<stop offset="1" stop-color="#3b8fd8" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.75" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 금속 판 — 조금 아래로 겹쳐 핀의 두께처럼 -->
	<polygon points={outline} fill="#7d6632" stroke="#7d6632" stroke-width="2.4" stroke-linejoin="miter" stroke-miterlimit="6" transform="translate(0 1.8)" />
	<polygon points={outline} fill="url(#{uid}-gold)" stroke="#e9d69b" stroke-width="1.6" stroke-linejoin="miter" stroke-miterlimit="6" />

	<!-- 에나멜 칸 — 칸 가장자리에 금속이 살짝 드리운 그림자 -->
	<g stroke-linejoin="miter" stroke-miterlimit="6" stroke-width="0.9">
		<polygon points={top} fill="url(#{uid}-navy)" stroke="#141d57" />
		<polygon points={left} fill="url(#{uid}-sky)" stroke="#2f78b8" />
		<polygon points={mid} fill="url(#{uid}-mid)" stroke="#1c3a9c" />
		<polygon points={tri} fill="url(#{uid}-navy)" stroke="#141d57" />
		<polygon points={front} fill="url(#{uid}-sky)" stroke="#2f78b8" />
	</g>

	<!-- 에나멜 위 유리 빛 — 칸 윗 가장자리마다 가는 흰 빛 -->
	<g fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M11 38.4L43 16.4M31.5 49.6L64.6 26.2M53.8 60.4L89 37.4" stroke-opacity="0.5" stroke-width="0.9" />
		<path d="M9.8 44L11.8 82.6M58 64L60.6 98" stroke-opacity="0.22" stroke-width="1.6" />
		<path d="M28 44.2L45.2 33.6" stroke-opacity="0.35" stroke-width="0.8" />
	</g>
	<!-- 금속 테의 빛 -->
	<path d="M4 34.6L45 3.6M71 14.6L96 24.8" fill="none" stroke="#fffbe8" stroke-opacity="0.7" stroke-width="0.8" stroke-linecap="round" />

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="140" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>
