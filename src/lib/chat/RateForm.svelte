<script lang="ts">
	/**
	 * 상대 평가 (Phase 30) — 표정 셋 중 하나 + 이유 칩(고른 표정에 맞는 것만) + 보내기.
	 * 대화가 끝난 화면 안에 그대로(ChatView), 또는 시트 안에(홈 카드 · 고정한 대화) 넣어 쓴다.
	 * 평가는 익명이고 다음 날 새벽에 모아서 매너 온도에 반영된다 (서버).
	 */
	import { reasonsFor, SCORES, type Reason, type Score } from '$lib/manner';

	let {
		alias,
		initial = null,
		onsubmit,
		onskip
	}: {
		alias: string;
		initial?: Score | null;
		onsubmit: (score: Score, reasons: Reason[]) => Promise<void>;
		onskip?: () => void;
	} = $props();

	let score = $state<Score | null>(null);
	let picked = $state<Reason[]>([]);
	let busy = $state(false);
	$effect.pre(() => {
		if (initial && score === null) score = initial;
	});

	function pickScore(s: Score) {
		if (s === score) return;
		// 좋았어요 ↔ 아쉬웠어요를 바꾸면 칩 종류도 바뀐다 — 서버가 섞인 칩은 받지 않는다
		if ((s === 'bad') !== (score === 'bad')) picked = [];
		score = s;
	}
	function toggle(r: Reason) {
		picked = picked.includes(r) ? picked.filter((x) => x !== r) : [...picked, r];
	}
	async function send() {
		if (!score || busy) return;
		busy = true;
		try {
			await onsubmit(score, picked);
		} finally {
			busy = false;
		}
	}
</script>

<div class="rate">
	<p class="title">{alias}님과의 대화, 어땠어요?</p>
	<div class="faces" role="radiogroup" aria-label="평가">
		{#each SCORES as s (s.k)}
			<button class="face" class:on={score === s.k} role="radio" aria-checked={score === s.k} onclick={() => pickScore(s.k)}>
				<span class="emo" aria-hidden="true">{s.face}</span>
				<span class="lbl">{s.label}</span>
			</button>
		{/each}
	</div>
	{#if score}
		<div class="chips" role="group" aria-label={score === 'bad' ? '아쉬웠던 점' : '좋았던 점'}>
			{#each reasonsFor(score) as r (r.k)}
				<button class="chip" class:on={picked.includes(r.k)} aria-pressed={picked.includes(r.k)} onclick={() => toggle(r.k)}>
					{r.label}
				</button>
			{/each}
		</div>
	{/if}
	<button aria-busy={busy} class="btn send" onclick={send} disabled={!score || busy}>{busy ? '보내는 중…' : '평가 보내기'}</button>
	{#if onskip}<button class="skip u-tap" onclick={onskip}>나중에 할게요</button>{/if}
</div>

<style>
	.rate {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 4px var(--pad) 8px;
		text-align: center;
	}
	.title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.faces {
		display: flex;
		gap: 10px;
		justify-content: center;
		width: 100%;
	}
	.face {
		flex: 1;
		max-width: 104px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 4px 10px;
		border-radius: 18px;
		background: var(--field);
		transition:
			transform 0.15s ease-out,
			background 0.15s;
	}
	.face:active {
		transform: scale(0.95);
	}
	.face.on {
		background: var(--accent-fill-deep);
		color: var(--on-accent);
	}
	.emo {
		font-size: 30px;
		line-height: 1;
	}
	.face.on .emo {
		transform: scale(1.12);
	}
	.lbl {
		font-size: 13px;
		font-weight: 600;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}
	.chip::after {
		content: '';
		position: absolute;
		inset: -4px min(-4px, calc(50% - 22px));
	}
	.chip:active {
		transform: scale(0.95);
	}
	.chip {
		position: relative;
		min-height: 36px;
		padding: 0 14px;
		transition: transform 0.15s, background-color 0.15s;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
	}
	.chip.on {
		border-color: transparent;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--accent);
	}
	.send {
		width: 100%;
		margin-top: 4px;
	}
	.skip {
		height: 44px;
		padding: 0 12px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
</style>
