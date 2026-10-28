<script lang="ts">
	import { Editor } from '@tiptap/core';
	import { Fragment, Slice } from '@tiptap/pm/model';
	import { Document } from '@tiptap/extension-document';
	import { Paragraph } from '@tiptap/extension-paragraph';
	import { Text } from '@tiptap/extension-text';
	import { Bold } from '@tiptap/extension-bold';
	import { Italic } from '@tiptap/extension-italic';
	import { Underline } from '@tiptap/extension-underline';
	import { Strike } from '@tiptap/extension-strike';
	import { Highlight } from '@tiptap/extension-highlight';
	import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
	import { TextAlign } from '@tiptap/extension-text-align';
	import { Placeholder, UndoRedo } from '@tiptap/extensions';
	import { COLOR, COLOR_LABEL, HIGHLIGHT, HIGHLIGHT_LABEL, SIZE, SIZE_LABEL, fromDoc, toDoc, type LetterFmt } from './rich';
	import { untrack } from 'svelte';
	import '@fontsource/nanum-pen-script/index.css';

	/**
	 * 편지 서식 편집기 — 굵게·기울임·밑줄·취소선·형광펜·글자색·크기·정렬·되돌리기.
	 * 문단 하나 = 본문 한 줄. 붙여넣기는 글자만 받는다(다른 곳의 서식·색은 버린다).
	 * 결과는 body(순수 텍스트) + fmt(서식 범위)로 내보낸다 — 서버에는 이 둘만 간다.
	 * before · after 를 주면 글 쓰는 칸을 편지지(app.css .letter-paper)로 감싸고 그 위 · 아래에 그린다 (To. · From.)
	 */
	import type { Snippet } from 'svelte';
	let {
		body = $bindable(''),
		fmt = $bindable<LetterFmt | null>(null),
		placeholder = '',
		before,
		after
	}: { body?: string; fmt?: LetterFmt | null; placeholder?: string; before?: Snippet; after?: Snippet } = $props();

	let el: HTMLDivElement | undefined = $state();
	let editor: Editor | null = $state(null);
	let tick = $state(0);
	let panel = $state<'hl' | 'color' | 'size' | null>(null);

	$effect(() => {
		if (!el) return;
		const ed = new Editor({
			element: el,
			content: untrack(() => toDoc(body, fmt)),
			extensions: [
				Document,
				Paragraph,
				Text,
				Bold,
				Italic,
				Underline,
				Strike,
				Highlight.configure({ multicolor: true }),
				TextStyle,
				Color,
				FontSize,
				TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'] }),
				UndoRedo,
				Placeholder.configure({ placeholder })
			],
			// 바로 쓰게 커서를 두는 건 마우스 · 키보드가 있는 기기만. 폰은 두지 않는다 — 봉투 연출 동안 키보드가 올라와(찾기 칸의 키보드가 그대로 남아)
			// 화면을 반으로 줄였다. 폰에서는 편지지를 눌러야 키보드가 올라온다
			autofocus: matchMedia('(hover: hover) and (pointer: fine)').matches ? 'end' : false,
			editorProps: {
				// 글을 쓰며 커서를 따라 스크롤할 때 — 위의 머리글 · 서식 막대, 아래의 보내기 줄 밑으로 커서가 숨지 않게 그만큼 띄운다 (Phase 77)
				scrollMargin: { top: 132, bottom: 96, left: 8, right: 8 },
				scrollThreshold: { top: 132, bottom: 96, left: 8, right: 8 },
				attributes: { class: 'le-doc', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '편지 내용', spellcheck: 'false' },
				// 붙여넣기는 글자만 — 줄마다 문단으로
				handlePaste(view, event) {
					const text = event.clipboardData?.getData('text/plain');
					if (text == null) return false;
					const { schema } = view.state;
					const paras = text
						.replace(/\r\n?/g, '\n')
						.split('\n')
						.map((t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null));
					view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paras), 1, 1)).scrollIntoView());
					return true;
				}
			},
			onTransaction: () => tick++,
			onUpdate: ({ editor: e }) => {
				const r = fromDoc(e.getJSON());
				body = r.body;
				fmt = r.fmt;
			}
		});
		editor = ed;
		return () => ed.destroy();
	});

	/** 툴바 상태 — tick 을 읽어야 편집할 때마다 다시 계산된다 */
	function is(name: string | Record<string, unknown>, attrs?: Record<string, unknown>) {
		void tick;
		if (!editor) return false;
		return typeof name === 'string' ? editor.isActive(name, attrs) : editor.isActive(name);
	}
	const cmd = () => editor!.chain().focus();
	function can(what: 'undo' | 'redo') {
		void tick;
		return !!editor && (what === 'undo' ? editor.can().undo() : editor.can().redo());
	}
	const toggle = (p: typeof panel) => (panel = panel === p ? null : p);

	const hlNow = $derived.by(() => {
		void tick;
		return (Object.keys(HIGHLIGHT) as (keyof typeof HIGHLIGHT)[]).find((k) => is('highlight', { color: HIGHLIGHT[k] }));
	});
	const colorNow = $derived.by(() => {
		void tick;
		return (Object.keys(COLOR) as (keyof typeof COLOR)[]).find((k) => is('textStyle', { color: COLOR[k] }));
	});
	const sizeNow = $derived.by(() => {
		void tick;
		const v = editor?.getAttributes('textStyle').fontSize;
		return (Object.keys(SIZE) as (keyof typeof SIZE)[]).find((k) => SIZE[k] === v) ?? 'md';
	});

	/** 툴바를 눌러도 편집 영역의 선택·키보드가 유지되게 */
	const keep = (e: PointerEvent) => e.preventDefault();
	function toolbarKey(e: KeyboardEvent & { currentTarget: EventTarget & HTMLDivElement }) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
		e.preventDefault(); buttons[next]?.focus();
	}
</script>

<!-- 서식 단추는 편지지에 초점을 돌려주며 쓴다 — 키보드를 내리지 않는다 (lib/keyboard.svelte.ts) -->
<div class="le" data-keep-kb>
	<div class="bar" role="toolbar" tabindex="-1" aria-label="서식" onkeydown={toolbarKey}>
		<button class="t" class:on={is('bold')} aria-pressed={is('bold')} onpointerdown={keep} onclick={() => cmd().toggleBold().run()} aria-label="굵게" title="굵게"><b>B</b></button>
		<button class="t" class:on={is('italic')} aria-pressed={is('italic')} onpointerdown={keep} onclick={() => cmd().toggleItalic().run()} aria-label="기울임" title="기울임"><i>I</i></button>
		<button class="t" class:on={is('underline')} aria-pressed={is('underline')} onpointerdown={keep} onclick={() => cmd().toggleUnderline().run()} aria-label="밑줄" title="밑줄"><u>U</u></button>
		<button class="t" class:on={is('strike')} aria-pressed={is('strike')} onpointerdown={keep} onclick={() => cmd().toggleStrike().run()} aria-label="취소선" title="취소선"><s>S</s></button>
		<span class="sep"></span>
		<button class="t" class:on={panel === 'hl'} onpointerdown={keep} onclick={() => toggle('hl')} aria-label="형광펜" title="형광펜" aria-expanded={panel === 'hl'}>
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 4.5l5 5L10 19H5v-5l9.5-9.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
			<span class="swatch" style:background={hlNow ? HIGHLIGHT[hlNow] : HIGHLIGHT.yellow}></span>
		</button>
		<button class="t" class:on={panel === 'color'} onpointerdown={keep} onclick={() => toggle('color')} aria-label="글자색" title="글자색" aria-expanded={panel === 'color'}>
			<span class="ga" style:color={colorNow ? COLOR[colorNow] : null}>가</span>
			<span class="swatch" style:background={colorNow ? COLOR[colorNow] : 'currentColor'}></span>
		</button>
		<button class="t wide" class:on={panel === 'size'} onpointerdown={keep} onclick={() => toggle('size')} aria-label="글자 크기" title="글자 크기" aria-expanded={panel === 'size'}>
			{SIZE_LABEL[sizeNow]}
		</button>
		<span class="sep"></span>
		{#each [['left', '왼쪽 정렬', 'M4 6h16M4 10h10M4 14h16M4 18h10'], ['center', '가운데 정렬', 'M4 6h16M7 10h10M4 14h16M7 18h10'], ['right', '오른쪽 정렬', 'M4 6h16M10 10h10M4 14h16M10 18h10']] as [al, label, d] (al)}
			<button
				class="t"
				class:on={al === 'left' ? !is({ textAlign: 'center' }) && !is({ textAlign: 'right' }) : is({ textAlign: al })}
				onpointerdown={keep}
				onclick={() => (al === 'left' ? cmd().unsetTextAlign().run() : cmd().setTextAlign(al).run())}
				aria-pressed={al === 'left' ? !is({ textAlign: 'center' }) && !is({ textAlign: 'right' }) : is({ textAlign: al })}
				aria-label={label}
				title={label}
			>
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path {d} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			</button>
		{/each}
		<span class="sep"></span>
		<button class="t" onpointerdown={keep} onclick={() => cmd().undo().run()} disabled={!can('undo')} aria-label="되돌리기" title="되돌리기">
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</button>
		<button class="t" onpointerdown={keep} onclick={() => cmd().redo().run()} disabled={!can('redo')} aria-label="다시 하기" title="다시 하기">
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
		</button>
	</div>

	{#if panel}
		<div class="panel" role="group" aria-label={panel === 'hl' ? '형광펜 색' : panel === 'color' ? '글자색' : '글자 크기'}>
			{#if panel === 'hl'}
				{#each Object.entries(HIGHLIGHT) as [k, v] (k)}
					<button class="chip" class:on={hlNow === k} aria-pressed={hlNow === k} onpointerdown={keep} onclick={() => cmd().setHighlight({ color: v }).run()} aria-label="형광펜 {HIGHLIGHT_LABEL[k as keyof typeof HIGHLIGHT]}">
						<span class="dot" style:background={v}></span>{HIGHLIGHT_LABEL[k as keyof typeof HIGHLIGHT]}
					</button>
				{/each}
				<button class="chip" onpointerdown={keep} onclick={() => cmd().unsetHighlight().run()}>지우기</button>
			{:else if panel === 'color'}
				{#each Object.entries(COLOR) as [k, v] (k)}
					<button class="chip" class:on={colorNow === k} aria-pressed={colorNow === k} onpointerdown={keep} onclick={() => cmd().setColor(v).run()} aria-label="글자색 {COLOR_LABEL[k as keyof typeof COLOR]}">
						<span class="dot" style:background={v}></span>{COLOR_LABEL[k as keyof typeof COLOR]}
					</button>
				{/each}
				<button class="chip" class:on={!colorNow} aria-pressed={!colorNow} onpointerdown={keep} onclick={() => cmd().unsetColor().removeEmptyTextStyle().run()}>기본</button>
			{:else}
				{#each ['sm', 'md', 'lg', 'xl'] as const as k (k)}
					<button
						class="chip"
						class:on={sizeNow === k} aria-pressed={sizeNow === k}
						onpointerdown={keep}
						onclick={() => (k === 'md' ? cmd().unsetFontSize().removeEmptyTextStyle().run() : cmd().setFontSize(SIZE[k]).run())}
						style:font-size={k === 'md' ? null : `calc(13px * ${parseFloat(SIZE[k])})`}
					>
						{SIZE_LABEL[k]}
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	<div class="sheet" class:letter-paper={!!(before || after)}>
		{@render before?.()}
		<div class="area" bind:this={el}></div>
		{@render after?.()}
	</div>
</div>

<style>
	.le {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.bar {
		position: sticky;
		top: calc(var(--header-h) + var(--safe-top)); /* 스크롤해도 머리글 바로 아래에 붙는다 */
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 0;
		overflow-x: auto;
		scrollbar-width: none;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.bar::-webkit-scrollbar {
		display: none;
	}
	.t {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		min-width: 40px;
		height: 34px;
		padding: 0 6px;
		border-radius: var(--r-sm);
		font-size: 16px;
		color: var(--text);
		transition: transform 0.2s, background-color 0.15s;
	}
	/* 누름 44×44 — 위아래는 막대 여백, 옆은 이웃과 맞닿을 때까지 (G1) */
	.t::after {
		content: '';
		position: absolute;
		inset: -5px -2px;
	}
	.t:active:not(:disabled) {
		transform: scale(0.9);
		background: var(--field);
		transition-duration: 0.08s;
	}
	.t.wide {
		font-size: 13px;
		font-weight: 600;
	}
	.t.on {
		background: var(--field);
	}
	.t:disabled {
		opacity: 0.3;
	}
	.t svg {
		width: 20px;
		height: 20px;
	}
	.t .ga {
		font-weight: 600;
		line-height: 1;
	}
	.swatch {
		position: absolute;
		left: 9px;
		right: 9px;
		bottom: 4px;
		height: 3px;
		border-radius: 2px;
	}
	.sep {
		flex: none;
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: var(--line);
	}
	.panel {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		position: relative;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 13px;
		color: var(--text);
	}
	.chip::after {
		content: '';
		position: absolute;
		inset: -4px min(-4px, calc(50% - 22px));
	}
	.chip:active {
		transform: scale(0.95);
	}
	.chip.on {
		border-color: var(--text);
		font-weight: 600;
	}
	.chip .dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.sheet {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.sheet.letter-paper {
		margin-top: 12px;
	}
	.sheet.letter-paper .area {
		padding-top: 0;
	}
	/* 편지지 안에서는 손글씨 · 줄 맞춤 (app.css .letter-paper .le-doc) — 줄이 편지지 끝까지 보이게 넉넉한 높이.
	   글씨 크기 · 줄 간격은 설정(글자 크기 · 편지지 글씨)을 따른다 (app.css --letter-fs · --rule-h, Phase 43) */
	.sheet.letter-paper .area :global(.le-doc) {
		min-height: max(36dvh, calc(var(--rule-h) * 8));
		font-size: var(--letter-fs);
		line-height: var(--rule-h);
	}
	.sheet.letter-paper .area :global(.le-doc *) {
		line-height: inherit;
	}
	.area {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding-top: 10px;
	}
	.area :global(.le-doc) {
		flex: 1;
		min-height: 40dvh;
		outline: none;
		font-size: 16px;
		line-height: 1.7;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.area :global(.le-doc p) {
		margin: 0;
	}
	.area :global(.le-doc p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		height: 0;
		color: var(--text-2);
		pointer-events: none;
		white-space: pre-line;
	}
</style>
