<script lang="ts">
	/**
	 * 대화 봇 (Phase 43 — 예전 "AI 와 얘기하기" 창을 대신한다).
	 * 상대를 찾는 동안 학생이 AI 대화 버튼을 눌러 연다. 공통 레이아웃이 사람 찾기를 계속하고,
	 * 사람을 찾으면 대화방으로 넘어가면서 이 창도 같이 사라진다.
	 *
	 * 익명 채팅에서 처음 만난 또래처럼 — 먼저 짧게 인사하고, 내 말을 읽고(읽음) → 잠깐 생각하고 → "입력 중…" →
	 * 짧은 말풍선 한두 개. 연달아 보낸 말은 다 읽고 한 번에 답한다 (lib/bot/persona.ts).
	 *
	 * ★ 사람인 척하지 않는다: 이름 옆 "봇" 표시 · 첫 안내 줄 · 봇이냐고 물으면 봇이라고 답한다(server/aiChat.ts 프롬프트).
	 *   이용자가 학생(미성년)이고, AI 기본법(2026-01 시행)은 생성형 AI 로 운용되는 서비스라는 걸 미리 알리게 한다.
	 * 대화 내용은 이 화면의 메모리에만 있다 (닫으면 사라지고, 서버 · DB 에 남기지 않는다).
	 */
	import { onMount, tick, untrack } from 'svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import MessageInput from '$lib/ui/MessageInput.svelte';
	import Starters from '$lib/chat/Starters.svelte';
	import { S, errMsg, toast } from '$lib/state.svelte';
	import { mmss as fmtClock } from '$lib/time';
	import { scrollBehavior } from '$lib/motion';
	import { focustrap } from '$lib/focustrap';
	import { backClose } from '$lib/overlay.svelte';
	import { botApi, type BotApi, type BotStart } from './api';
	import { requestTurn, snapshotTurn, type ChatLine as Line } from './conversation';
	import { GOODBYES, GREETINGS, NUDGES, NUDGE_AFTER_MS, REPLY_AFTER_MS, pick, rand, splitReply, typeMs } from './persona';

	let {
		chat,
		alias,
		onclose,
		seeking = null,
		api = botApi,
		speed = 1
	}: {
		/** ai_chat_start 결과 — 홈이 먼저 받아 두고 연다 (한도가 없으면 창을 띄우지 않는다) */
		chat: BotStart;
		/** 봇의 익명 이름 */
		alias: string;
		onclose: () => void;
		/** 사람을 찾는 중이면 걸린 시간 (mm:ss) */
		seeking?: string | null;
		api?: BotApi;
		/** 개발 미리보기 · 테스트에서 기다리는 시간을 줄인다 (1 = 실제) */
		speed?: number;
	} = $props();
	// 저절로 뜨는 창 — 안드로이드 뒤로가기로 닫힌다 (창 하나 = 기록 한 칸, lib/overlay.svelte.ts)
	backClose(() => onclose(), { auto: true });

	const NOTICE = '직접 선택해 시작한 AI 대화예요. 실제 학생이 아니에요. 사람을 찾는 중이라면 연결될 때 대화방으로 이동해요';

	let lines = $state<Line[]>([]);
	let phase = $state<'live' | 'ended'>('live');
	let typing = $state(false);
	/** 봇이 읽은 내 말 (id 까지) — 그 아래 "읽음" */
	let readUpTo = $state(0);
	let draft = $state('');
	let spoken = $state(''); // 화면 낭독기 — 봇의 새 말
	let listEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLTextAreaElement | undefined = $state();

	let seq = 0;
	/** 봇이 답한(또는 답하는 중인) 내 말 (id 까지) */
	let answeredUpTo = 0;
	let requestUpTo = -1;
	let requestId = '';
	let busy = false;
	/** 자동 재시도는 한 번만 — 연결 실패 후에는 사용자가 다시 보내야 한다. */
	let retryPaused = false;
	let alive = true;
	let replyTimer: ReturnType<typeof setTimeout> | undefined;
	let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
	// 서버 시계 기준 (skew 보정) — 판정은 서버(ai_chat_turn)가 한다, 여기는 표시 · 끝 안내용
	const clock = $derived({ skew: Date.parse(chat.server_now) - Date.now(), expiresAt: Date.parse(chat.expires_at) });

	const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * speed));
	const unanswered = () => lines.some((l) => l.who === 'me' && l.id > answeredUpTo);

	async function scrollDown() {
		await tick();
		listEl?.scrollTo({ top: listEl.scrollHeight, behavior: scrollBehavior() });
	}
	function say(who: Line['who'], text: string) {
		lines.push({ id: ++seq, who, text });
		if (who === 'bot') spoken = `${alias}: ${text}`;
		void scrollDown();
	}

	/** 봇이 말풍선을 하나씩 — 칠 만큼 "입력 중…"을 보이고 나서. typedFor = 이미 입력 중을 보인 시간(답을 기다리는 동안) */
	async function botSays(bubbles: string[], typedFor = 0) {
		for (const [i, b] of bubbles.entries()) {
			if (i) {
				typing = false;
				await sleep(rand(250, 700));
			}
			typing = true;
			void scrollDown();
			await sleep(Math.max(0, typeMs(b) - (i ? 0 : typedFor / speed)));
			if (!alive || phase !== 'live') return;
			typing = false;
			say('bot', b);
		}
	}

	function end(msg: string) {
		if (phase === 'ended') return;
		phase = 'ended';
		typing = false;
		clearTimeout(replyTimer);
		clearTimeout(nudgeTimer);
		say('sys', msg);
	}

	onMount(() => {
		void (async () => {
			say('sys', NOTICE);
			await sleep(rand(1200, 2400));
			if (!alive || busy || unanswered()) return; // 내가 먼저 말했으면 인사 대신 답
			busy = true;
			await botSays(pick(GREETINGS));
			busy = false;
			if (!alive) return;
			if (unanswered()) scheduleReply();
			else nudgeTimer = setTimeout(nudge, NUDGE_AFTER_MS * speed);
		})();
		return () => {
			alive = false;
			clearTimeout(replyTimer);
			clearTimeout(nudgeTimer);
		};
	});

	/** 인사하고도 조용하면 가벼운 질문 하나 (한 번만) */
	async function nudge() {
		if (!alive || busy || phase !== 'live' || lines.some((l) => l.who === 'me') || draft.trim()) return;
		busy = true;
		await botSays([pick(NUDGES)]);
		busy = false;
		if (unanswered()) scheduleReply();
	}

	// ── 시간 ──
	const remainMs = $derived(Math.max(0, clock.expiresAt - (S.now + clock.skew)));
	$effect(() => {
		if (remainMs <= 0) untrack(() => end('대화 봇과 이야기할 시간이 끝났어요'));
	});

	// ── 내가 보내기 ──
	function send() {
		const text = draft.trim();
		if (!text || phase !== 'live') return;
		if (text.length > 500) return toast('500자까지 보낼 수 있어요');
		draft = '';
		retryPaused = false;
		clearTimeout(nudgeTimer);
		say('me', text);
		inputEl?.focus();
		// 읽음은 조금 뒤에 (보고 있던 사람처럼)
		const id = seq;
		setTimeout(() => alive && (readUpTo = Math.max(readUpTo, id)), rand(500, 1800) * speed);
		scheduleReply();
	}

	/** 내가 말을 멈추면 답한다 — 이어서 치는 중이면 조금 더 기다린다 */
	function scheduleReply() {
		if (!alive || busy || retryPaused || phase !== 'live') return;
		clearTimeout(replyTimer);
		replyTimer = setTimeout(() => void reply(), rand(...REPLY_AFTER_MS) * speed);
	}
	function onInput() {
		if (unanswered()) scheduleReply();
	}

	async function reply() {
		if (busy || phase !== 'live' || !alive || !unanswered()) return;
		busy = true;
		try {
			await sleep(rand(400, 1200)); // 읽고 잠깐 생각
			if (!alive || phase !== 'live') return;
			const { batch, upTo, history } = snapshotTurn(lines, answeredUpTo);
			if (requestUpTo !== upTo) { requestUpTo = upTo; requestId = crypto.randomUUID(); }
			readUpTo = Math.max(readUpTo, upTo);
			typing = true;
			void scrollDown();
			const t0 = Date.now();
			const r = await requestTurn(api, chat.id, history, {
				requestId,
				isActive: () => alive && phase === 'live',
				wait: () => sleep(3000),
				onRetry: (waiting) => { typing = !waiting; }
			});
			if (!r) return;

			switch (r.status) {
				case 'ok':
					answeredUpTo = upTo;
					await botSays(splitReply(r.reply), Date.now() - t0);
					if (r.turns >= r.max_turns) {
						await botSays(pick(GOODBYES));
						end('대화 봇이 나갔어요');
					}
					break;
				case 'blocked': {
					// 규칙 필터(신상정보 · 금칙어)에 막힘 — 봇에게 가지 않았다. 말풍선을 거두고 글을 입력창에 돌려준다
					typing = false;
					const ids = new Set(batch.map((l) => l.id));
					lines = lines.filter((l) => !ids.has(l.id));
					if (!draft) draft = batch.map((l) => l.text).join('\n');
					toast(errMsg(r.code));
					break;
				}
				case 'turns':
					await botSays(pick(GOODBYES), Date.now() - t0);
					end('대화 봇이 나갔어요');
					break;
				case 'expired':
					end('대화 봇과 이야기할 시간이 끝났어요');
					break;
				case 'ai_unavailable':
				case 'network':
				case 'pending':
					typing = false;
					if (r.status === 'ai_unavailable') end('대화 봇이 지금은 답할 수 없어요');
					else {
						retryPaused = true;
						toast('연결을 확인해 주세요 · 다시 보내면 봇이 답해요');
					}
					break;
				default:
					end('지금은 대화 봇을 쓸 수 없어요');
			}
		} finally {
			typing = false;
			busy = false;
			if (alive && phase === 'live' && unanswered()) scheduleReply();
		}
	}

	// ── 그리기 ──
	/** 같은 쪽이 연달아 보낸 말은 한 묶음 (대화방과 같은 모서리) */
	function pos(i: number) {
		const w = lines[i].who;
		return { first: lines[i - 1]?.who !== w, last: lines[i + 1]?.who !== w };
	}
	const lastMine = $derived(lines.findLast((l) => l.who === 'me')?.id ?? 0);
	const showStarters = $derived(phase === 'live' && !draft && !lines.some((l) => l.who === 'me'));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="bot" role="dialog" aria-modal="true" aria-label="대화 봇과 대화" tabindex="-1" use:focustrap>
	<header class="topbar">
		<BackButton onclick={onclose} label="대화 봇 닫기" />
		<div class="who">
			<Avatar name={alias} size={32} online={phase === 'live'} />
			<span class="names">
				<span class="alias">{alias}<span class="tag">봇</span></span>
				<span class="sub">
					{#if typing}입력 중…{#if seeking} · {/if}{/if}{#if seeking}사람 찾는 중 <span class="num">{seeking}</span>{:else if !typing}대화 봇{/if}
				</span>
			</span>
		</div>
		{#if phase === 'live'}
			<span class="timer num" aria-label="남은 시간 {fmtClock(Math.ceil(remainMs / 1000), true)}">{fmtClock(Math.ceil(remainMs / 1000), true)}</span>
		{/if}
	</header>

	<div class="sr-only" aria-live="polite">{spoken}</div>
	<div class="list" bind:this={listEl} role="region" aria-label="대화 내용">
		<div class="intro">
			<Avatar name={alias} size={72} online={phase === 'live'} />
			<h2>{alias}<span class="tag">봇</span></h2>
			<p>사람을 찾을 때까지 이야기하는 대화 봇</p>
		</div>
		{#each lines as l, i (l.id)}
			{#if l.who === 'sys'}
				<p class="sys">{l.text}</p>
			{:else}
				{@const p = pos(i)}
				<div class="row" class:mine={l.who === 'me'} class:gap={p.first}>
					<div class="bubble selectable" class:first={p.first} class:last={p.last}>
						<span class="sr-only">{l.who === 'me' ? '나' : alias}: </span>{l.text}
					</div>
				</div>
				{#if l.who === 'me' && l.id === lastMine && readUpTo >= l.id}
					<div class="seen">읽음</div>
				{/if}
			{/if}
		{/each}
		{#if typing}
			<div class="row gap">
				<div class="bubble first last typing" aria-label="{alias} 님이 입력 중"><i></i><i></i><i></i></div>
			</div>
		{/if}
	</div>

	<div class="composer" data-keep-kb>
		{#if phase === 'live'}
			{#if showStarters}
				<Starters roomId={chat.id} onpick={(t) => ((draft = t), inputEl?.focus())} />
			{/if}
			<MessageInput bind:value={draft} bind:el={inputEl} placeholder="메시지 보내기…" maxlength={500} canSend={!!draft.trim()} oninput={onInput} onsubmit={send} />
		{:else}
			<button class="btn" onclick={onclose}>닫고 계속 찾기</button>
		{/if}
	</div>
</div>

<style>
	.bot {
		position: fixed;
		/* 보이는 영역에 딱 맞춘다 — 아이폰에서 키보드가 올라와도 머리글이 밀려 올라가지 않고 입력 줄이 키보드 위에 (Phase 41, lib/keyboard.svelte.ts) */
		top: 0;
		left: 50%;
		width: 100%;
		max-width: 520px;
		height: var(--vvh, 100dvh);
		transform: translate(-50%, var(--vv-top, 0px));
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		outline: none;
		animation: up 0.28s cubic-bezier(0.2, 0.8, 0.3, 1);
	}
	@keyframes up {
		from {
			opacity: 0;
			translate: 0 24px;
		}
	}
	@media (min-width: 560px) {
		.bot {
			border-inline: 1px solid var(--line);
		}
	}
	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		min-height: 44px;
	}
	.names {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}
	.alias {
		font-weight: 700;
		font-size: 15px;
		white-space: nowrap;
	}
	.sub {
		font-size: 12px;
		color: var(--text-2);
	}
	/* "봇" 표시 — 사람인 척하지 않는다 */
	.tag {
		display: inline-block;
		margin-left: 5px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--field);
		color: var(--text-2);
		font-size: 11px;
		font-weight: 700;
		vertical-align: 2px;
	}
	.timer {
		margin-left: auto;
		font-size: 15px;
		font-weight: 700;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 12px var(--pad) 8px;
		display: flex;
		flex-direction: column;
	}
	.intro {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 16px 0 4px;
		text-align: center;
	}
	.intro h2 {
		margin: 8px 0 0;
		font-size: 19px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.intro p {
		margin: 0;
		font-size: 13px;
		color: var(--text-2);
	}
	.sys {
		align-self: center;
		max-width: 85%;
		margin: 14px 0 10px;
		text-align: center;
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.row {
		display: flex;
		margin-top: 2px;
	}
	.row.gap {
		margin-top: 8px;
	}
	.row.mine {
		justify-content: flex-end;
	}
	.bubble {
		max-width: 75%;
		padding: 8px 13px;
		border-radius: var(--r-bubble);
		background: var(--field);
		color: var(--text);
		font-size: 15px;
		line-height: 1.38;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		animation: pop 0.18s ease-out;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
	}
	.row:not(.mine) .bubble:not(.first) {
		border-top-left-radius: 4px;
	}
	.row:not(.mine) .bubble:not(.last) {
		border-bottom-left-radius: 4px;
	}
	.mine .bubble {
		background: var(--bubble-fill);
		color: var(--on-accent);
	}
	.mine .bubble:not(.first) {
		border-top-right-radius: 4px;
	}
	.mine .bubble:not(.last) {
		border-bottom-right-radius: 4px;
	}
	.seen {
		align-self: flex-end;
		margin-top: 3px;
		font-size: 11px;
		color: var(--text-2);
	}
	.typing {
		display: flex;
		gap: 4px;
		padding: 13px 14px;
	}
	.typing i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-2);
		animation: blink 1.2s infinite;
	}
	.typing i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		60%,
		100% {
			opacity: 0.25;
		}
		30% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bot,
		.bubble {
			animation: none;
		}
	}
	.composer {
		padding: 8px var(--pad) calc(8px + env(safe-area-inset-bottom));
		background: var(--bg);
	}
	/* 키보드가 떠 있을 때는 홈 인디케이터 여백이 필요 없다 */
	:global(html.kb-open) .composer {
		padding-bottom: 8px;
	}
	.composer .btn {
		width: 100%;
	}
</style>
