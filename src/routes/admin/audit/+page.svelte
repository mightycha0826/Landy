<script lang="ts">
	import { ACTION_LABEL as LABEL, fmtTime, shortId } from '$lib/adminTypes';
	import { PERM_INFO, ROLE_LABEL, type StaffRole } from '$lib/adminRoles';
	import type { PageData } from './$types';

	type AuditRow = PageData['log'][number];

	let { data } = $props();

	/** 열람·검색 계열 — 표에서 눈에 띄게 */
	const VIEW = new Set(['view_identity', 'search_email', 'view_room', 'view_letter_authors', 'view_user_letters']);
	const SETTING: Record<string, string> = {
		is_open: '서비스',
		notice: '홈 배너',
		room_minutes: '대화 시간',
		extend_minutes: '연장 시간',
		vote_window_sec: '연장 질문',
		max_rounds: '연장 상한',
		rematch_cooldown_days: '재매칭 금지',
		auto_suspend_reports: '자동 정지 기준',
		max_open_rooms: '동시 대화',
		ai_moderation: 'AI 검토',
		ai_mod_daily_cap: 'AI 검토 한도',
		ai_chat: 'AI 대화',
		ai_chat_per_user: 'AI 대화 사람당',
		ai_chat_daily_cap: 'AI 대화 전체',
		ai_chat_minutes: 'AI 대화 시간',
		ai_chat_max_turns: 'AI 대화 턴',
		// Phase 44 · 52 · 53 — 기록에는 남는데 내용 칸이 비어 보이던 것 (Phase 54)
		letters_gate: '익명편지 잠금',
		letters_gate_min: '잠금 인원',
		maintenance: '서버 점검',
		maintenance_msg: '점검 안내',
		maintenance_until: '점검 끝',
		maintenance_at: '점검 예약'
	};
	const ONOFF = new Set(['is_open', 'ai_moderation', 'ai_chat', 'letters_gate', 'maintenance']);
	const WHEN = new Set(['maintenance_until', 'maintenance_at']);
	const when = (v: unknown) =>
		v ? new Date(String(v)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '없음';
	const perms = (v: unknown) => (Array.isArray(v) ? v.map((p) => PERM_INFO.find((x) => x.key === p)?.label ?? p).join(', ') || '없음' : '없음');

	/** 편지 번호 — 예전 기록은 letter_id, 요즘 기록은 letter 로 남아 있다 */
	const letterOf = (d: Record<string, unknown>) => (d.letter ?? d.letter_id) as number | undefined;

	function detail(a: AuditRow) {
		const d = a.detail ?? {};
		const parts: string[] = [];
		if (a.action === 'update_settings') {
			for (const [k, v] of Object.entries(d)) {
				if (!SETTING[k]) continue;
				if (k === 'is_open') parts.push(v ? '서비스 열기' : '서비스 닫기');
				else if (ONOFF.has(k)) parts.push(`${SETTING[k]} ${v ? '켬' : '끔'}`);
				else if (WHEN.has(k)) parts.push(`${SETTING[k]} ${when(v)}`);
				else if (k === 'maintenance_msg') {
					if (v) parts.push(`${SETTING[k]} "${v}"`);
				}
				else parts.push(`${SETTING[k]} ${k === 'notice' ? `"${v}"` : v}`);
			}
			return parts.join(' · ');
		}
		if (a.action === 'roster_import') return `${d.grade}학년 ${d.count}명`;
		// 운영진 관리 (Phase 50 · 51)
		const role = (v: unknown) => (v ? (ROLE_LABEL[v as StaffRole] ?? String(v)) : '');
		if (a.action === 'set_staff') return `${role(d.from) || '(운영진 아님)'} → ${role(d.to) || '운영진에서 뺌'}${d.name ? ` · "${d.name}"` : ''}`;
		if (a.action === 'set_role_perms') return `${role(d.role)}: ${perms(d.from)} → ${perms(d.to)}`;
		if (a.action === 'update_banned_terms') return `${d.count}개`;
		if (a.action === 'export_messages' && d.from && d.to) {
			const day = (v: unknown) => new Date(String(v)).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
			return `${day(d.from)} ~ ${day(new Date(Date.parse(String(d.to)) - 1))}`;
		}
		if (a.action === 'post_notice' || a.action === 'remove_notice') return `"${d.title}"`;
		if (a.action === 'release') return `버전 ${String(d.version).slice(0, 8)}${d.notice ? ` · 공지 #${d.notice}` : ' · 공지 없음'}`;
		if (a.action === 'remove_comment' && d.comment_id) parts.push(`댓글 #${d.comment_id}`);
		if (d.days) parts.push(`${d.days}일`);
		if (d.note) parts.push(String(d.note));
		if (d.distinct_reporters) parts.push(`신고자 ${d.distinct_reporters}명`);
		if (Array.isArray(d.users)) parts.push(`${d.users.length}명 ${d.via === 'label' ? '학번·이름' : '이메일'}`);
		if (d.query) parts.push(`"${d.query}"`);
		return parts.join(' · ');
	}
</script>

<header class="a-head">
	<div>
		<h1 class="a-h1">활동 기록</h1>
		<p class="a-sub">운영진의 모든 조치와 열람(이메일·학번·이름·대화·편지 작성자)이 여기에 남습니다. 지울 수 없음. 최근 200건.</p>
	</div>
</header>

<table class="a-table log">
	<thead>
		<tr><th>시각</th><th>누가</th><th>무엇을</th><th>대상</th><th>내용</th></tr>
	</thead>
	<tbody>
		{#each data.log as a (a.id)}
			<tr class:identity={VIEW.has(a.action)}>
				<td class="num muted">{fmtTime(a.created_at)}</td>
				<td class="mono">
					{#if a.staff_id}<a href="/admin/users/{a.staff_id}">{shortId(a.staff_id)}</a>{:else}<span class="muted">시스템</span>{/if}
				</td>
				<td class="act">{LABEL[a.action] ?? a.action}</td>
				<td class="tgt">
					{#if a.detail?.room}<a href="/admin/rooms/{a.detail.room}">대화 <span class="mono">{shortId(String(a.detail.room))}</span></a>
					{:else if letterOf(a.detail)}옛 편지 #{letterOf(a.detail)}
					{:else if a.target_user}<a class="mono" href="/admin/users/{a.target_user}">{shortId(a.target_user)}</a>
					{:else if a.report_id}<a href="/admin/{a.action.includes('letter') ? 'letters' : 'reports'}/{a.report_id}">신고 <span class="mono">{shortId(a.report_id)}</span></a>
					{:else}<span class="muted">—</span>{/if}
				</td>
				<td class="d">{detail(a)}</td>
			</tr>
		{:else}
			<tr><td colspan="5" class="a-empty">아직 기록이 없어요.</td></tr>
		{/each}
	</tbody>
</table>

<style>
	/* 내용 칸만 여러 줄이 될 수 있다 — 모든 칸을 윗줄에 맞춰서 첫 줄 높이가 같게 */
	.log td {
		vertical-align: top;
		line-height: 1.5;
	}
	.log .act,
	.log .tgt {
		white-space: nowrap;
	}
	.act {
		font-weight: 600;
	}
	.identity .act {
		color: var(--danger);
	}
	.d {
		width: 100%;
		color: var(--text-2);
		font-size: 13px;
		word-break: keep-all;
		overflow-wrap: anywhere;
	}
	.log .d:empty::before {
		content: '—';
	}

	/* 폰: 한 기록 = 한 카드. 윗줄 "무엇을 · 대상", 아랫줄 "시각 · 누가", 그 아래 내용 */
	@media (max-width: 640px) {
		.log thead {
			display: none;
		}
		.log tr {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 2px 10px;
			padding: 10px 0;
			border-bottom: 1px solid var(--line);
		}
		/* 공용 .a-table td 보다 우선하도록 .log 를 두 번 */
		.log.log td {
			padding: 0;
			border: 0;
			background: none;
		}
		.log .act {
			grid-row: 1;
			grid-column: 1;
		}
		.log .tgt {
			grid-row: 1;
			grid-column: 2;
			text-align: right;
		}
		.log .num {
			grid-row: 2;
			grid-column: 1;
			font-size: 12px;
		}
		.log .mono:nth-child(2) {
			grid-row: 2;
			grid-column: 2;
			text-align: right;
		}
		.log .d {
			grid-column: 1 / -1;
			width: auto;
		}
		.log .d:empty {
			display: none;
		}
		.log .a-empty {
			grid-column: 1 / -1;
		}
	}
</style>
