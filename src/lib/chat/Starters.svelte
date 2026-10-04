<script lang="ts" module>
	/**
	 * 첫마디 도우미 질문 — 가볍고, 신상(학년·반·이름·SNS)을 묻지 않는 것만.
	 * 신상을 캐묻지 않는 게 이 앱의 약속이라, 도우미가 먼저 그걸 어기면 안 된다.
	 */
	const POOL = [
		'요즘 제일 자주 듣는 노래 뭐예요?',
		'주말엔 보통 뭐 하면서 쉬어요?',
		'요즘 빠져 있는 거 하나만 알려 주세요!',
		'급식 메뉴 중에 최애가 뭐예요?',
		'최근에 본 영화나 드라마 추천해 줄 수 있어요?',
		'시험 끝나면 제일 먼저 하고 싶은 거 있어요?',
		'아침형이에요, 저녁형이에요?',
		'요즘 웃겼던 일 하나 있어요?',
		'여행 간다면 어디 가 보고 싶어요?',
		'민초 vs 반민초, 어느 쪽이에요?',
		'좋아하는 계절이랑 이유가 궁금해요',
		'요즘 스트레스 풀 때 뭐 해요?'
	];

	/** 방마다 다른 순서, 같은 방이면 늘 같은 순서 (다시 열어도 질문이 바뀌지 않게) */
	function seeded(seed: string) {
		let h = 2166136261;
		for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
		return [...POOL].sort((a, b) => ((h ^ hash(a)) >>> 0) - ((h ^ hash(b)) >>> 0));
	}
	function hash(s: string) {
		let h = 0;
		for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return h;
	}
</script>

<script lang="ts">
	import { expand } from '$lib/transitions';
	/**
	 * 대화 첫마디 도우미 — 내가 아직 한 마디도 안 했을 때 입력창 위에 질문 세 개.
	 * 누르면 입력창에 채워질 뿐 바로 보내지 않는다 (고쳐서 보내도 된다).
	 * 둘 다 적어 둔 관심사가 있으면 그 얘기가 맨 앞, 상대만 적었으면 상대 관심사 질문.
	 */
	let {
		roomId,
		mine = [],
		theirs = [],
		onpick
	}: { roomId: string; mine?: string[]; theirs?: string[]; onpick: (text: string) => void } = $props();

	let page = $state(0);
	const order = $derived(seeded(roomId));
	const personal = $derived.by(() => {
		const shared = theirs.find((t) => mine.includes(t));
		if (shared) return `저도 ${shared} 좋아해요! 요즘 뭐에 빠져 있어요?`;
		if (theirs[0]) return `${theirs[0]} 좋아하시는구나! 언제부터예요?`;
		return null;
	});
	const chips = $derived.by(() => {
		const n = personal && page === 0 ? 2 : 3;
		const start = (page * 3) % order.length;
		const picked = [...order, ...order].slice(start, start + n);
		return personal && page === 0 ? [personal, ...picked] : picked;
	});
</script>

<div class="starters" aria-label="첫마디 도우미" in:expand out:expand>
	{#each chips as c (c)}
		<button class="chip" onclick={() => onpick(c)}>{c}</button>
	{/each}
	<button class="more" onclick={() => page++} aria-label="다른 질문 보기">↻</button>
</div>

<style>
	.starters {
		display: flex;
		gap: 8px;
		/* 위아래 5px 는 칩의 누름 영역(34 → 44)이 잘리지 않게 (옆으로 밀리는 줄은 넘친 것을 자른다) */
		padding: 5px 0 3px;
		margin-top: -5px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.starters::-webkit-scrollbar {
		display: none;
	}
	/* 글자는 자르지 않는다 — 줄이 넘치면 옆으로 밀어서 본다 */
	.chip,
	.more {
		position: relative;
		transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-3) var(--ease-settle);
	}
	.chip::after,
	.more::after {
		content: '';
		position: absolute;
		inset: -5px min(0px, calc(50% - 22px));
	}
	.chip:active,
	.more:active {
		opacity: 0.6;
		transform: scale(0.95);
		transition-duration: 0.08s;
	}
	.chip {
		flex: none;
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--bg);
		font-size: 13px;
		white-space: nowrap;
	}
	.more {
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--field);
		color: var(--text-2);
		font-size: 15px;
	}
</style>
