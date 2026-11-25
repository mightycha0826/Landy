<script lang="ts" module>
	/** 랜덤 질문 목록 — 서버 private.round_question 과 같은 목록 (슬롯이 도는 그림용. 실제 질문은 서버가 정한다) */
	export const QUESTION_POOL = [
		'요즘 빠져 있는 것', '제일 좋아하는 급식 메뉴', '주말에 주로 하는 일', '요즘 자주 듣는 노래', '가 보고 싶은 여행지',
		'스트레스 푸는 방법', '인생 영화나 드라마', '시험 끝나면 하고 싶은 일', '좋아하는 계절', '요즘 소소한 행복'
	];
</script>

<script lang="ts">
	/**
	 * 777 슬롯 한 칸 (Phase 103) — 글귀들이 위로 굴러가다 final 에 멈춘다.
	 * 연장할 때 고르는 랜덤 질문 · 연장 뒤 상대가 고른 공개("상대는 2학년!")가 같은 크기의 이 칸에 나온다.
	 * 움직임 줄이기면 굴리지 않고 바로 final.
	 */
	import { reducedMotion } from '$lib/motion';

	let { items, final, label = '' }: { items: string[]; final: string; label?: string } = $props();

	const H = 56;
	const SPIN_MS = 1500;
	// 몇 바퀴 굴린 뒤 마지막 칸에 final — 칸 수가 적으면 여러 번 이어 붙인다
	const strip = $derived.by(() => {
		const pool = items.length ? items : ['…'];
		const out: string[] = [];
		while (out.length < 14) out.push(...pool);
		return [...out.slice(0, 14), final];
	});
	let done = $state(false);

	function spin(node: HTMLElement) {
		done = false;
		if (reducedMotion()) {
			node.style.transform = `translateY(${-(strip.length - 1) * H}px)`;
			done = true;
			return;
		}
		const a = node.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-(strip.length - 1) * H}px)` }], {
			duration: SPIN_MS,
			easing: 'cubic-bezier(0.15, 0.7, 0.2, 1.04)',
			fill: 'forwards'
		});
		a.onfinish = () => (done = true);
		return { destroy: () => a.cancel() };
	}
</script>

<div class="slot" class:done role="status" aria-live="polite" aria-label={done ? `${label}${final}` : '돌아가는 중'}>
	<div class="win" aria-hidden="true">
		{#key final}
			<div class="strip" use:spin>
				{#each strip as t, i (i)}<div class="cell" class:last={i === strip.length - 1}>{t}</div>{/each}
			</div>
		{/key}
	</div>
</div>

<style>
	.slot {
		position: relative;
		order: 3;
		flex-basis: 100%;
		width: 100%;
		padding: 2px;
		border-radius: 16px;
		background: var(--accent-fill);
	}
	.win {
		position: relative;
		height: 56px;
		overflow: hidden;
		border-radius: 14px;
		background: var(--surface);
	}
	/* 위아래가 흐려지는 슬롯 창 */
	.win::before,
	.win::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 14px;
		z-index: 1;
		pointer-events: none;
	}
	.win::before {
		top: 0;
		background: linear-gradient(var(--surface), transparent);
	}
	.win::after {
		bottom: 0;
		background: linear-gradient(transparent, var(--surface));
	}
	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 56px;
		padding: 0 16px;
		font-size: 17px;
		font-weight: 650;
		text-align: center;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.done .cell.last {
		color: var(--text);
		animation: pop 0.32s ease-out;
	}
	@keyframes pop {
		50% {
			transform: scale(1.08);
		}
	}
</style>
