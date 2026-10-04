<script lang="ts">
	/**
	 * 편지 쓰기 연출 (Phase 32 · 35 · 77) — 새 편지 · 답장이 같이 쓴다. 봉투는 늘 책상 한가운데에 놓인다 (화면 가운데가 아니라 — 우체통 · 책상을 가리지 않게).
	 *   들어올 때: 봉투가 책상 가운데로 올라와 덮개가 열리고 → 편지지가 솟아올라 → 화면 가득 펼쳐지며 편지 쓰는 칸이 된다 (봉투는 아래로 내려가 숨는다).
	 *   보낼 때: 편지지가 책상 가운데로 미끄러져 내려오며 접혀 봉투로 들어가고 → 덮개가 닫히고 → 밀랍이 떨어지고 도장이 쿵 찍힌다(진동)
	 *            → 곧장 우체통으로: 뒤집혀 주소 면(소인 "보냄")이 되며 작아져 투입구 위로 → 투입구로 쏙 → 우체통이 출렁 (Phase 71 · 77).
	 *   키보드가 올라와 편지지 머리(To. · 날짜)가 서식 막대 밑으로 밀려 올라가면 다시 내려 준다 (Phase 77 — 안드로이드 크롬이 커서 쪽으로 스크롤하며 가렸다).
	 * 편지함과 같은 장면 (Phase 72 · 73) — 위쪽 벽에 우체통이 걸려 있고 그 아래는 나무 책상. 편지지는 책상 위에 펼쳐져 우체통 앞을 덮는다.
	 * 쓰는 동안에는 봉투를 화면에서 치운다 — 휴대폰 키보드가 올라와 화면이 줄어도 편지지 · 보내기 단추를 가리지 않게 (Phase 35).
	 * 보내기 단추 줄은 화면 아래(키보드 위)에 붙는다.
	 * nickable 이면 From. 칸에 서명(닉네임)을 직접 적는다 — 비우면 anon("익명의 ○학생") 그대로.
	 * 보내기가 실패하면 쓰던 편지지로 돌아온다. 동작 줄이기면 연출 없이 바로 쓰고, 보내면 바로 끝난다.
	 */
	import { onDestroy } from 'svelte';
	import { readDraft, writeDraft, clearDraft } from '../drafts';
	import { accountToken, accountIsCurrent } from '../accountScope';
	import Envelope from './Envelope.svelte';
	import LetterEditor from './LetterEditor.svelte';
	import Postbox from './Postbox.svelte';
	import type { LetterFmt } from './rich';
	import { envWidth, play } from './stage';
	import { KB } from '../keyboard.svelte';
	import * as haptic from '../haptics';
	import { NICK_MAX, paperDate, stampDate } from './api';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 — 떠 있는지만 보면 된다
	let alive = true;
	const current = () => alive;

	let {
		to,
		draftKey = '',
		toSub = '',
		from,
		nickable = false,
		nick: nickInit = '',
		placeholder,
		onsend,
		ondone
	}: {
		to: string;
		draftKey?: string;
		toSub?: string;
		/** 서명을 안 적었을 때(또는 적을 수 없을 때)의 From. */
		from: string;
		/** 익명 쪽이면 서명을 적을 수 있다 */
		nickable?: boolean;
		/** 미리 채울 서명 (지난번에 쓴 것) */
		nick?: string;
		placeholder: string;
		/** 서버에 보낸다 — 됐으면 true (연출을 이어 간다), 안 됐으면 false (편지지로 돌아온다 · 이유는 부르는 쪽이 알린다) */
		onsend: (body: string, fmt: LetterFmt | null, nick: string | null) => Promise<boolean>;
		/** 봉투가 날아간 뒤 */
		ondone: () => void;
	} = $props();

	const MAX = 1000;
	const draftToken = accountToken();
	type Draft = { body: string; fmt: LetterFmt | null; nick: string };
	const validDraft = (v: unknown): v is Draft => !!v && typeof v === 'object' &&
		typeof (v as Draft).body === 'string' && Array.from((v as Draft).body).length <= MAX &&
		typeof (v as Draft).nick === 'string' && (v as Draft).nick.length <= NICK_MAX &&
		(!(v as Draft).fmt || typeof (v as Draft).fmt === 'object');
	// svelte-ignore state_referenced_locally
	const draft = draftKey ? readDraft(draftKey, validDraft) : null;
	let body = $state(draft?.body ?? '');
	let fmt = $state<LetterFmt | null>(draft?.fmt ?? null);
	// svelte-ignore state_referenced_locally
	let nick = $state(draft?.nick ?? nickInit);
	let sent = false;
	let editorVersion = $state(0);
	function persistDraft() {
		if (!draftKey || sent || !accountIsCurrent(draftToken)) return;
		if (body || fmt || (nick !== nickInit && nick.trim())) writeDraft(draftKey, { body, fmt, nick }, draftToken);
		else clearDraft(draftKey, draftToken);
	}
	$effect(persistDraft);
	function discardDraft() {
		clearDraft(draftKey, draftToken);
		body = ''; fmt = null; nick = ''; editorVersion++;
	}
	const len = $derived(Array.from(body).length);
	const signed = $derived(nickable && nick.trim() ? nick.trim().replace(/\s+/g, ' ') : from);

	type Phase = 'enter' | 'opened' | 'rising' | 'write' | 'fold' | 'tuck' | 'close' | 'seal' | 'aim' | 'post';
	let phase = $state<Phase>('enter');
	const w = $derived(envWidth(320));
	const now = new Date().toISOString();

	let stop = play([
		[280, () => (phase = 'opened')],
		[900, () => (phase = 'rising')],
		[1550, () => (phase = 'write')]
	]);
	onDestroy(() => {
		persistDraft();
		alive = false;
		stop();
	});

	const writing = $derived(phase === 'write');
	const sending = $derived(!['enter', 'opened', 'rising', 'write'].includes(phase));
	const ready = $derived(writing && len > 0 && len <= MAX);

	async function send() {
		if (!ready || !current()) return;
		(document.activeElement as HTMLElement | null)?.blur(); // 키보드를 내리고 연출을 보여 준다
		aimFold();
		phase = 'fold';
		const ok = await onsend(body, fmt, nickable ? nick.trim() || null : null);
		if (!current()) return;
		if (!ok) {
			phase = 'write';
			return;
		}
		sent = true;
		if (draftKey) clearDraft(draftKey, draftToken);
		stop = play([
			[450, () => (phase = 'tuck')],
			[1050, () => (phase = 'close')],
			[1650, () => (phase = 'seal')],
			// 도장이 닿는 순간 (Envelope 의 찍기 1.2s 중 45%)
			[1650 + 540, haptic.confirm],
			// 곧장 우체통으로 — 가는 동안 뒤집혀 주소 면
			[2800, aim],
			[3500, () => (phase = 'post')],
			// 봉투가 투입구로 다 들어간 순간
			[3500 + 520, () => (bump++, haptic.success())],
			[4700, () => { if (current()) ondone(); }]
		]);
	}

	// ── 보낼 때 편지지 — 쓰던 자리에서 책상 가운데(봉투가 놓일 자리)로 미끄러져 내려오며 접힌다 (Phase 77) ──
	let sheetEl = $state<HTMLElement>();
	let deskWallEl = $state<HTMLElement>();
	let fold = $state({ x: 0, y: 0, s: 0.3 });
	/** 책상 한가운데 — 봉투 자리의 가운데 (벽 아래 ~ 화면 아래의 가운데) */
	const deskCenter = () => ({ x: innerWidth / 2, y: ((deskWallEl?.getBoundingClientRect().bottom ?? innerHeight * 0.35) + innerHeight) / 2 });
	function aimFold() {
		if (!sheetEl) return;
		const r = sheetEl.getBoundingClientRect();
		const c = deskCenter();
		fold = { x: c.x - (r.left + r.width / 2), y: c.y - (r.top + r.height / 2), s: Math.min(1, (w * 0.86) / r.width) };
	}

	// ── 키보드가 올라와 편지지 머리가 서식 막대 밑으로 숨으면 되돌린다 (Phase 77) ──
	// 안드로이드 크롬은 키보드만큼 화면을 줄이며 커서 쪽으로 스크롤하는데, 붙어 있는 머리글 · 서식 막대를 모르고 편지지 머리를 그 밑으로 밀어 올렸다.
	// 커서가 편지지 위쪽에 있을 때만(짧은 글) — 커서가 보이는 만큼만 내린다. 요청 없음 · 키보드가 뜰 때 몇 번만 잰다
	function caretBox(): DOMRect | null {
		const sel = getSelection();
		if (!sel?.rangeCount) return null;
		const range = sel.getRangeAt(0);
		const r = range.getBoundingClientRect();
		if (r.height) return r;
		const n = range.startContainer;
		const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
		return el?.getBoundingClientRect() ?? null;
	}
	function keepHead() {
		if (!sheetEl || phase !== 'write') return;
		const a = document.activeElement;
		if (!a || !a.closest('.le-doc')) return;
		const bar = sheetEl.querySelector('.bar')?.getBoundingClientRect();
		const paper = sheetEl.querySelector('.letter-paper')?.getBoundingClientRect();
		if (!bar || !paper) return;
		const hidden = bar.bottom + 8 - paper.top;
		if (hidden <= 0) return;
		const floor = (sheetEl.querySelector('.foot')?.getBoundingClientRect().top ?? innerHeight) - 8;
		const c = caretBox();
		const by = Math.min(hidden, c ? Math.max(0, floor - c.bottom) : 0);
		if (by > 0) scrollBy({ top: -by, behavior: 'instant' });
	}
	$effect(() => {
		if (!KB.open) return;
		const timers = [0, 280, 650].map((t) => setTimeout(keepHead, t));
		return () => timers.forEach(clearTimeout);
	});

	// ── 우체통에 넣기 (Phase 71) — 투입구 자리를 재서 봉투를 그 위로 옮기고(작게), 그다음 봉투만 아래로 밀어 넣는다.
	// 봉투 자리(env-wrap)의 아래 가장자리가 투입구 가운데 선에 오게 — post 에서 그 선 아래는 잘려 보이지 않는다(들어간 것처럼)
	let envEl = $state<HTMLElement>();
	let slotEl = $state<Element>();
	let bump = $state(0);
	let target = $state({ x: 0, y: 0, s: 0.3 });
	function aim() {
		if (envEl && slotEl) {
			const e = envEl.getBoundingClientRect();
			const s = slotEl.getBoundingClientRect();
			const scale = Math.min(0.55, (s.width * 0.8) / e.width);
			target = {
				x: s.left + s.width / 2 - (e.left + e.width / 2),
				y: s.top + s.height / 2 - (e.height * scale) / 2 - (e.top + e.height / 2),
				s: scale
			};
		}
		phase = 'aim';
	}

	// 봉투 상태 — 단계마다
	const side = $derived(['aim', 'post'].includes(phase) ? 'front' : 'back');
	const open = $derived(['opened', 'rising', 'write', 'fold', 'tuck'].includes(phase));
	const paperPos = $derived(phase === 'rising' || phase === 'fold' || phase === 'write' ? 'out' : 'in');
	const sealed = $derived(['seal', 'aim', 'post'].includes(phase));
	const posting = $derived(['aim', 'post'].includes(phase));

</script>


<div class="compose" data-phase={phase}>
	<div class="desk" aria-hidden="true"><i class="wall" bind:this={deskWallEl}></i><i class="wood"></i></div>

	<div class="sheet-wrap" class:shown={writing || phase === 'fold'} aria-hidden={!writing} bind:this={sheetEl} style:--fx="{fold.x}px" style:--fy="{fold.y}px" style:--fs={fold.s}>
		{#key editorVersion}
		<LetterEditor bind:body bind:fmt {placeholder}>
			{#snippet before()}
				<div class="lp-head">
					<p class="lp-to">To. {to}{#if toSub}<small>{toSub}</small>{/if}</p>
					<time class="lp-date">{paperDate(now)}</time>
				</div>
			{/snippet}
			{#snippet after()}
				{#if nickable}
					<label class="lp-from sign">
						<span>From.</span>
						<input
							class="nick"
							bind:value={nick}
							maxlength={NICK_MAX}
							placeholder={from}
							aria-label="서명 — 받는 사람에게 보일 이름 (비우면 {from})"
							autocomplete="off"
							enterkeyhint="done"
						/>
					</label>
					<p class="sign-hint">서명을 비우면 <b>{from}</b>(으)로 보여요 · 연락처나 실명은 적지 마세요</p>
					<p class="sign-hint">상대에게는 내 성별·서명·본문이 보여요. 글 내용으로 나를 짐작할 수도 있어요. <a href="/legal/privacy">권한 있는 운영자는 신원과 내용을 볼 수 있어요.</a></p>
				{:else}
					<p class="lp-from">From. {from}</p>
				{/if}
			{/snippet}
		</LetterEditor>
		{/key}
		<!-- iOS 는 키보드가 올라와도 화면(레이아웃)이 줄지 않는다 — 키보드 높이(--kb, lib/keyboard.svelte.ts)만큼 보내기 줄을 올린다 -->
		<div class="foot">
			{#if draftKey}<button onclick={discardDraft} disabled={!writing || sending}>초안 버리기</button>{/if}
			<span class="num" class:over={len > MAX}>{len > MAX ? `${len - MAX}자 넘음 · ` : ''}{len}/{MAX}</span>
			<button class="btn send" onclick={send} disabled={!ready}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7-7-1z" fill="currentColor" /></svg>
				봉투에 넣어 보내기
			</button>
		</div>
	</div>

	<!-- 빨간 우체통 — 화면 위쪽. 편지지가 그 앞을 덮는다 -->
	<div class="post" aria-hidden="true">
		<Postbox bind:slot={slotEl} {bump} />
	</div>

	<div class="env-wrap" style:--w="{w}px" style:--tx="{target.x}px" style:--ty="{target.y}px" style:--ts={target.s} bind:this={envEl}>
		<div class="env-inner">
			<Envelope
				{to}
				{toSub}
				from={signed}
				date={stampDate(now)}
				{side}
				{open}
				paper={paperPos}
				{sealed}
				stamping={phase === 'seal'}
				postmark="보냄"
				{body}
				{w}
			/>
		</div>
	</div>

	{#if sending}<p class="status" aria-live="polite">{phase === 'post' ? '우체통에 쏙! 편지가 출발했어요' : posting ? '우체통에 넣는 중…' : '봉투에 담는 중…'}</p>{/if}
</div>

<style>
	.compose {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - var(--header-h) - var(--safe-top));
		/* clip — hidden 이면 이 칸이 스크롤 상자가 되어 서식 막대(sticky)가 어긋난다 */
		overflow-x: clip;
	}
	/* 편지를 쓰는 동안 페이지가 입력칸 · 커서 쪽으로 스크롤할 때(키보드가 뜰 때 등) 머리글 · 서식 막대 · 보내기 줄 밑으로 숨기지 않게 */
	:global(html:has(.compose[data-phase='write'])) {
		scroll-padding-top: calc(var(--header-h) + var(--safe-top) + 72px);
		scroll-padding-bottom: 88px;
	}
	/* 벽(우체통이 걸린 곳) + 나무 책상 — 편지함과 같은 장면 */
	.compose {
		--mb-w: min(72vw, 270px);
		--wall-h: calc(var(--header-h) + var(--safe-top) + 30px + var(--mb-w) * 0.7 + 22px);
	}
	.desk {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		pointer-events: none;
	}
	.desk .wall {
		flex: none;
		height: var(--wall-h);
		background: var(--wall);
	}
	.desk .wood {
		flex: 1;
		background: var(--wood);
		border-top: 2px solid rgb(255 255 255 / 0.35);
		box-shadow: inset 0 14px 16px -12px var(--wood-shade);
	}

	/* ── 봉투 자리: 책상 한가운데 (Phase 77 — 화면 가운데였을 땐 우체통 · 책상을 가렸다).
	   들어올 때 올라와 앉고 → 쓰는 동안은 화면 아래로 내려가 숨는다 → 보낼 때 다시 올라와 편지지를 받고 → 곧장 우체통으로 ── */
	.env-wrap {
		position: fixed;
		perspective: 1400px;
		left: 50%;
		top: calc((var(--wall-h) + 100dvh) / 2);
		width: var(--w);
		margin-left: calc(var(--w) / -2);
		margin-top: calc(var(--w) * -0.31);
		transition:
			transform 0.7s cubic-bezier(0.3, 0.8, 0.25, 1),
			opacity 0.45s ease;
		z-index: 2;
		pointer-events: none;
	}
	[data-phase='enter'] .env-wrap {
		animation: rise-in 0.75s cubic-bezier(0.2, 0.9, 0.25, 1.08) both;
	}
	@keyframes rise-in {
		from {
			transform: translateY(70vh) rotate(-9deg) scale(0.9);
		}
	}
	/* 쓰는 동안 — 키보드 · 편지지와 겹치지 않게 화면 밖(아래)으로 */
	[data-phase='write'] .env-wrap {
		transform: translateY(80vh) rotate(4deg) scale(0.8);
		opacity: 0;
		transition-duration: 0.55s, 0.35s;
	}
	/* 편지지를 접으면 봉투가 다시 가운데로 올라와 받는다 */
	[data-phase='fold'] .env-wrap {
		transition-delay: 0.05s;
	}
	/* 우체통 투입구 위로 — 작아지며 옮겨 간다 (자리는 aim() 이 잰다) */
	[data-phase='aim'] .env-wrap,
	[data-phase='post'] .env-wrap {
		transform: translate(var(--tx), var(--ty)) scale(var(--ts));
		transition-duration: 0.62s;
		transition-timing-function: cubic-bezier(0.35, 0.8, 0.3, 1);
	}
	/* 투입구로 쏙 — 봉투 자리의 아래 가장자리(= 투입구 가운데 선) 밑은 잘라 보이지 않게 하고, 봉투만 아래로 민다 */
	[data-phase='post'] .env-wrap {
		clip-path: polygon(-100vw -100vh, 200vw -100vh, 200vw 100%, -100vw 100%);
	}
	.env-inner {
		transition: transform 0.5s cubic-bezier(0.55, 0, 0.8, 0.35);
	}
	[data-phase='post'] .env-inner {
		transform: translateY(104%);
	}

	/* ── 빨간 우체통 — 화면 위쪽, 편지함과 같은 납작한 네모 (들어올 때 위에서 살짝 내려온다) ── */
	.post {
		position: fixed;
		left: 50%;
		top: calc(var(--header-h) + var(--safe-top) + 30px);
		z-index: 1;
		width: var(--mb-w);
		translate: -50% 0;
		pointer-events: none;
		animation: post-in 0.5s cubic-bezier(0.25, 0.9, 0.3, 1.05) both;
	}
	@keyframes post-in {
		from {
			opacity: 0;
			transform: translateY(-24px);
		}
	}
	/* 쓰는 동안은 숨긴다 (Phase 80) — 화면에 붙어 있어 키보드를 올리고 스크롤하면 서식 막대 아래 색 고르기 줄 · 편지지 사이로 비쳐 겹쳐 보였다.
	   편지지를 접기 시작하면 다시 나타나 봉투를 받는다 */
	.post :global(.postbox) {
		transition: opacity 0.3s ease;
	}
	[data-phase='write'] .post :global(.postbox) {
		opacity: 0;
	}

	/* ── 편지지(쓰는 칸) — 봉투에서 솟아올라 펼쳐진다 ── */
	.sheet-wrap {
		position: relative;
		z-index: 3;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px var(--pad) 0;
		opacity: 0;
		transform: translateY(40%) scale(0.55);
		transform-origin: 50% 100%;
		transition:
			transform 0.6s cubic-bezier(0.22, 0.9, 0.25, 1),
			opacity 0.4s ease;
		pointer-events: none;
	}
	.sheet-wrap.shown {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}
	/* 보낼 때 — 책상 가운데(봉투 자리)로 미끄러져 내려오며 접힌다 (자리는 aimFold() 가 잰다) */
	[data-phase='fold'] .sheet-wrap {
		opacity: 0;
		transform: translate(var(--fx), var(--fy)) scale(var(--fs), calc(var(--fs) * 0.45));
		transform-origin: 50% 50%;
		transition:
			transform 0.6s cubic-bezier(0.45, 0, 0.3, 1),
			opacity 0.35s 0.3s ease;
		pointer-events: none;
	}
	/* 편지지만 접혀 내려간다 — 서식 막대 · 보내기 줄은 먼저 사라진다 */
	[data-phase='fold'] .foot,
	[data-phase='fold'] :global(.le .bar) {
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	/* 보내기 줄 — 화면 아래(키보드 바로 위)에 붙는다 */
	.foot {
		position: sticky;
		bottom: var(--kb, 0px);
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 0 calc(var(--pad) * -1);
		padding: 10px var(--pad) calc(10px + env(safe-area-inset-bottom));
		/* 책상 위라 판자색 받침 */
		background: linear-gradient(to top, var(--wood-base) 55%, color-mix(in srgb, var(--wood-base) 0%, transparent));
		font-size: 12px;
		color: var(--wood-ink);
	}
	/* 키보드가 떠 있을 때는 홈 인디케이터 여백이 필요 없다 */
	:global(html.kb-open) .foot {
		padding-bottom: 10px;
	}
	.over {
		color: var(--danger);
	}
	.send {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: auto;
		height: 50px;
		padding: 0 20px;
		font-size: 17px;
	}
	.send svg {
		width: 16px;
		height: 16px;
	}
	/* 서명 칸 — 손글씨 From. 줄에 그대로 적는다 */
	.sign {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 8px;
	}
	.nick {
		width: 9.5em;
		min-width: 0;
		padding: 0 2px 2px;
		border: 0;
		border-bottom: 1.5px dashed color-mix(in srgb, var(--paper-ink) 35%, transparent);
		background: none;
		color: inherit;
		font: inherit;
		text-align: right;
		outline: none;
	}
	.nick::placeholder {
		color: color-mix(in srgb, var(--paper-ink) 45%, transparent);
	}
	.nick:focus {
		border-bottom-color: var(--accent);
	}
	.sign-hint {
		margin: 4px 0 0;
		text-align: right;
		font-size: 11px;
		opacity: 0.6;
	}
	/* 안내 글 — 책상 윗머리 (봉투는 책상 가운데, 우체통은 벽) */
	.status {
		position: fixed;
		left: 0;
		right: 0;
		top: calc(var(--wall-h) + 16px);
		margin: 0;
		text-align: center;
		font-size: 14px;
		font-weight: 700;
		color: var(--wood-ink);
		z-index: 2;
	}
</style>
