<script lang="ts">
	/**
	 * 개발 전용 — 대화 봇 화면 미리보기. 가짜 서버로 상태를 재현한다 (계정 · Workers AI 불필요).
	 *
	 *   /dev/bot   (&turns=2 턴 한도, &short 20초 뒤 시간 끝, &down AI 오류, &fast 기다리는 시간 1/20 — 화면 테스트용)
	 *
	 * 봇 답은 "봇 답: <내 말>" (여러 줄이면 말풍선도 여러 개). 전화번호는 규칙 필터처럼 막힌다.
	 * 배포 빌드에서는 dev/+layout.ts 가 404 로 막는다.
	 */
	import { page } from '$app/state';
	import BotChat from '$lib/bot/BotChat.svelte';
	import type { BotApi, BotStart, Line } from '$lib/bot/api';

	const q = page.url.searchParams;
	const maxTurns = Number(q.get('turns') ?? 30);
	let used = 0;
	let closed = $state(false);
	/** 서버가 받은 기록 — 테스트가 연달아 보낸 말을 한 번에 보냈는지 본다 */
	const sent: Line[][] = [];

	const now = Date.now();
	const chat: BotStart = {
		status: 'ok',
		id: '00000000-0000-4000-8000-000000000000',
		expires_at: new Date(now + (q.has('short') ? 20_000 : 600_000)).toISOString(),
		turns: 0,
		max_turns: maxTurns,
		left_today: 2,
		server_now: new Date(now).toISOString()
	};

	const api: BotApi = {
		async start() {
			return chat;
		},
		async turn(_id, lines) {
			sent.push(lines);
			(window as unknown as { __botSent: unknown }).__botSent = sent;
			await new Promise((r) => setTimeout(r, Number(q.get('delay') ?? 300)));
			const tail: string[] = [];
			for (let i = lines.length - 1; i >= 0 && lines[i].role === 'user'; i--) tail.unshift(lines[i].content);
			const text = tail.join('\n');
			if (/01[016789]\d{7,8}/.test(text.replace(/[\s.-]/g, ''))) return { status: 'blocked', code: 'personal_info' };
			if (q.has('down')) return { status: 'ai_unavailable' };
			if (q.has('network')) return { status: 'network' };
			used++;
			return { status: 'ok', reply: `봇 답: ${text}`, turns: used, max_turns: maxTurns };
		}
	};

</script>

{#if import.meta.env.DEV}
	{#if closed}
		<p class="closed">닫힘</p>
	{:else}
		<BotChat {chat} {api} alias="새벽수달" seeking="0:42" speed={q.has('fast') ? 0.05 : 1} onclose={() => (closed = true)} />
	{/if}
{/if}
