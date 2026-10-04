<script lang="ts">
	/**
	 * 대화방 화면 — ChatRoom 상태만 읽어서 그린다.
	 * 실제 방(/chat)과 개발용 미리보기(/dev/chat)가 같은 컴포넌트를 쓴다.
	 */
	import * as haptic from '$lib/haptics';
	import { KB } from '$lib/keyboard.svelte';
	import { tick, untrack } from 'svelte';
	import { S, errMsg, toast } from '$lib/state.svelte';
	import type { ChatRoom } from './room.svelte';
	import type { Msg, PartnerProfile, ReactionKey } from './types';
	import ChatIntro from './ChatIntro.svelte';
	import PartnerCard from './PartnerCard.svelte';
	import ReactionBadge from './ReactionBadge.svelte';
	import ReactionPicker from './ReactionPicker.svelte';
	import ReplyQuote from './ReplyQuote.svelte';
	import Starters from './Starters.svelte';
	import MatchScreen from './MatchScreen.svelte';
	import ChatHeader from './ChatHeader.svelte';
	import Banner from './Banner.svelte';
	import VoteBanner, { isQuestion } from './VoteBanner.svelte';
	import RateForm from './RateForm.svelte';
	import type { Reason, Score } from '$lib/manner';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { pressGestures, swipeReply } from './gestures';
	import { summarize } from './reactions';
	import MessageInput from '$lib/ui/MessageInput.svelte';
	import RoomActions, { type RoomActionFns, type RoomStep } from './RoomActions.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { backToSeek, goBack } from '$lib/nav';
	import { mmss as fmtClock } from '$lib/time';
	import { MOTION, scrollBehavior } from '$lib/motion';
	import { expand, surface } from '$lib/transitions';
	import { clearNotifications } from '$lib/push';
	import { isDiploma } from './diplomas';

	let {
		room,
		loading,
		initialSheet = null,
		matched = false,
		onretry
	}: {
		room: ChatRoom | null;
		loading: boolean;
		/** 방을 여는 데 실패(네트워크) — 있으면 쫓아내지 않고 그 자리에 "다시 시도" */
		onretry?: () => void;
		/** 방금 매칭돼서 들어왔다 — 연결 화면을 한 번 */
		matched?: boolean;
		/** 개발용 미리보기에서만 사용 */
		initialSheet?: null | 'menu' | 'report' | 'block' | 'leave' | 'profile';
	} = $props();

	let draft = $state('');
	let listEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLTextAreaElement | undefined = $state();
	let atBottom = true;
	// Existing history stays still. Only messages mounted after the first batch arrive.
	let historyRoom: ChatRoom | null = null;
	const initialMessages = new Set<string>();
	$effect.pre(() => {
		const current = room;
		if (loading || !current) return;
		untrack(() => {
			if (historyRoom === current) return;
			historyRoom = current;
			initialMessages.clear();
			for (const message of current.msgs) initialMessages.add(message.client_msg_id);
		});
	});
	function messageArrival(node: HTMLElement, key: string) {
		const last = room?.msgs.at(-1)?.client_msg_id;
		const duration = !initialMessages.has(key) && atBottom && key === last ? MOTION.settle : 0;
		return surface(node, { y: 12, scale: 0.97, duration }, { direction: 'in' });
	}

	// 이 대화의 알림이 알림 센터에 남아 있으면 지운다 (지금 보고 있으니까, Phase 35)
	$effect(() => {
		const id = room?.roomId;
		if (id) void clearNotifications(id);
	});

	// 처음 불러왔을 때 맨 아래로
	$effect(() => {
		if (loading) return;
		void tick().then(() => scrollToBottom(false));
	});

	// ── 시간 ─────────────────────────────────────────────────────
	// 클라 시계 대신 서버 시계 기준 (skew 보정). 판정은 서버가 한다 — 여기는 표시용.
	// 한쪽이라도 대화 화면을 안 보고 있으면 시간이 멈춘다 (Phase 28) — 멈춘 동안은 남은 시간 그대로
	// 둘 다 고정한 대화는 시간 제한이 없다 (Phase 29) — 타이머 · 연장 투표 · 시간 종료가 없다
	const pinned = $derived(!!room?.snap?.pinned && room.snap.status === 'active');
	const paused = $derived(!pinned && !!room?.snap?.paused && room.snap.status === 'active');
	const remainMs = $derived(
		!room?.snap
			? 0
			: paused
				? Math.max(0, Date.parse(room.snap.expires_at) - Date.parse(room.snap.server_now))
				: Math.max(0, Date.parse(room.snap.expires_at) - room.serverNow(S.now))
	);
	const timeUp = $derived(!!room?.snap && room.snap.status !== 'closed' && !paused && !pinned && remainMs <= 0);
	const mmss = $derived(fmtClock(Math.ceil(remainMs / 1000), true));
	const urgent = $derived(!pinned && remainMs > 0 && remainMs <= 60_000);
	const closed = $derived(room?.closed ?? false);
	// "연결 중…" 막대는 1.5초 넘게 끊겨 있을 때만 — 방을 열 때마다(구독이 붙기 전 잠깐) 번쩍이던 것 (Phase 39)
	let showConn = $state(false);
	$effect(() => {
		if (room?.connected || loading || closed || !room) {
			showConn = false;
			return;
		}
		const t = setTimeout(() => (showConn = true), 1500);
		return () => clearTimeout(t);
	});
	const pending = $derived(room?.snap?.status === 'pending');
	// pending 방은 서버가 쓰기를 막는다(room_is_writable) — 화면도 맞춘다
	const locked = $derived(closed || timeUp || pending);

	// 카운트다운이 0 이 되면 서버에 "끝났나요?"를 묻는다. 판정은 서버가 한다.
	// (throttle 은 ChatRoom.checkExpiry 안에 있다 — S.now 가 매초 이 effect 를 깨운다)
	$effect(() => {
		if (timeUp && room) void room.checkExpiry();
	});

	// ── 연장 투표 ────────────────────────────────────────────────
	// "연장투표중"은 상태가 아니라 만료 N초 전부터의 구간이다.
	const snap = $derived(room?.snap ?? null);
	const canExtendMore = $derived(!!snap && (snap.max_rounds === 0 || snap.round < snap.max_rounds));
	const voteOpen = $derived(
		!!snap &&
			snap.status === 'active' &&
			!paused &&
			!pinned &&
			remainMs > 0 &&
			remainMs <= snap.vote_window_sec * 1000 &&
			canExtendMore
	);

	// 연장할 때마다 서로 하나씩 공개 (Phase 29): 10분 째 학년 → 20분 공통 질문 → 30분 디플로마 → 40분 공통 질문 → 50분 동아리.
	// 학년은 명단에서, 나머지는 연장하면서 직접 적는다 (공통 질문은 그 방의 같은 질문에 각자 답).
	// 동아리까지 연장한 다음 차례(60분 째)는 연장 대신 "이 채팅을 고정하시겠습니까?" — 둘 다 고정하면 시간 제한 없이 맨 위에.
	const nextHint = $derived(snap?.next_hint ?? null);
	const nextKind = $derived(nextHint?.kind ?? null);
	const pinNext = $derived(!!snap?.pin_next);
	const partnerHints = $derived(snap?.partner_hints ?? []);
	let hintDraft = $state('');
	// 적는 차례가 바뀌면 칸을 비운다 (디플로마로 적은 글이 다음 공통 질문 칸에 남지 않게)
	$effect(() => {
		void nextKind;
		hintDraft = '';
	});
	async function vote(agree: boolean) {
		if (!room) return;
		const typed = agree && !!nextHint?.typed && !pinNext;
		const what = isQuestion(nextKind) ? '답' : (nextHint?.label ?? '힌트');
		if (typed && nextKind === 'diploma' && !isDiploma(hintDraft)) return toast('디플로마를 검색해서 골라 주세요');
		if (typed && !hintDraft.trim()) return toast(`${what}을(를) 적어 주세요`);
		const r = await room.vote(agree, typed ? hintDraft.trim() : null);
		if (r === 'need_hint') toast(`${what}을(를) 다시 적어 주세요`);
		else if (r === 'too_early') toast('연장은 마감 직전부터 가능해요');
		else if (r === 'max_rounds') toast('더 이상 연장할 수 없어요');
		else if (r === null) toast('연결을 확인해 주세요');
	}

	// ── 매너 온도 평가 (Phase 30) ────────────────────────────────
	// 끝난 대화는 종료 안내 아래에서 바로, 고정한 대화는 위쪽 막대 → 시트로. 고정이 이 화면에서 성사되면 시트를 한 번 띄운다.
	const canRate = $derived(!!snap?.can_rate);
	let rateSent = $state(false);
	let rateSheet = $state(false);
	async function sendRate(score: Score, reasons: Reason[]) {
		const r = await room?.rate(score, reasons);
		if (r === 'ok' || r === 'already') {
			rateSent = true;
			rateSheet = false;
			toast('평가를 보냈어요');
		} else if (r === 'not_eligible') {
			rateSheet = false;
			toast('이 대화는 평가할 수 없어요');
		} else toast('연결을 확인해 주세요');
	}
	let pinSeen: boolean | null = null;
	let pinnedHere = $state(false);
	let pinPrompted = false;
	$effect(() => {
		if (!room?.snap) return;
		if (pinSeen === false && pinned) pinnedHere = true;
		pinSeen = pinned;
	});
	$effect(() => {
		// 고정 직후 스냅샷(평가 가능)이 조금 늦게 올 수 있어 둘 다 볼 때까지 기다린다
		if (pinnedHere && canRate && !pinPrompted) {
			pinPrompted = true;
			rateSheet = true;
		}
	});

	// ── 상대 이탈 감지 ───────────────────────────────────────────
	// 대화 중 상대가 45초 넘게 안 보이면(앱을 닫았거나 백그라운드) 넘길 수 있게 한다.
	// 남은 사람이 10분을 허공에 날리지 않게 하는 게 목적.
	let goneSince = $state<number | null>(null);
	$effect(() => {
		const away = !!room && room.connected && room.snap?.status === 'active' && !room.partnerHere;
		if (!away) goneSince = null;
		else if (untrack(() => goneSince) === null) goneSince = Date.now();
	});
	const partnerGone = $derived(goneSince !== null && S.now - goneSince > 45_000 && !closed);

	async function skip() {
		if (await room?.leave(true)) backToSeek();
		else toast('대화를 끝내지 못했어요 · 연결을 확인하고 다시 시도해 주세요');
	}

	// ── 메뉴 · 신고 · 차단 ───────────────────────────────────────
	// 시트는 한 번에 한 화면: menu → (leave | block | report) 확인 (RoomActions — 대화 목록 길게 누르기와 같은 내용) · 또는 프로필
	let sheet = $state<null | RoomStep | 'profile'>(untrack(() => initialSheet));

	function openSheet(s: typeof sheet) {
		sheet = s;
		if (s === 'profile') void loadProfile();
	}
	const roomActions: RoomActionFns = {
		leave: async () => !!room && (await room.leave(false)),
		block: async () => !!room && (await room.block()),
		report: async (reason, note) => !!room && (await room.report(reason, note))
	};

	// ── 상대 프로필 ──────────────────────────────────────────────
	// 헤더의 아바타·이름을 누르면 상대의 기본 정보. 같은 방 멤버만 서버가 돌려준다.
	let profile = $state<PartnerProfile | null>(null);
	let profileLoading = $state(false);
	async function loadProfile() {
		if (!room || profileLoading) return;
		profileLoading = true;
		profile = (await room.partnerProfile()) ?? profile;
		profileLoading = false;
	}
	$effect(() => {
		// 개발용 미리보기에서 &sheet=profile 로 바로 열었을 때
		if (room && sheet === 'profile' && !profile) untrack(() => void loadProfile());
	});
	// 대화 맨 위 소개 카드에 쓰려고 방을 열면 한 번 미리 불러온다 (실패해도 다시 조르지 않는다)
	let introTried = false;
	$effect(() => {
		if (room?.snap && !introTried) {
			introTried = true;
			untrack(() => void loadProfile());
		}
	});
	// 방 화면을 보고 있음(presence) > 앱이 켜져 있음(heartbeat) > 꺼짐
	const partnerOnline = $derived(!!room && (room.partnerHere || !!room.snap?.partner_online));
	const headerStatus = $derived(
		!room?.snap
			? ''
			: closed
				? '대화 종료'
				: pending
					? room.snap.partner_joined
						? '곧 시작해요'
						: '상대를 기다리는 중'
					: room.partnerHere
						? '지금 보고 있음'
						: room.snap.partner_online
							? '접속 중'
							: '오프라인'
	);

	// 도배 제한에 걸리면 한 번만 알려준다
	let warnedRate = false;
	$effect(() => {
		const hit = room?.msgs.some((m) => m.state === 'rate_limited');
		if (hit && !warnedRate) {
			warnedRate = true;
			toast('너무 빨리 보내고 있어요. 잠시 후 다시 눌러 주세요');
		}
		if (!hit) warnedRate = false;
	});
	const partnerTyping = $derived(!!room && S.now < room.partnerTypingUntil);

	// ── 키보드 (모바일) ──────────────────────────────────────────
	// iOS 는 키보드가 올라와도 100dvh 가 줄지 않고 페이지 전체를 위로 밀어 올린다 → 헤더와 최근 메시지가
	// 화면 밖으로 사라진다. 실제로 보이는 영역(visualViewport)에 대화 화면을 딱 맞춘다 — 값은 앱 전체가 같이 쓰는
	// lib/keyboard.svelte.ts 가 <html> 에 적어 둔 --vvh · --vv-top (Phase 41).

	// ── 스크롤 ───────────────────────────────────────────────────
	/** 맨 아래에서 얼마나 떨어져 있는지 — 목록 높이가 바뀌어도(키보드) 보던 자리를 지킨다 */
	let fromBottom = 0;
	function scrollToBottom(smooth = true) {
		listEl?.scrollTo({ top: listEl.scrollHeight, behavior: smooth ? scrollBehavior() : 'auto' });
	}
	function onScroll() {
		if (!listEl) return;
		// 고르기 줄이 열려 있는 동안 사람의 손가락·휠은 가림막(ReactionPicker 의 scrim)이 받아서 닫는다.
		// 그래도 scroll 이 오면 목록이 저절로 움직인 것(상대 입력 중 표시가 사라짐 · 새 메시지) — 닫지 않고 따라간다.
		followPicker();
		if (!cssGradient) paintSoon();
		fromBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
		atBottom = fromBottom < 48;
		if (atBottom) room?.markRead();
	}
	function onListResize() {
		if (!listEl) return;
		// 키보드가 올라와 목록이 줄어들면, 아래쪽(최근 메시지)이 그대로 보이게 위치를 맞춘다
		listEl.scrollTop = listEl.scrollHeight - listEl.clientHeight - (atBottom ? 0 : fromBottom);
		paintSoon();
	}
	// ── 내 말풍선 그라디언트 ─────────────────────────────────────
	// 인스타 DM 처럼 화면 위쪽 말풍선과 아래쪽 말풍선의 색이 다르다. 그라디언트 하나를 목록 화면에 깔고
	// 말풍선마다 자기 위치만큼 밀어서 보여준다. (background-attachment: fixed 는 iOS 가 무시해서 직접 계산)
	// 미는 일은 CSS 스크롤 연동 애니메이션(animation-timeline: view())이 스크롤과 같은 프레임에 한다.
	// 예전엔 scroll 이벤트 → 다음 프레임에 JS 로 위치를 고쳤는데, 빠르게 스크롤하면 몇 프레임씩 늦어
	// 말풍선이 그라디언트 바깥(엉뚱한 바탕색)을 보여 색이 잠깐 바뀌었다. JS 계산은 지원하지 않는 브라우저에서만.
	const cssGradient = typeof CSS !== 'undefined' && !!CSS.supports?.('animation-timeline: view()');
	let painting = false;
	function paintSoon() {
		if (painting) return;
		painting = true;
		requestAnimationFrame(() => {
			painting = false;
			if (!listEl) return;
			listEl.style.setProperty('--lh', listEl.clientHeight + 'px');
			if (cssGradient) return;
			const top = listEl.getBoundingClientRect().top;
			const els = listEl.querySelectorAll<HTMLElement>('.mine .bubble');
			// 읽기를 먼저 모두 끝내고 쓴다 (레이아웃 재계산 반복 방지)
			const ys = Array.from(els, (el) => el.getBoundingClientRect().top - top);
			els.forEach((el, i) => el.style.setProperty('--by', -ys[i] + 'px'));
		});
	}
	$effect(() => {
		void room?.msgs.length;
		void tick().then(paintSoon);
	});
	$effect(() => {
		if (!listEl) return;
		const ro = new ResizeObserver(onListResize); // 키보드가 올라오거나 화면이 돌아갈 때
		ro.observe(listEl);
		return () => ro.disconnect();
	});

	// 새 메시지·"읽음"·입력 중 표시·안내 문구가 생기면, 맨 아래를 보고 있을 때만 따라 내려간다
	$effect(() => {
		void room?.msgs.length;
		void partnerTyping;
		void seenMine;
		void reactSig;
		void pending;
		void closed;
		void timeUp;
		if (!atBottom) return;
		void tick().then(() => {
			scrollToBottom();
			room?.markRead();
		});
	});

	// ── 전송 ─────────────────────────────────────────────────────
	async function submit() {
		const text = draft;
		if (!text.trim() || !room || locked) return;
		const max = S.settings?.msg_max_len ?? 500;
		if (text.length > max) {
			toast(`${max}자까지 보낼 수 있어요`);
			return;
		}
		const to = replyTo?.id ?? null;
		const quoting = replyTo;
		draft = '';
		replyTo = null;
		atBottom = true;
		inputEl?.focus();
		const res = await room.send(text, to);
		if (res?.blocked) {
			// 검열 1단에 막힘 — 쓴 글을 입력창에 돌려놓고 이유를 알려 준다 (고쳐서 다시 보내면 된다)
			if (!draft) draft = text;
			if (!replyTo) replyTo = quoting;
			toast(errMsg(res.blocked));
		}
	}

	// ── 버블 그룹핑 (인스타식) ───────────────────────────────────
	// 같은 사람이 연달아 보낸 메시지는 인접 모서리를 4px 로 줄여 하나의 묶음으로 보인다.
	function pos(list: Msg[], i: number) {
		const s = list[i].sender_seat;
		const prev = list[i - 1]?.sender_seat === s && s !== 0;
		const next = list[i + 1]?.sender_seat === s && s !== 0;
		return { first: !prev, last: !next };
	}

	// 마지막으로 보낸 내 메시지 — 그 아래에만 "읽음" 표시
	const lastMineId = $derived(room?.msgs.findLast((m) => m.sender_seat === room?.seat)?.id ?? null);
	const seenMine = $derived(
		!!room?.snap?.their_read_id && lastMineId != null && room.snap.their_read_id >= lastMineId
	);

	// ── 화면 낭독기 ──────────────────────────────────────────────
	// 상대의 새 메시지만 소리 내어 읽는다. 목록 전체를 live 로 두면 들어올 때 지난 대화를 다 읽어 버려서,
	// 처음 불러온 대화까지는 기준선으로만 잡고, 그 뒤에 온 상대 메시지 하나씩만 따로 된 안내 칸에 넣는다.
	let spoken: number | null = null;
	let announce = $state('');
	$effect(() => {
		if (!room?.snap || !room.msgs.length) return;
		const last = room.msgs.findLast((m) => m.id != null && m.sender_seat !== 0 && m.sender_seat !== room?.seat);
		const id = last?.id ?? 0;
		if (spoken != null && last && id > spoken) announce = `${room.snap.partner_alias}: ${last.body}`;
		spoken = Math.max(spoken ?? 0, id);
	});

	// ── 공감 ─────────────────────────────────────────────────────
	// 두 번 톡 = ❤️ (다시 두 번 톡이면 취소), 길게 누르기(데스크톱은 오른쪽 클릭) = 공감 고르기 + 복사.
	// 말풍선은 글자 선택을 막는다 — 길게 누르면 iOS 가 글자를 잡아 버려서. 대신 고르기 줄에 "복사".
	const canReact = (m: Msg) => !locked && m.id != null && m.sender_seat !== 0 && m.state === 'sent' && !m.deleted_at;
	type Picker = { id: number; body: string; react: boolean; del: boolean; top: number; left: number | null; right: number | null };
	let picker = $state<Picker | null>(null);
	const PICK_H = 48;

	/** 고르기 줄이 붙어 있는 말풍선 — 목록이 저절로 움직이면(입력 중 표시가 사라짐 등) 따라간다 */
	let pickerAnchor: { m: Msg; el: Element } | null = null;
	function placePicker(m: Msg, bubble: Element) {
		if (m.id == null) return;
		const r = bubble.getBoundingClientRect();
		const header = listEl?.getBoundingClientRect().top ?? 0;
		// 말풍선 위에, 자리가 없으면 아래에
		const top = r.top - PICK_H - 8 >= header ? r.top - PICK_H - 8 : r.bottom + 8;
		const mineSide = m.sender_seat === room?.seat;
		picker = {
			id: m.id,
			body: m.body,
			react: canReact(m),
			// 내가 보낸 말은 대화가 끝나기 전까지 지울 수 있다 (Phase 28)
			del: mineSide && !m.deleted_at && m.state === 'sent' && !closed,
			top,
			left: mineSide ? null : Math.max(8, r.left),
			right: mineSide ? Math.max(8, window.innerWidth - r.right) : null
		};
	}
	function openPicker(m: Msg, bubble: Element | null) {
		if (m.id == null || !bubble || m.deleted_at) return;
		pickerAnchor = { m, el: bubble };
		placePicker(m, bubble);
		haptic.select();
	}
	/** 목록이 움직였다 — 말풍선이 아직 보이면 고르기 줄을 옮기고, 화면 밖으로 나갔으면 닫는다 */
	function followPicker() {
		if (!picker || !pickerAnchor || !listEl) return;
		const { m, el } = pickerAnchor;
		const r = el.getBoundingClientRect(), box = listEl.getBoundingClientRect();
		if (!el.isConnected || r.bottom < box.top || r.top > box.bottom) picker = null;
		else placePicker(m, el);
	}

	async function doReact(id: number, k: ReactionKey) {
		picker = null;
		const res = await room?.toggleReaction(id, k);
		if (res === 'closed') toast('대화가 끝나서 공감할 수 없어요');
		else if (res && res !== 'ok') toast('연결을 확인해 주세요');
	}

	// ── 답장 ─────────────────────────────────────────────────────
	// 공감 고르기 줄의 "답장", 또는 말풍선을 옆으로 밀기 → 입력창 위에 "○○에게 답장" 막대. 보내면 그 메시지를 짚은 답장이 된다.
	let replyTo = $state<Msg | null>(null);
	const byId = $derived(new Map((room?.msgs ?? []).filter((m) => m.id != null).map((m) => [m.id!, m])));
	const whose = (m: Msg) => (m.sender_seat === room?.seat ? '내' : `${room?.snap?.partner_alias ?? '상대'}의`);

	function startReply(m = picker ? byId.get(picker.id) : undefined) {
		picker = null;
		if (!m || m.id == null || locked) return;
		replyTo = m;
		inputEl?.focus();
	}

	// 밀어서 답장 — 끄는 동안 그 말풍선만 손가락을 따라 옆으로 (놓으면 제자리로 미끄러져 돌아간다)
	let swiped = $state<{ key: string; dx: number } | null>(null);
	const swipe = swipeReply<Msg>({
		onMove: (m, dx) => (swiped = m && dx ? { key: m.client_msg_id, dx } : null),
		onReply: (m) => startReply(m)
	});
	$effect(() => {
		if (locked) replyTo = null; // 대화가 끝나면 답장 준비도 접는다
	});

	// ── 연결 화면 · 시간 구분선 ──────────────────────────────────
	let showMatch = $state(untrack(() => matched));
	function matchDone() {
		showMatch = false;
		// 뒤로 왔다가 다시 이 방으로 와도(기록에 matched 가 남아 있어도) 또 뜨지 않게 지운다
		if (page.state.matched) replaceState('', { ...page.state, matched: false });
	}

	/** 대화 시작과, 5분 넘게 쉬었다 이어질 때만 가운데에 시각 ("오후 3:12") */
	const GAP_MS = 5 * 60_000;
	function timeSep(i: number) {
		const list = room?.msgs ?? [];
		const cur = Date.parse(list[i].created_at);
		if (i > 0 && cur - Date.parse(list[i - 1].created_at) < GAP_MS) return null;
		return new Date(cur).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
	}

	// ── 첫마디 도우미 ─────────────────────────────────────────────
	// 내가 아직 한 마디도 안 했고 입력창이 비어 있을 때만. 한 번 보내면 사라진다.
	const showStarters = $derived(
		!!room?.snap && !locked && !draft && !replyTo && !room.msgs.some((m) => m.sender_seat === room.seat)
	);
	function useStarter(text: string) {
		draft = text;
		inputEl?.focus();
	}

	/** 인용을 누르면 원래 메시지로 — 가운데로 스크롤하고 잠깐 반짝 */
	let flashId = $state<number | null>(null);
	async function jumpTo(id: number) {
		while (!byId.has(id) && room?.hasOlder && !room.loadingOlder) {
			if (!await room.loadOlder()) break;
			await tick();
		}
		const el = listEl?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
		if (!el) return toast('원래 메시지를 찾을 수 없어요');
		el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
		flashId = id;
		setTimeout(() => flashId === id && (flashId = null), 1200);
	}

	async function del() {
		const m = picker ? byId.get(picker.id) : undefined;
		picker = null;
		if (!m || !room) return;
		const r = await room.deleteMessage(m);
		if (r === 'ok') toast('삭제했습니다');
		else if (r === 'closed') toast('끝난 대화는 지울 수 없어요');
		else toast('지우지 못했어요');
	}

	async function copy() {
		const text = picker?.body ?? '';
		picker = null;
		try {
			await navigator.clipboard.writeText(text);
			toast('복사됨');
		} catch {
			toast('복사하지 못했어요');
		}
	}

	const press = pressGestures<Msg>({
		onLong: (m, el) => openPicker(m, el),
		onDouble: (m) => {
			if (canReact(m)) void doReact(m.id!, 'heart');
		}
	});

	const myReaction = $derived(picker && room ? room.reactions[picker.id]?.[room.seat] : undefined);
	// 공감이 달리면 말풍선 아래가 늘어난다 — 맨 아래를 보고 있으면 따라 내려가게 (아래 스크롤 effect 가 읽는다)
	const reactSig = $derived(room ? JSON.stringify(room.reactions) : '');

	// ★ 상대가 신고/차단해서 끝났을 때 사유를 알려주지 않는다 — "상대가 대화를 종료함"으로 통일.
	//   신고당한 걸 알면 보복하거나 신고를 피하는 법을 배운다.
	const ENDED_BY_PARTNER: Record<string, string> = {
		expired: '시간이 다 되어 대화 종료',
		declined: '연장하지 않기로 해서 대화 종료',
		skipped: '상대가 다음 대화로 이동',
		left: '상대가 대화방을 나감',
		reported: '상대가 대화를 종료함',
		blocked: '상대가 대화를 종료함',
		no_show: '상대가 들어오지 않음',
		admin: '운영진이 대화를 종료함'
	};
	const ENDED_BY_ME: Record<string, string> = {
		left: '대화를 나감',
		skipped: '대화를 나감',
		declined: '연장하지 않기로 해서 대화 종료',
		reported: '신고 접수 · 운영진이 대화 내용을 확인할게요',
		blocked: '차단 완료 · 이 사람과는 다시 만나지 않아요'
	};
	const endedText = $derived.by(() => {
		const r = room?.snap?.close_reason ?? '';
		return (room?.endedByMe ? ENDED_BY_ME[r] : undefined) ?? ENDED_BY_PARTNER[r] ?? '대화 종료';
	});
</script>

<div
	class="chat"
	class:keyboard={KB.open}
>
	<ChatHeader
		alias={room?.snap?.partner_alias ?? null}
		status={headerStatus}
		online={partnerOnline}
		{closed}
		{pinned}
		{paused}
		{pending}
		{urgent}
		{mmss}
		onprofile={() => openSheet('profile')}
		onmenu={() => openSheet('menu')}
	/>

	{#if partnerHints.length && !closed}
		<div class="hints" aria-label="공개된 힌트">
			{#each partnerHints as h (h.kind)}<span class="hint-chip"><small>{h.label}</small>{h.value}</span>{/each}
		</div>
	{/if}
	{#if pinned && canRate && !rateSent}
		<button class="rate-bar" onclick={() => (rateSheet = true)}>
			<span>고정한 대화예요 · 매너 평가를 남겨 주세요</span>
			<b>평가하기</b>
		</button>
	{/if}
	{#if paused && !pending && !closed}
		<div class="paused-bar">둘 다 보고 있을 때만 시간이 흘러요</div>
	{/if}

	{#if partnerGone && !voteOpen && !pinned}
		<Banner title="상대가 자리를 비운 것 같아요" sub="기다리거나 다른 사람과 대화할 수 있어요">
			{#snippet actions()}<button class="yes" onclick={skip}>다른 사람 찾기</button>{/snippet}
		</Banner>
	{/if}

	{#if voteOpen && snap}
		<VoteBanner {snap} {pinNext} voting={!!room?.voting} bind:hintDraft onvote={vote} />
	{/if}

	{#if showConn}
		<div class="conn">연결 중…</div>
	{/if}

	<div class="sr-only" aria-live="polite">{announce}</div>
	<div class="list" bind:this={listEl} onscroll={onScroll} role="region" aria-label="대화 내용">
		{#if onretry}
			<div class="load-fail" role="alert">
				<p>대화를 불러오지 못했어요<br /><span class="muted">연결을 확인하고 다시 시도해 주세요</span></p>
				<button class="btn-ghost" onclick={onretry}>다시 시도</button>
			</div>
		{:else if loading}
			<!-- 말풍선 모양 빈 자리 — 최근 대화가 놓일 아래쪽에. 불러오면 그 자리에 실제 대화가 들어선다 -->
			<p class="sr-only">불러오는 중…</p>
			<div class="sk" aria-hidden="true">
				{#each [[false, 46, true], [false, 30, false], [true, 52, true], [true, 36, false], [false, 58, true]] as [mine, w, gap], i (i)}
					<i class="skeleton" class:mine class:gap style:width="{w}%"></i>
				{/each}
			</div>
		{:else if room}
			{#if room.snap}
				<ChatIntro alias={room.snap.partner_alias} online={partnerOnline} {profile} onprofile={() => openSheet('profile')} />
			{/if}
			{#if room.hasOlder}<button class="btn-ghost" disabled={room.loadingOlder} onclick={async () => {
				const before = listEl?.scrollHeight ?? 0;
				atBottom = false;
				if (!await room?.loadOlder()) toast('이전 대화를 불러오지 못했어요 · 다시 시도해 주세요');
				await tick();
				if (listEl) listEl.scrollTop += listEl.scrollHeight - before;
			}}>이전 대화 {room.loadingOlder ? '불러오는 중…' : '더 보기'}</button>{/if}
			{#each room.msgs as m, i (m.client_msg_id)}
				{@const p = pos(room.msgs, i)}
				{@const sep = timeSep(i)}
				{#if sep}<div class="time-sep num">{sep}</div>{/if}
				{#if m.sender_seat === 0}
					<div class="sys">{m.body}</div>
				{:else}
					{@const mine = m.sender_seat === room.seat}
					{@const rx = m.id != null ? summarize(room.reactions[m.id]) : null}
					{@const dx = swiped?.key === m.client_msg_id ? swiped.dx : 0}
					<!-- 밀어서 답장은 줄 전체에서 — 말풍선 옆 빈자리를 밀어도 된다 -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="row"
						class:mine
						class:gap={p.first || m.reply_to != null}
						data-mid={m.id}
						in:messageArrival|global={m.client_msg_id}
						onpointerdown={(e) => {
							if (m.id != null && !locked) swipe.down(e, m);
						}}
						onpointermove={swipe.move}
						onpointerup={() => swipe.up()}
						onpointercancel={swipe.cancel}
					>
						<div
							class="bwrap"
							class:reacted={!!rx}
							class:flash={m.id != null && m.id === flashId}
							class:swiping={dx !== 0}
							style:transform={dx ? `translateX(${dx}px)` : null}
						>
							{#if dx}
								<!-- 민 쪽 반대편(드러난 자리)에 답장 화살표 — 끝까지 밀면 진해진다 -->
								<span
									class="swipe-ic"
									class:left={dx > 0}
									class:hit={Math.abs(dx) >= 64}
									style:opacity={Math.min(1, Math.abs(dx) / 64)}
									aria-hidden="true"
								>
									<svg viewBox="0 0 24 24" fill="none">
										<path d="M10 8L5 12l5 4M5.5 12H14a5 5 0 0 1 5 5v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</span>
							{/if}
							{#if m.reply_to != null}
								{@const orig = byId.get(m.reply_to)}
								<ReplyQuote
									label={orig ? `${whose(orig)} 메시지에 답장` : '답장'}
									text={orig?.body ?? null}
									{mine}
									onclick={() => jumpTo(m.reply_to!)}
								/>
							{/if}
							<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
							<div
								class="bubble"
								class:first={p.first}
								class:last={p.last}
								class:sending={m.state === 'sending'}
								class:deleted={!!m.deleted_at}
								class:failed={m.state === 'failed' || m.state === 'rate_limited'}
								onclick={() => (m.state === 'failed' || m.state === 'rate_limited') && room?.retry(m)}
								onpointerdown={(e) => press.down(e, m)}
								onpointermove={press.move}
								onpointerup={() => {
									if (!swipe.active) press.up(m); // 밀기였으면 톡으로 세지 않는다 (줄의 손 떼기보다 먼저 온다)
								}}
								onpointercancel={press.cancel}
								onpointerleave={press.cancel}
								oncontextmenu={(e) => press.menu(e, m)}
							>
								<span class="sr-only">{mine ? '나' : room.snap?.partner_alias}: </span>{m.body}
							</div>
							{#if rx}
								<ReactionBadge
									summary={rx}
									{mine}
									onclick={(e) => openPicker(m, (e.currentTarget as Element).previousElementSibling)}
								/>
							{/if}
						</div>
						{#if m.state === 'failed' || m.state === 'rate_limited'}
							<button class="fail" onclick={() => room?.retry(m)} aria-label="다시 보내기">!</button>
						{/if}
					</div>
					{#if mine && m.id != null && m.id === lastMineId && seenMine}
						<div class="seen">읽음</div>
					{/if}
				{/if}
			{/each}

			{#if partnerTyping && !locked}
				<div class="row gap" in:surface={{ y: 4, scale: 0.96 }} out:surface={{ y: 4, scale: 1 }}>
					<div class="bubble first last typing"><i></i><i></i><i></i></div>
				</div>
			{/if}

			{#if pending && !closed}
				<div class="sys">
					{room.snap?.partner_joined
						? '상대가 들어와 있어요. 곧 시작해요'
						: '상대를 기다리는 중'}
				</div>
			{/if}

			{#if closed}
				<div class="ended">
					<p>{endedText}</p>
					{#if canRate && !rateSent && room.snap}
						<div class="rate-card"><RateForm alias={room.snap.partner_alias} onsubmit={sendRate} /></div>
					{:else if rateSent}
						<p class="rated">평가를 보냈어요 · 매너 온도는 내일 새벽에 반영돼요</p>
					{/if}
					<button class="btn" onclick={backToSeek}>새 대화 찾기</button>
					<button class="btn-ghost" onclick={() => goBack('/')}>대화 목록</button>
					{#if !room.reported}
						<!-- 대화가 끝난 뒤에야 신고를 결심하는 경우가 많다 — 서버는 닫힌 방도 받는다 -->
						<button class="btn-text report-after" onclick={() => openSheet('report')}>이 대화 신고하기</button>
					{/if}
				</div>
			{:else if timeUp}
				<div class="sys">시간 종료</div>
			{/if}
		{/if}
	</div>

	{#if !closed}
		<!-- 입력 줄의 버튼(보내기 · 첫마디 · 답장 취소)은 키보드를 내리지 않는다 (lib/keyboard.svelte.ts) -->
		<div class="composer" data-keep-kb>
			{#if showStarters && room}
				<Starters roomId={room.roomId} mine={S.profile?.interests ?? []} theirs={profile?.interests ?? []} onpick={useStarter} />
			{/if}
			{#if replyTo}
				<div class="replying" in:expand out:expand>
					<div class="replying-text">
						<b>{replyTo.sender_seat === room?.seat ? '내 메시지에 답장' : `${room?.snap?.partner_alias ?? '상대'}에게 답장`}</b>
						<span>{replyTo.body}</span>
					</div>
					<button class="replying-x u-tap" onclick={() => (replyTo = null)} aria-label="답장 취소">✕</button>
				</div>
			{/if}
			<MessageInput
				bind:value={draft}
				bind:el={inputEl}
				placeholder={pending ? '둘 다 들어오면 시작돼요' : locked ? '대화할 수 없어요' : '메시지 보내기…'}
				disabled={locked || loading}
				dim={locked}
				canSend={!!draft.trim() && !locked}
				oninput={() => room?.onInput()}
				onsubmit={submit}
			/>
		</div>
	{/if}
</div>

{#if showMatch && room?.snap}
	<MatchScreen alias={room.snap.partner_alias} minutes={S.settings?.room_minutes ?? 10} ondone={matchDone} />
{/if}

{#if picker}
	<ReactionPicker
		at={picker}
		react={picker.react}
		current={myReaction}
		onpick={(k) => doReact(picker!.id, k)}
		onreply={() => startReply()}
		oncopy={copy}
		ondelete={picker.del ? del : undefined}
		onclose={() => (picker = null)}
	/>
{/if}

{#if rateSheet && room?.snap}
	<Sheet onclose={() => (rateSheet = false)} label="매너 평가">
		<RateForm alias={room.snap.partner_alias} onsubmit={sendRate} onskip={() => (rateSheet = false)} />
	</Sheet>
{/if}

{#if sheet}
	<Sheet onclose={() => (sheet = null)}>
		{#if sheet === 'profile'}
			<PartnerCard alias={room?.snap?.partner_alias ?? null} {profile} loading={profileLoading} />
			<button class="item" onclick={() => (sheet = null)}>닫기</button>
		{:else}
			<RoomActions
				step={sheet}
				{pinned}
				actions={roomActions}
				leaveToast={null}
				onprofile={() => openSheet('profile')}
				onclose={() => (sheet = null)}
				ondone={() => (sheet = null)}
			/>
		{/if}
	</Sheet>
{/if}

<style>
	.chat {
		display: flex;
		flex-direction: column;
		height: var(--vvh, 100dvh);
		/* 보이는 영역에 고정 — 키보드가 올라와도 페이지째 밀려 올라가지 않는다 */
		position: fixed;
		top: 0;
		left: 50%;
		width: 100%;
		max-width: 520px;
		transform: translate(-50%, var(--vv-top, 0px));
		background: var(--bg);
		overflow: hidden;
	}
	@media (min-width: 560px) {
		.chat {
			border-inline: 1px solid var(--line);
		}
	}
	/* 키보드가 떠 있을 때는 홈 인디케이터 여백이 필요 없다 */
	.chat.keyboard .composer {
		padding-bottom: 8px;
	}

	.hints {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px var(--pad);
		border-bottom: 1px solid var(--line);
	}
	.hint-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--field);
		font-size: 13px;
		font-weight: 600;
	}
	.hint-chip small {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-2);
	}
	.paused-bar {
		padding: 6px var(--pad);
		border-bottom: 1px solid var(--line);
		color: var(--text-2);
		font-size: 12px;
		text-align: center;
	}
	.bubble.deleted {
		font-style: italic;
		opacity: 0.55;
	}

	/* ── 하단 시트 (모양은 Sheet · ReportPicker) ── */
	.report-after {
		margin-top: 6px;
		color: var(--text-2);
		font-weight: 500;
		font-size: 13px;
	}

	.conn {
		padding: 6px var(--pad);
		font-size: 12px;
		text-align: center;
		color: var(--text-2);
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	/* ── 메시지 목록 ── */
	.list {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden; /* 밀어서 답장 중인 말풍선이 옆으로 삐져나가도 가로 스크롤이 생기지 않게 */
		overscroll-behavior: contain;
		padding: 12px var(--pad) 8px;
		display: flex;
		flex-direction: column;
	}
	/* 방을 열지 못함 (네트워크) — 가운데에 이유와 다시 시도 */
	.load-fail {
		margin: auto 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		text-align: center;
	}
	.load-fail p {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.6;
	}
	.load-fail .muted {
		font-size: 13px;
		font-weight: 400;
	}
	.load-fail .btn-ghost {
		width: auto;
		padding: 0 28px;
	}
	/* 불러오는 동안 — 한 줄 말풍선(.bubble)과 같은 높이 · 모서리 */
	.sk {
		margin-top: auto;
		display: flex;
		flex-direction: column;
	}
	.sk i {
		height: 37px;
		margin-top: 2px;
		border-radius: var(--r-bubble);
	}
	.sk i.gap {
		margin-top: 8px;
	}
	.sk i.mine {
		align-self: flex-end;
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
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		touch-action: pan-y; /* 줄 어디서든 옆으로 밀면 답장, 위아래는 스크롤 */
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
		font-size: var(--chat-fs); /* 설정 › 화면 › 글자 크기 (app.css, Phase 43) */
		line-height: 1.38;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		transition: opacity 0.15s;
	}
	/* 상대(왼쪽) 묶음: 왼쪽 인접 모서리를 줄인다 */
	.row:not(.mine) .bubble:not(.first) {
		border-top-left-radius: 4px;
	}
	.row:not(.mine) .bubble:not(.last) {
		border-bottom-left-radius: 4px;
	}
	/* 나(오른쪽) 묶음: 오른쪽 인접 모서리를 줄인다 */
	.mine .bubble {
		position: relative;
		isolation: isolate;
		/* 예전엔 여기 옛 기본색 보라(#9a36e4)가 있어서, 그라디언트 위치가 스크롤을 못 따라간 순간 보라가 비쳐 색이 바뀌어 보였다 */
		background-color: var(--bubble-b);
		color: var(--on-accent);
	}
	/* 목록 높이 H(--lh)의 그라디언트를 말풍선 위치만큼 올려서 보여준다 — 위 paintSoon().
	   그림은 3H 높이: 가운데 H 가 실제 그라디언트, 위아래 H 는 끝 색 그대로 — 위치가 한 화면 가까이 어긋나도
	   (빠른 스크롤에서 그리기가 늦는 프레임) 말풍선이 그라디언트 밖의 엉뚱한 색을 보이지 않는다.
	   말풍선 자신이 아니라 뒤판에 두어 반짝임(flash) 애니메이션과 서로 덮어쓰지 않게 */
	.mine .bubble::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background-image: linear-gradient(180deg, var(--bubble-a) 33.333%, var(--bubble-b) 51.667%, var(--bubble-c) 66.667%);
		background-size: 100% calc(3 * var(--lh, 100%));
		background-position: 0 calc(var(--by, 0px) - var(--lh, 0px));
		background-repeat: no-repeat;
		pointer-events: none;
	}
	/* 스크롤 연동: 말풍선 윗변이 목록 아래 끝(y = H)에서 위 끝을 지나 사라질 때(y = -h)까지
	   그림을 -(H + y) 에 둔다 = -2H → h - H. 배경이 3H 라 100% = h - 3H, 그래서 끝은 100% + 2H */
	@supports (animation-timeline: view()) {
		.mine .bubble::before {
			animation: bubble-grad linear both;
			animation-timeline: view();
		}
	}
	@keyframes bubble-grad {
		from {
			background-position: 0 calc(-2 * var(--lh, 0px));
		}
		to {
			background-position: 0 calc(100% + 2 * var(--lh, 0px));
		}
	}
	.mine .bubble:not(.first) {
		border-top-right-radius: 4px;
	}
	.mine .bubble:not(.last) {
		border-bottom-right-radius: 4px;
	}
	.time-sep {
		align-self: center;
		margin: 14px 0 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
	}

	/* ── 답장 ── */
	.bwrap.flash .bubble {
		animation: flash 1.2s ease-out;
	}
	@keyframes flash {
		0%,
		40% {
			filter: brightness(0.82);
			transform: scale(1.03);
		}
	}
	/* 동작 줄이기 · 움직임 줄이기(설정, Phase 43): 커지지 않고 어두워지기만 — 어디로 왔는지는 알려야 하니 끄지는 않는다 */
	@media (prefers-reduced-motion: reduce) {
		.bwrap.flash .bubble {
			animation: flash-still 1.2s ease-out !important;
		}
	}
	:global(html[data-motion='reduce']) .bwrap.flash .bubble {
		animation: flash-still 1.2s ease-out !important;
	}
	@keyframes flash-still {
		0%,
		40% {
			filter: brightness(0.82);
		}
	}
	.replying {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 4px 8px 12px;
	}
	.replying-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		position: relative;
		padding-left: 13px;
		font-size: 13px;
	}
	/* 왼쪽 세로줄 — 설정의 테마 색상(내 말풍선 색)을 따른다 */
	.replying-text::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		border-radius: 2px;
		background: var(--bubble-fill);
	}
	.replying-text b {
		font-weight: 600;
	}
	.replying-text span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--text-2);
	}
	.replying-x {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		margin: -8px -4px -8px 0;
		border-radius: 50%;
		color: var(--text-2);
		font-size: 14px;
	}

	/* ── 공감 ── */
	.bwrap {
		position: relative;
		max-width: 75%;
		min-width: 0;
		transition: transform var(--dur-3) var(--ease-settle); /* 놓으면 제자리로 */
	}
	.bwrap.swiping {
		transition: none; /* 끄는 동안은 손가락을 바로 따라간다 */
	}
	.swipe-ic {
		position: absolute;
		top: 50%;
		left: calc(100% + 10px);
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		margin-top: -15px;
		border-radius: 50%;
		background: var(--field);
		color: var(--text-2);
		transition: transform 0.12s ease-out;
	}
	.swipe-ic.left {
		left: auto;
		right: calc(100% + 10px);
	}
	.swipe-ic.hit {
		color: var(--text);
		transform: scale(1.12);
	}
	.swipe-ic svg {
		width: 18px;
		height: 18px;
	}
	/* 공감 배지의 누름 영역(말풍선 아래 7px 위에서 44)이 다음 말풍선을 덮지 않을 만큼 — 다음 줄 margin-top 2 와 합쳐 37 */
	.bwrap.reacted {
		margin-bottom: 35px;
	}
	.bwrap .bubble {
		max-width: none;
		/* 폰: 길게 누르면 글자 선택 대신 공감 고르기 (복사는 고르기 줄에) */
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
		touch-action: pan-y; /* 위아래는 스크롤, 옆으로 밀기는 답장 (두 번 톡 확대도 막힌다) */
	}
	/* 마우스가 있는 기기: 길게 누르기 대신 오른쪽 클릭이 고르기라, 드래그로 글자를 골라 복사할 수 있다 */
	@media (hover: hover) and (pointer: fine) {
		.bwrap .bubble {
			-webkit-user-select: text;
			user-select: text;
		}
	}
	.bubble.sending {
		opacity: 0.5;
	}
	.bubble.failed {
		opacity: 0.5;
		cursor: pointer;
	}
	/* 빨간 ! 는 20 이지만 누름은 44 (말풍선 쪽으로 겹쳐도 같은 "다시 보내기") */
	.fail::after {
		content: '';
		position: absolute;
		inset: -12px;
	}
	.fail {
		position: relative;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--danger);
		color: #fff;
		font-size: 13px;
		font-weight: 700;
		order: -1;
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

	.ended {
		margin: 24px 0 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
	}
	.ended p {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	/* 끝난 대화의 평가 카드 (Phase 30) */
	.rate-card {
		width: 100%;
		margin: 8px 0 6px;
		padding: 14px 0 6px;
		border-radius: var(--r-card);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.ended .rated {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-2);
	}
	.rate-bar:active {
		background: var(--field);
	}
	.rate-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 44px;
		padding: 9px var(--pad);
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		font-size: 13px;
		text-align: left;
	}
	.rate-bar b {
		flex: none;
		color: var(--accent);
		font-weight: 700;
	}

	/* ── 입력창 ── */
	.composer {
		padding: 8px var(--pad) calc(8px + env(safe-area-inset-bottom));
		background: var(--bg);
	}
	/* 입력 알약 모양은 MessageInput */
</style>
