<script lang="ts">
	/**
	 * 14일 추이 막대 (운영 콘솔 개요, Phase 96) — 하루 한 칸, 한 가지 수만 (한 축 · 한 색).
	 * 위에는 최근 7일 합계와 그 전 7일과의 차이, 막대에 올리면 그날 수를 아래 줄에 보인다. 표로도 볼 수 있다(화면 낭독기 · 키보드).
	 * 오늘 칸은 아직 하루가 끝나지 않아 흐리게 그린다.
	 */
	let { title, unit, days }: { title: string; unit: string; days: { d: string; v: number }[] } = $props();

	const W = 20; // 하루 한 칸의 폭 (막대 16 + 틈 4)
	const H = 72;
	const max = $derived(Math.max(1, ...days.map((x) => x.v)));
	const sum = (xs: { v: number }[]) => xs.reduce((n, x) => n + x.v, 0);
	const recent = $derived(sum(days.slice(-7)));
	const before = $derived(sum(days.slice(-14, -7)));
	const diff = $derived(recent - before);

	const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
	/** '2026-11-10' → '11/10 (화)' — 날짜 글자를 그대로 읽는다 (시간대에 흔들리지 않게) */
	function label(d: string) {
		const [y, m, day] = d.split('-').map(Number);
		return `${m}/${day} (${WEEK[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]})`;
	}
	const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

	let hover = $state<number | null>(null);
	/** 위쪽 모서리만 둥근 막대 — 바닥선에 붙는다 */
	function bar(i: number, v: number) {
		const h = Math.max(v ? 2 : 0, Math.round((v / max) * (H - 4)));
		const x = i * W + 2, w = W - 4, r = Math.min(4, h);
		return `M${x} ${H}V${H - h + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${H}z`;
	}
</script>

<section class="trend">
	<header>
		<h3>{title}</h3>
		<p class="head"><b class="num">{recent.toLocaleString('ko-KR')}</b><span>{unit} · 최근 7일</span></p>
	</header>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg viewBox="0 0 {days.length * W} {H + 1}" role="img" aria-label="{title} 14일 추이 — 최근 7일 {recent}{unit}, 그 전 7일 {before}{unit}" onpointerleave={() => (hover = null)}>
		<line x1="0" x2={days.length * W} y1={H + 0.5} y2={H + 0.5} class="base" />
		{#each days as x, i (x.d)}
			<path d={bar(i, x.v)} class="bar" class:today={i === days.length - 1} class:on={hover === i} />
			<!-- 막대보다 넓은 누를 자리 — 칸 전체 -->
			<rect x={i * W} y="0" width={W} height={H} fill="transparent" onpointerenter={() => (hover = i)} />
		{/each}
	</svg>
	<p class="axis" aria-hidden="true"><span>{short(days[0].d)}</span><span>{short(days[Math.floor(days.length / 2)].d)}</span><span>오늘</span></p>
	<p class="read num" aria-live="off">
		{#if hover !== null}
			{label(days[hover].d)} · <b>{days[hover].v.toLocaleString('ko-KR')}{unit}</b>{#if hover === days.length - 1} <span class="muted">(오늘, 진행 중)</span>{/if}
		{:else}
			그 전 7일 {before.toLocaleString('ko-KR')}{unit}
			<span class="muted">· {diff === 0 ? '같음' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toLocaleString('ko-KR')}${unit}`}</span>
		{/if}
	</p>
	<details>
		<summary>표로 보기</summary>
		<table>
			<thead><tr><th>날짜</th><th>{title}</th></tr></thead>
			<tbody>
				{#each days.toReversed() as x (x.d)}
					<tr><td>{label(x.d)}</td><td class="num">{x.v.toLocaleString('ko-KR')}{unit}</td></tr>
				{/each}
			</tbody>
		</table>
	</details>
</section>

<style>
	.trend {
		padding: 14px 16px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.head {
		margin: 0;
		font-size: 12px;
		color: var(--text-2);
		white-space: nowrap;
	}
	.head b {
		margin-right: 3px;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	svg {
		display: block;
		width: 100%;
		height: 72px;
		overflow: visible;
	}
	.base {
		stroke: var(--line);
		stroke-width: 1;
	}
	.bar {
		fill: var(--accent-fill);
		opacity: 0.85;
	}
	.bar.today {
		opacity: 0.45;
	}
	.bar.on {
		opacity: 1;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--text-2);
	}
	.read {
		min-height: 18px;
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--text-2);
	}
	.read b {
		color: var(--text);
	}
	details {
		margin-top: 6px;
		font-size: 12px;
		color: var(--text-2);
	}
	summary {
		cursor: pointer;
		width: fit-content;
	}
	table {
		width: 100%;
		margin-top: 6px;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 4px 0;
		text-align: left;
		border-bottom: 1px solid var(--line);
		font-weight: 500;
	}
	th:last-child,
	td:last-child {
		text-align: right;
	}
</style>
