<script lang="ts">
	/**
	 * 품격위원 뱃지 — 실제 에나멜 핀을 그대로 옮긴 그림 (Phase 90).
	 * 구름처럼 물결진 두 칸이 붙은 판(위 · 아래 가운데가 오목하게 꺾인다): 굵은 금 테 · 파란 에나멜에 도드라진 금 글자 "品格".
	 * 글자는 글꼴 대신 획을 하나씩 사진에서 재어 그린다 (명조처럼 세로획은 굵고 가로획은 가늘게, 기기마다 같게).
	 * 모양은 사진에서 잰 점 그대로 (사진을 격자에 대고 잰 것, 판 폭 ≈ 97).
	 * 자율위원(Jayul) · 창의위원(Changui) 뱃지도 같은 판 — 글자 획(strokes)만 넘겨 받는다 (Phase 91).
	 */
	type Strokes = [string, number][];
	let { shine = false, delay = 0, strokes }: { shine?: boolean; delay?: number; strokes?: Strokes } = $props();
	const uid = $props.id();

	// 바깥 선 — 왼쪽 위에서 시계 방향. 위 가장자리마다 작은 오목 · 가운데 V, 옆은 위가 좁고 아래가 불룩, 아래 가운데도 오목
	const OUTLINE =
		'M9 6.5Q10 4.6 13 4.6L24 4.8Q26 6.4 28 4.6Q36 3.4 44 4.2Q46.5 5 48 9.5Q49.5 5.2 52 4.4L64 4.2Q66.5 5.8 69 4.2Q80 3.2 89 4Q93 4.4 93.6 8.5' +
		'L94 21Q94.2 24 95.6 25.5Q97.6 27.5 97.6 31L97.4 52Q97.2 55 96 57Q95.8 62.6 90 64.2L58 64.6Q53 64.4 50.5 60.8Q48 63.6 44 63.8L8 64.4' +
		'Q2.4 63.8 1.6 58.4L1.2 32Q1.4 27.6 4.6 25.6Q6 24.2 6 21L6.2 11Q6.6 7.8 9 6.5Z';
	// 口 — 왼 · 오른 세로획(굵게, 위 · 아래 끝 따로) · 위 · 아래 가로획(가늘게)
	const box = (l: number, r: number, lt: number, lb: number, rt: number, rb: number, top: number, bottom: number) => ({
		v: `M${l} ${lt}V${lb}M${r} ${rt}V${rb}`,
		h: `M${l} ${top}H${r}M${l} ${bottom}H${r}`
	});
	const BOXES = [box(18.5, 35, 15.5, 31.5, 14.5, 32, 18.4, 29.2), box(12.5, 23.5, 34, 57, 34.5, 56, 37.2, 51.8), box(30.5, 42, 34, 56, 34, 55.5, 37.2, 51.8), box(71.2, 85, 39.5, 56, 39, 55.5, 41, 52)];
	// 획마다 [길, 굵기] — 品 은 口 셋, 格 은 木(세로 · 가로 · 삐침 · 점) + 各(夂 넷 · 口)
	const PUMGYEOK: Strokes = [
		[BOXES.map((b) => b.v).join('') + 'M61.2 15V56', 3.3],
		[BOXES.map((b) => b.h).join('') + 'M54 23.8H67.5M70.5 21.6L84 19.6', 2.1],
		['M60 27.5L53.2 44.5M74.5 14.5L68.5 24.5M83.8 20.5Q79 30 69.5 37.5', 2.7],
		['M63 29L66.2 33.5', 2.5],
		['M73.5 25L88 34.5', 3.1]
	];
	const STROKES = $derived(strokes ?? PUMGYEOK);
</script>

<svg class="pin-art" viewBox="-1.5 0 102 69" aria-hidden="true">
	<defs>
		<clipPath id="{uid}-clip"><path d={OUTLINE} /></clipPath>
		<linearGradient id="{uid}-gold" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#fff2b8" />
			<stop offset="0.3" stop-color="#e6c463" />
			<stop offset="0.55" stop-color="#c9a13c" />
			<stop offset="0.8" stop-color="#f3dc8a" />
			<stop offset="1" stop-color="#a98426" />
		</linearGradient>
		<radialGradient id="{uid}-enamel" cx="0.4" cy="0.3" r="0.85">
			<stop offset="0" stop-color="#3a5ce0" />
			<stop offset="0.6" stop-color="#2c4bd0" />
			<stop offset="1" stop-color="#2238ad" />
		</radialGradient>
		<linearGradient id="{uid}-sweep" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0.3" stop-color="#fff" stop-opacity="0" />
			<stop offset="0.5" stop-color="#fff" stop-opacity="0.75" />
			<stop offset="0.7" stop-color="#fff" stop-opacity="0" />
		</linearGradient>
	</defs>

	<!-- 금판 두께 · 파란 에나멜 -->
	<path d={OUTLINE} fill="#7a5c14" stroke="#7a5c14" stroke-width="1.6" transform="translate(0 1.6)" />
	<path d={OUTLINE} fill="url(#{uid}-enamel)" stroke="#e8c96a" stroke-width="1.2" />
	<!-- 굵은 금 테 — 선을 판 모양으로 잘라 안쪽 절반만 (안쪽 가장자리에 어두운 금 선) -->
	<g clip-path="url(#{uid}-clip)" fill="none">
		<path d={OUTLINE} stroke="#8a6716" stroke-width="7.2" />
		<path d={OUTLINE} stroke="url(#{uid}-gold)" stroke-width="6" />
	</g>

	<!-- 도드라진 금 글자: 아래 그림자 → 몸 → 위쪽 빛 -->
	<g fill="none" stroke-linecap="butt" stroke-linejoin="round">
		{#each STROKES as [d, w] (d)}<path {d} stroke="#5a430c" stroke-width={w} transform="translate(0.5 0.8)" />{/each}
		{#each STROKES as [d, w] (d)}<path {d} stroke="url(#{uid}-gold)" stroke-width={w} />{/each}
		{#each STROKES as [d, w] (d)}<path {d} stroke="#fff8d6" stroke-opacity="0.6" stroke-width={w * 0.2} transform="translate(-0.35 -0.4)" />{/each}
	</g>

	<!-- 에나멜 위 유리 빛 — 테 안쪽의 반짝이는 점 · 왼쪽 위 넓은 빛 -->
	<g clip-path="url(#{uid}-clip)" fill="#fff">
		<path d="M10 14Q16 9 26 9" fill="none" stroke="#fff" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round" />
		<circle cx="16.5" cy="12" r="0.7" opacity="0.8" />
		<circle cx="57.5" cy="11.5" r="0.6" opacity="0.8" />
		<circle cx="88.5" cy="59.5" r="0.7" opacity="0.7" />
		<circle cx="46.5" cy="58.8" r="0.8" opacity="0.7" />
	</g>
	<!-- 금 테의 빛 -->
	<path d="M8 11Q8.6 7.4 13 6.4L24 6.6M70 5.8Q80 5 88 5.6" fill="none" stroke="#fffbe8" stroke-opacity="0.8" stroke-width="0.7" stroke-linecap="round" />

	{#if shine}
		<g clip-path="url(#{uid}-clip)">
			<rect class="sweep" x="-40" y="-10" width="60" height="100" fill="url(#{uid}-sweep)" transform="skewX(-18)" style:--d="{delay}ms" />
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
