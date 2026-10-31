<script lang="ts">
	/**
	 * 편지로 답장 (Phase 32) — 받은 편지 한 통에. 봉투 연출은 새 편지와 같다 (EnvelopeCompose).
	 *  · 모르는 사람의 편지에 답장: To. 익명의 ○학생 · From. 내 이름 (그 사람은 이미 내 이름을 안다)
	 *  · 내 편지에 온 답장에 다시 답장: To. 그 사람 이름 · From. 익명의 나 — 서명을 적을 수 있다 (지난번 서명을 미리 채움, Phase 35)
	 * 보내면 보낸 편지함으로.
	 */
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import BackButton from '$lib/ui/BackButton.svelte';
	import LoadError from '$lib/ui/LoadError.svelte';
	import EnvelopeCompose from '$lib/letters/EnvelopeCompose.svelte';
	import type { LetterFmt } from '$lib/letters/rich';
	import { anonName, fromLabel, openLetter, replyToLetter, type Letter } from '$lib/letters/api';
	import { afterSent, deliver } from '$lib/letters/send';
	import { S, errMsg } from '$lib/state.svelte';
	// 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다 ({#key S.accountVersion}) — 떠 있는지만 보면 된다
	let alive = true;
	onDestroy(() => (alive = false));
	const current = () => alive;

	const id = $derived(Number(page.params.id));
	const back = $derived(`/letters/m/${id}`);
	let letter = $state<Letter | null>(null);
	let gone = $state(false);
	// 못 가져왔다(네트워크) — 빈 화면에 머물지 않고 이유와 다시 시도 (UX G4)
	let failed = $state<string | null>(null);
	let attempt = $state(0);

	$effect(() => {
		const target = id;
		void attempt;
		let active = true;
		letter = null;
		gone = false;
		failed = null;
		void (async () => {
			try {
				const r = await openLetter(target);
				if (!active || !current()) return;
				if (r.status !== 'ok' || r.role !== 'received' || !r.can_reply) gone = true;
				else letter = r;
			} catch (e) {
				if (active && current()) failed = errMsg(e);
			}
		})();
		return () => { active = false; };
	});

	// 내가 익명 쪽(이름으로 보낸 사람의 답장에 다시 답장)이면 서명을 적을 수 있다
	const anonSide = $derived(!!letter?.from_name);
	const from = $derived(anonSide ? anonName(S.profile?.gender) : (S.me?.name ?? '나'));

	const send = (body: string, fmt: LetterFmt | null, nick: string | null) =>
		current() && letter ? deliver(() => replyToLetter(letter!.id, body, fmt, nick)) : Promise.resolve(false);
</script>

<div class="topbar">
	<BackButton href={back} history />
	<span class="title">답장 쓰기</span>
</div>

{#if gone}
	<div class="page"><p class="muted center">답장할 수 없는 편지예요</p></div>
{:else if failed}
	<div class="page"><LoadError msg={failed} onretry={() => attempt++} /></div>
{:else if letter}
	<EnvelopeCompose
		draftKey={`letter:reply:${letter.id}`}
		to={fromLabel(letter)}
		{from}
		nickable={anonSide}
		nick={letter.my_nick ?? ''}
		placeholder={'받은 편지에 답장을 적어 보세요.\n답장도 봉투에 담겨 전해져요.'}
		onsend={send}
		ondone={() => { if (current()) afterSent('답장을 보냈어요'); }}
	/>
{:else}
	<div class="page"><p class="muted center" role="status">편지를 가져오는 중…</p></div>
{/if}

<style>
	.center {
		margin: 48px auto;
		text-align: center;
	}
</style>
