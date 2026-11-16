<script lang="ts">
	/**
	 * IT 동아리 Beatus 뱃지 — 실제 에나멜 핀을 그대로 옮긴 그림 (Phase 71). 모양은 동아리 공식 로고(검은 바탕 · 흰 선)에서 잰 것.
	 * 은색 테 · 검은 에나멜 띠에 도드라진 은 글자 "CNSA IT CLUB"(위) · "BEATUS"(아래), 안쪽에 가는 은 고리.
	 * 두 고리 위의 은 구슬(궤도의 점) 다섯 개, 가운데는 흰 에나멜 세리프 B — 오른쪽 아래 둥근 배에 마우스 화살표가 겹친다.
	 * B · 화살표는 로고 픽셀 좌표 그대로(1080 칸, 가운데 540) 적고 한 번에 줄인다.
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	// 로고 좌표 — 바깥 선 · 위 속 · 아래 속 (evenodd 로 속을 비운다)
	const B =
		'M330 290H560C660 290 728 330 728 402C728 470 680 506 615 516C705 526 755 578 755 650C755 730 690 773 560 773H330V762H375V302H330Z' +
		'M510 302H552C585 302 592 345 592 402C592 470 578 507 548 507H510Z' +
		'M510 528H552C598 528 612 575 612 645C612 725 592 762 552 762H510Z';
	// 마우스 화살표 — 끝이 (0,0), 꼬리가 아래로. 로고에서는 끝이 (690, 650), 오른쪽 아래로 25° 기울어 있다
	const ARROW = 'M0 0L58 136L17 118V185H-17V118L-58 136Z';
	// 고리 위 구슬 — [각도(도, 3시 = 0 · 시계 방향), 반지름, 크기]
	const DOTS: [number, number, number][] = [
		[-54.5, 46.5, 2.5],
		[193, 46.5, 2.5],
		[47.2, 46.5, 2.5],
		[150.8, 37.5, 1.8],
		[14, 37.5, 1.8]
	];
	const at = (deg: number, r: number) => [50 + r * Math.cos((deg * Math.PI) / 180), 50 + r * Math.sin((deg * Math.PI) / 180)];
</script>

<svg class="pin-art" viewBox="-3 -3 106 106" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><circle cx="50" cy="50" r="47.8" /></clipPath>
		<linearGradient id="{uid}-silver" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#ffffff" />
			<stop offset="0.3" stop-color="#b9bec6" />
			<stop offset="0.55" stop-color="#f1f3f6" />
			<stop offset="0.8" stop-color="#9ba1aa" />
			<stop offset="1" stop-color="#e2e5ea" />
		</linearGradient>
		<radialGradient id="{uid}-enamel" cx="0.42" cy="0.36" r="0.7">
			<stop offset="0" stop-color="#2a2a2f" />
			<stop offset="1" stop-color="#0d0d10" />
		</radialGradient>
		<!-- 글자가 놓이는 길 — 위는 왼쪽에서 위로 돌아 오른쪽, 아래는 왼쪽에서 아래로 돌아 오른쪽 (글자가 늘 똑바로 선다) -->
		<path id="{uid}-top" d="M10.4 50A39.6 39.6 0 0 1 89.6 50" />
		<path id="{uid}-bottom" d="M5.9 50A44.1 44.1 0 0 0 94.1 50" />
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.7" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 두께 · 은 테 · 검은 에나멜 -->
	<circle cx="50" cy="51.6" r="48.4" fill="#3d4047" />
	<circle cx="50" cy="50" r="48.4" fill="url(#{uid}-silver)" />
	<circle cx="50" cy="50" r="45.2" fill="url(#{uid}-enamel)" stroke="#55585f" stroke-width="0.5" />
	<!-- 안쪽 고리 -->
	<circle cx="50" cy="50" r="37.5" fill="none" stroke="url(#{uid}-silver)" stroke-width="1.3" />

	<!-- 고리 위 구슬 (궤도의 점) -->
	{#each DOTS as [deg, r, s] (deg)}
		{@const [x, y] = at(deg, r)}
		<circle cx={x} cy={y + 0.4} r={s} fill="#3d4047" />
		<circle cx={x} cy={y} r={s} fill="url(#{uid}-silver)" />
	{/each}

	<!-- 도드라진 은 글자 -->
	<g font-family="'Times New Roman', Georgia, 'Noto Serif', serif" font-weight="700" text-anchor="middle" fill="url(#{uid}-silver)" stroke="#2b2d33" stroke-width="0.25" paint-order="stroke">
		<text font-size="6" letter-spacing="0.25"><textPath href="#{uid}-top" startOffset="50%">CNSA IT CLUB</textPath></text>
		<text font-size="6.2" letter-spacing="0.4"><textPath href="#{uid}-bottom" startOffset="50%">BEATUS</textPath></text>
	</g>

	<!-- B · 화살표 — 흰 에나멜에 은 테. 화살표는 검은 틈을 두고 B 위에 겹친다 -->
	<g transform="translate(50 50) scale(0.094) translate(-540 -540)">
		<path d={B} fill="#f5f5f2" fill-rule="evenodd" stroke="url(#{uid}-silver)" stroke-width="12" stroke-linejoin="miter" />
		<g transform="translate(690 650) rotate(-25.3)">
			<path d={ARROW} fill="#111114" stroke="#111114" stroke-width="30" stroke-linejoin="miter" />
			<path d={ARROW} fill="#f7f7f4" stroke="url(#{uid}-silver)" stroke-width="11" stroke-linejoin="miter" />
		</g>
	</g>

	<!-- 에나멜 위 유리 빛 -->
	<g clip-path="url(#{uid}-clip)" fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M14 34A38 38 0 0 1 34 12.5" stroke-opacity="0.28" stroke-width="1.6" />
		<path d="M31.5 28V70" stroke-opacity="0.35" stroke-width="0.9" />
	</g>

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="140" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
		</g>
	{/if}
</svg>
