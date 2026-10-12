<script lang="ts">
	/**
	 * 도서부 뱃지 — 실제 에나멜 핀을 그대로 옮긴 그림 (Phase 90).
	 * 마름모로 세운 정사각형 판: 옅은 금 테 · 파란 에나멜, 가운데에 펼친 책(크림색 책장 뒤로 하늘색 표지가 비친다), 아래에 흰 "CNSA".
	 * 모양은 사진에서 잰 점 그대로 (비스듬히 찍은 사진을 글자가 바로 서게 돌려 격자에 대고 잰 것, 마름모 한 대각선 = 98).
	 */
	let { shine = false, delay = 0 }: { shine?: boolean; delay?: number } = $props();
	const uid = $props.id();

	const diamond = '50 1 99 50 50 99 1 50';
	// 표지(뒤) · 책장(앞) — 책장 위 가장자리는 가운데 접힌 자리로 내려앉는 두 언덕, 아래는 가운데로 살짝 처진다
	const COVER = 'M21 32.6L26 30.6L50 31L74 30.6L79 32.6V59Q61.5 57 50 62Q38.5 57 21 59Z';
	const PAGES = 'M25.5 30.6Q31 26 37 25.6Q45 25.4 50 30.6Q55 25.4 63 25.6Q69 26 74.5 30.6V56Q59 54.6 50 59.2Q41 54.6 25.5 56Z';
</script>

<svg class="pin-art" viewBox="-2 -1.5 104 104" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><polygon points={diamond} /></clipPath>
		<!-- 옅은 금 테 (사진의 샴페인 금색) -->
		<linearGradient id="{uid}-gold" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#fbf1cf" />
			<stop offset="0.35" stop-color="#dcc382" />
			<stop offset="0.6" stop-color="#c3a55a" />
			<stop offset="0.8" stop-color="#f1e1aa" />
			<stop offset="1" stop-color="#a98a45" />
		</linearGradient>
		<radialGradient id="{uid}-enamel" cx="0.62" cy="0.3" r="0.8">
			<stop offset="0" stop-color="#4d68cc" />
			<stop offset="0.55" stop-color="#3650b6" />
			<stop offset="1" stop-color="#26399a" />
		</radialGradient>
		<linearGradient id="{uid}-page" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#f1eee4" />
			<stop offset="1" stop-color="#ddd8c8" />
		</linearGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.75" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 금속 판 — 조금 아래로 겹쳐 핀의 두께처럼 · 금 테 · 파란 에나멜 -->
	<polygon points={diamond} fill="#7d6632" stroke="#7d6632" stroke-width="2" stroke-linejoin="round" transform="translate(0 1.6)" />
	<polygon points={diamond} fill="url(#{uid}-gold)" stroke="#e9d69b" stroke-width="1.2" stroke-linejoin="round" />
	<polygon points="50 4.6 95.4 50 50 95.4 4.6 50" fill="url(#{uid}-enamel)" stroke="#1d2c78" stroke-width="0.6" />
	<!-- 책 아래로 진 그늘 (사진에서 가운데 아래가 한 톤 어둡다) -->
	<polygon points="40 60 60 60 50 92" fill="#1d2c80" opacity="0.16" />

	<!-- 펼친 책 — 하늘색 표지 위에 크림색 책장, 흰 선으로 칸을 나눈다 -->
	<g stroke-linejoin="round">
		<path d={COVER} fill="#a6d3d2" stroke="#eef6f4" stroke-width="0.7" />
		<path d={PAGES} fill="url(#{uid}-page)" stroke="#f7f8f4" stroke-width="0.7" />
		<path d="M50 31.4V58.4" fill="none" stroke="#c9c3b1" stroke-width="0.5" />
	</g>

	<!-- 흰 에나멜 글자 -->
	<text x="50" y="75.6" text-anchor="middle" textLength="38" lengthAdjust="spacingAndGlyphs" font-family="'Gill Sans', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif" font-weight="600" font-size="12.6" fill="#f6f6f1" stroke="#1d2c78" stroke-width="0.3" paint-order="stroke">CNSA</text>

	<!-- 에나멜 위 유리 빛 — 오른쪽 위 넓은 빛 · 책장 위 가는 빛 -->
	<g clip-path="url(#{uid}-clip)" fill="none" stroke="#fff" stroke-linecap="round">
		<path d="M58 12L86 40" stroke-opacity="0.22" stroke-width="5" />
		<path d="M29 32Q36 28 46 31M54 31Q63 27.6 71 32" stroke-opacity="0.55" stroke-width="0.7" />
	</g>
	<!-- 금속 테의 빛 -->
	<path d="M4 47.8L47.8 4M52.2 4L70 21.8" fill="none" stroke="#fffbe8" stroke-opacity="0.75" stroke-width="0.7" stroke-linecap="round" />

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="140" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
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
