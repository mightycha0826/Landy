<script lang="ts">
	import { enhance } from '$app/forms';
	import { ack, confirmed } from '$lib/admin/confirm';
	import FormMsg from '$lib/admin/FormMsg.svelte';
	import { can } from '$lib/adminRoles';

	let { data, form } = $props();
	const s = $derived(data.s);
	// 운영 수치 · AI · 금칙어 · 잠금은 개발자 · 관리자 (Phase 49). 서비스 열고 닫기는 누구나
	const isAdmin = $derived(can(data.staff, 'settings'));

	// 전교생에게 바로 적용되는 스위치라 한 번 더 묻는다
	// 서버 점검 (Phase 52) · 예약 (Phase 53) — 모든 학생이 앱을 못 쓰게 되니 한 번 더 묻는다
	let atInput = $state('');
	// 운영 화면은 서버(UTC)에서도 그려진다 — 늘 한국 시간으로
	const fmtWhen = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
	/** UTC → datetime-local(한국 시간) 값 */
	const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16);
	const askMaintOn = confirmed((f) =>
		f.get('at')
			? `${fmtWhen(new Date(`${f.get('at')}:00+09:00`).toISOString())}에 서버 점검을 예약할까요? 그 시각이 되면 저절로 모든 학생 앱이 점검 화면으로 바뀌어요.`
			: '서버 점검을 지금 시작할까요? 1분 안에 모든 학생 앱이 점검 화면으로 바뀌어요.'
	);
	const askMaintNow = confirmed(() => '예약을 기다리지 않고 지금 바로 점검을 시작할까요?');
	const askMaintCancel = confirmed(() => '점검 예약을 취소할까요?');
	const askMaintOff = confirmed(() => '점검을 끝내고 앱을 다시 열까요?');
	const askToggle = confirmed(() =>
		s.is_open ? '서비스를 닫을까요? 새 대화가 시작되지 않아요 (진행 중인 대화는 유지).' : '서비스를 다시 열까요?'
	);

	const FIELDS = [
		{ k: 'room_minutes', label: '첫 대화 시간', unit: '분', hint: '둘 다 입장한 순간부터 (연장부터는 아래 연장 시간)' },
		{ k: 'extend_minutes', label: '연장 시간', unit: '분', hint: '둘 다 동의할 때마다' },
		{ k: 'vote_window_sec', label: '연장 질문 시점', unit: '초 전', hint: '만료 몇 초 전에 물을지' },
		{ k: 'max_rounds', label: '연장 횟수 상한', unit: '회', hint: '0 = 무제한' },
		{ k: 'rematch_cooldown_days', label: '재매칭 금지', unit: '일', hint: '대화한 상대와 다시 만나지 않는 기간' },
		{ k: 'auto_suspend_reports', label: '자동 정지 기준', unit: '명', hint: '30일 안에 서로 다른 신고자 수' },
		{ k: 'max_open_rooms', label: '동시 대화 수', unit: '개', hint: '한 사람이 한꺼번에 열어 둘 수 있는 대화' }
	] as const;

	// ── Phase 19 — 검열봇 · AI 대화 상대 ──
	const aiReady = $derived(s.ai_moderation !== undefined && !!data.usage);
	const AI_FIELDS = [
		{ k: 'ai_mod_daily_cap', label: 'AI 검토 하루 한도', unit: '건', hint: '글 1건 ≈ 17 Neuron (어림값)' },
		{ k: 'ai_chat_per_user', label: 'AI 대화 · 사람당', unit: '번/일', hint: '한 학생이 하루에 시작할 수 있는 횟수' },
		{ k: 'ai_chat_daily_cap', label: 'AI 대화 · 앱 전체', unit: '번/일', hint: '1번(30턴) ≈ 1,600 Neuron (어림값)' },
		{ k: 'ai_chat_minutes', label: 'AI 대화 시간', unit: '분', hint: '한 번에' },
		{ k: 'ai_chat_max_turns', label: 'AI 대화 턴', unit: '번', hint: '한 번에 주고받는 최대 횟수' }
	] as const;
</script>

<h1 class="a-h1 title">운영 설정</h1>

<FormMsg {form} />

<!-- 서버 점검 (Phase 52) · 예약 (Phase 53) — 켜면(또는 예약 시각이 되면) 학생 앱 전체가 점검 화면 -->
{#if s.maintenance !== undefined}
	{@const at = s.maintenance_at ? new Date(s.maintenance_at) : null}
	{@const mOn = s.maintenance || (!!at && at.getTime() <= Date.now())}
	<section class="maint" class:on={mOn} class:soon={!mOn && !!at}>
		<div class="mhead">
			<b>{mOn ? '🔧 서버 점검 중' : at ? '⏰ 서버 점검 예약됨' : '서버 점검'}</b>
			<span>
				{#if mOn}
					학생들은 앱을 열면 점검 화면을 봐요{#if s.maintenance_until} · {fmtWhen(s.maintenance_until)}쯤 끝남으로 안내 중{/if}.
				{:else if at}
					<b class="when">{fmtWhen(s.maintenance_at!)}</b>부터 저절로 점검이 시작돼요. 하루 전부터 학생 홈에 예고가 떠요.
					{#if s.maintenance_msg}<br />안내: “{s.maintenance_msg}”{/if}
				{:else}
					켜면 1분 안에 모든 학생 앱이 점검 화면으로 바뀌고, 새 대화 · 편지가 막혀요. 시작 시각을 적으면 그때 저절로 켜져요(예약).
				{/if}
			</span>
		</div>
		{#if mOn}
			<form method="POST" action="?/maint" use:enhance={askMaintOff}>
				<input type="hidden" name="on" value="false" />
				<button class="btn">점검 끝내기</button>
			</form>
		{:else if at}
			<div class="mbtns">
				<form method="POST" action="?/maint" use:enhance={askMaintNow}>
					<input type="hidden" name="on" value="true" />
					<input type="hidden" name="msg" value={s.maintenance_msg ?? ''} />
					<input type="hidden" name="until" value={s.maintenance_until ? toLocal(s.maintenance_until) : ''} />
					<button class="btn a-danger-btn">지금 바로 시작</button>
				</form>
				<form method="POST" action="?/maint" use:enhance={askMaintCancel}>
					<input type="hidden" name="on" value="false" />
					<button class="btn-ghost cancel">예약 취소</button>
				</form>
			</div>
		{:else}
			<form class="mform" method="POST" action="?/maint" use:enhance={askMaintOn}>
				<input type="hidden" name="on" value="true" />
				<label class="mfield grow">
					<span>학생에게 보일 안내 <small>(비우면 기본 문구)</small></span>
					<textarea class="field" name="msg" rows="2" maxlength="300" placeholder="예: 새 기능을 준비하고 있어요. 오후 3시에 다시 만나요!"></textarea>
				</label>
				<label class="mfield">
					<span>시작 시각 <small>(비우면 지금 바로)</small></span>
					<input class="field" type="datetime-local" name="at" bind:value={atInput} />
				</label>
				<label class="mfield">
					<span>끝나는 시각 <small>(선택)</small></span>
					<input class="field" type="datetime-local" name="until" />
				</label>
				<button class="btn a-danger-btn">{atInput ? '점검 예약' : '점검 시작'}</button>
			</form>
		{/if}
	</section>
{/if}

<section class="kill" class:off={!s.is_open}>
	<div>
		<b>{s.is_open ? '서비스 운영 중' : '서비스 닫힘'}</b>
		<span>
			{s.is_open
				? '닫으면 새 대화가 시작되지 않아요. 진행 중인 대화는 끝까지 유지됩니다.'
				: '학생들은 홈 화면에서 "지금은 열려 있지 않아요"를 보게 됩니다.'}
		</span>
	</div>
	<form method="POST" action="?/toggle" use:enhance={askToggle}>
		<input type="hidden" name="open" value={String(!s.is_open)} />
		<button class="btn" class:a-danger-btn={s.is_open}>{s.is_open ? '서비스 닫기' : '서비스 열기'}</button>
	</form>
</section>

<form method="POST" action="?/save" use:enhance={ack({ keep: true })} class="form">
	<label class="row notice">
		<span class="label">홈 배너<small>채팅 홈 맨 위 한 줄 · 서비스를 닫았을 때 안내로도 보임. 여러 줄 공지는 <a href="/admin/notices">공지사항</a>에서</small></span>
		<input class="field" name="notice" value={s.notice} maxlength="300" placeholder="(없음)" disabled={!isAdmin} />
	</label>
	{#each FIELDS as f (f.k)}
		<label class="row">
			<span class="label">{f.label}<small>{f.hint}</small></span>
			<span class="val">
				<input class="field num" type="number" name={f.k} value={s[f.k]} disabled={!isAdmin} />
				<span class="unit">{f.unit}</span>
			</span>
		</label>
	{/each}
	{#if isAdmin}
		<button class="btn save">저장</button>
	{:else}
		<p class="muted small">운영 수치는 개발자 · 관리자만 바꿀 수 있어요. (서비스 열고 닫기는 운영자도 가능)</p>
	{/if}
</form>

<!-- 익명편지 잠금 (Phase 44) — 가입한 학생이 적으면 보낸 사람이 쉽게 짐작된다. 기준 인원이 되면 저절로 열린다 -->
{#if s.letters_gate !== undefined}
	{@const min = s.letters_gate_min ?? 100}
	{@const locked = !!s.letters_gate && (data.students ?? 0) < min}
	<h2 class="a-h2 sub">익명편지 잠금</h2>
	<p class="muted small gate-state">
		지금 <b class:gate-locked={locked}>{locked ? '잠김' : '열림'}</b> · 가입한 학생 <b class="num">{data.students ?? '?'}</b>명
		{#if s.letters_gate}· {min}명이 되면 저절로 열려요{:else}· 잠금이 꺼져 있어요{/if}
	</p>
	<form method="POST" action="?/letters" use:enhance={ack({ keep: true })} class="form">
		<label class="row">
			<span class="label">잠금 켜기<small>켜 두면 학생 앱의 익명편지 탭에 "가입 인원이 모이면 열려요"와 실시간 가입 인원이 보이고, 편지 쓰기 · 찾기가 막혀요</small></span>
			<input type="checkbox" name="letters_gate" checked={s.letters_gate} disabled={!isAdmin} />
		</label>
		<label class="row">
			<span class="label">열리는 인원<small>학교 인증 + 시작하기까지 마친 학생 수</small></span>
			<span class="val">
				<input class="field num" type="number" name="letters_gate_min" value={min} min="1" max="10000" disabled={!isAdmin} />
				<span class="unit">명</span>
			</span>
		</label>
		{#if isAdmin}<button class="btn save">잠금 설정 저장</button>{/if}
	</form>
{/if}

<!-- 동아리 뱃지 출시 (Phase 91) — 꺼져 있으면 학생 화면 어디에도 동아리 뱃지(club_)가 보이지 않는다 (lib/achievements.ts noClubs) -->
<h2 class="a-h2 sub">동아리 뱃지 출시</h2>
{#if s.club_badges === undefined}
	<p class="muted small">DB 에 Phase 91 을 반영하면 여기서 켤 수 있어요 (supabase/migrations/20261101120000_cnsa_badges_phase91.sql).</p>
{:else}
	<form method="POST" action="?/clubs" use:enhance={ack({ keep: true })} class="form">
		<label class="row">
			<span class="label">출시하기<small>켜면 학생 앱의 업적 · 프로필 · 편지 찾기에 동아리 뱃지가 보이고, 뱃지 제출의 "동아리 기장 제출" 탭과 뱃지 안내의 동아리 줄이 열려요. 학생 앱에는 설정을 다시 읽을 때(앱을 다시 열 때) 반영돼요</small></span>
			<input type="checkbox" name="club_badges" checked={s.club_badges} disabled={!isAdmin} />
		</label>
		{#if isAdmin}<button class="btn save">출시 설정 저장</button>{/if}
	</form>
{/if}

<h2 class="a-h2 sub">검열봇 · AI 대화 상대</h2>
{#if !aiReady}
	<p class="muted small">DB 에 Phase 19 를 반영하면 여기서 켤 수 있어요 (schema.sql 다시 실행).</p>
{:else}
	<p class="muted small ai-note">
		신상정보(전화번호·학번·SNS)와 금칙어는 AI 와 상관없이 늘 막힙니다. 아래 AI 기능은 Cloudflare Workers AI 를 쓰고,
		무료 몫은 하루 10,000 Neuron(매일 오전 9시 초기화) — 두 기능이 나눠 씁니다. 켜기 전에 개인정보 처리방침에 적어 주세요.
	</p>
	{#if data.usage}
		<div class="usage">
			<span>오늘 AI 검토 <b class="num">{data.usage.mod_checked_today}</b>건</span>
			<span>자동 감지 <b class="num">{data.usage.mod_flagged_today}</b>건</span>
			<span>검토 대기 <b class="num">{data.usage.mod_pending}</b>건</span>
			<span>오늘 AI 대화 <b class="num">{data.usage.ai_chats_today}</b>번</span>
		</div>
	{/if}
	<form method="POST" action="?/ai" use:enhance={ack({ keep: true })} class="form">
		<label class="row">
			<span class="label">AI 검토 (검열봇 2단)<small>올라간 채팅·편지·댓글을 AI 가 보고, 걸리면 신고함에 '자동 감지'로</small></span>
			<input type="checkbox" name="ai_moderation" checked={s.ai_moderation} disabled={!isAdmin} />
		</label>
		<label class="row">
			<span class="label">대화 봇<small>찾기 20초가 지나도 상대가 없으면 "봇" 표시를 단 대화 봇이 저절로 온다</small></span>
			<input type="checkbox" name="ai_chat" checked={s.ai_chat} disabled={!isAdmin} />
		</label>
		{#each AI_FIELDS as f (f.k)}
			<label class="row">
				<span class="label">{f.label}<small>{f.hint}</small></span>
				<span class="val">
					<input class="field num" type="number" name={f.k} value={s[f.k]} disabled={!isAdmin} />
					<span class="unit">{f.unit}</span>
				</span>
			</label>
		{/each}
		{#if isAdmin}<button class="btn save">AI 설정 저장</button>{/if}
	</form>

	{#if isAdmin}
		{@const chk = (form as { aiCheck?: { ok: boolean; binding: boolean; model: string; ms: number; reply?: string; error?: string } } | null)?.aiCheck}
		<form method="POST" action="?/aiCheck" use:enhance={ack({ keep: true })} class="ai-check">
			<button class="btn-ghost">AI 연결 확인</button>
			<span class="muted small">짧은 질문 하나를 보내 봐요 (무료 몫을 아주 조금 씀)</span>
		</form>
		{#if chk}
			<div class="ai-result" class:bad={!chk.ok} role="status">
				{#if chk.ok}
					<b>연결됨</b> · {chk.model} · {chk.ms}ms · 답: “{chk.reply}”
				{:else if !chk.binding}
					<b>AI 연결(바인딩)이 없어요</b> — 배포된 Worker 에 Workers AI 가 붙어 있지 않습니다.
					Cloudflare 대시보드 → Workers → cnsatinder → 설정 → 바인딩에 <code>AI</code> (Workers AI) 를 추가하거나,
					<code>wrangler.jsonc</code> 의 <code>"ai"</code> 설정이 들어간 채로 다시 배포해 주세요.
				{:else}
					<b>AI 호출 실패</b> · {chk.model} · {chk.ms}ms
					<code class="selectable">{chk.error}</code>
				{/if}
			</div>
		{/if}
	{/if}

	{#if data.terms}
		<form method="POST" action="?/terms" use:enhance={ack({ keep: true })} class="form terms">
			<label class="label" for="terms">
				금칙어 ({data.terms.length}개)
				<small>한 줄에 하나. 이 말이 들어간 채팅·편지·댓글은 보내지지 않아요. 띄어쓰기 우회는 <code>\s*</code> (예: <code>바\s*보</code>)</small>
			</label>
			<textarea id="terms" class="field selectable" name="terms" rows="8" disabled={!isAdmin}>{data.terms.join('\n')}</textarea>
			{#if isAdmin}<button class="btn save">금칙어 저장</button>{/if}
		</form>
	{/if}
{/if}

<style>
	.ai-check {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 14px;
		max-width: 720px;
	}
	.ai-check .btn-ghost {
		width: auto;
		padding: 0 16px;
	}
	.ai-result {
		margin-top: 10px;
		max-width: 720px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		font-size: 13px;
		line-height: 1.6;
	}
	.ai-result.bad {
		border-color: var(--danger);
	}
	.ai-result code {
		display: block;
		margin-top: 6px;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.title {
		margin-bottom: 16px;
	}
	.maint {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 720px;
		margin-bottom: 14px;
		padding: 16px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
	}
	.maint.on {
		border-color: #f59e0b;
		background: color-mix(in srgb, #f59e0b 9%, transparent);
	}
	.mhead {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mhead b {
		font-size: 16px;
	}
	.maint.on .mhead b {
		color: #b45309;
	}
	.maint.soon {
		border-color: color-mix(in srgb, #2563eb 50%, transparent);
		background: color-mix(in srgb, #2563eb 6%, transparent);
	}
	.maint.soon .mhead > b {
		color: #1d4ed8;
	}
	.mhead .when {
		font-size: 13px;
		color: var(--text);
	}
	.mbtns {
		display: flex;
		gap: 8px;
	}
	.mbtns .cancel {
		width: auto;
		height: 42px;
		padding: 0 18px;
	}
	.mhead span {
		font-size: 13px;
		color: var(--text-2);
	}
	.mform {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px;
	}
	.mfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.mfield small {
		font-weight: 500;
	}
	.mfield.grow {
		flex: 1 1 260px;
	}
	.mfield textarea {
		height: auto;
		padding: 10px 14px;
		font-size: 14px;
	}
	.mfield input {
		height: 42px;
		font-size: 14px;
	}
	.maint .btn {
		width: auto;
		height: 42px;
		padding: 0 20px;
		white-space: nowrap;
	}
	.kill {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		margin-bottom: 24px;
		max-width: 720px;
	}
	.kill div {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.kill b {
		font-size: 16px;
		color: var(--accent);
	}
	.kill.off b {
		color: var(--danger);
	}
	.kill span {
		font-size: 13px;
		color: var(--text-2);
	}
	.kill .btn {
		width: auto;
		padding: 0 16px;
		white-space: nowrap;
	}
	.form {
		max-width: 720px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.label {
		display: flex;
		flex-direction: column;
		font-size: 14px;
		font-weight: 600;
	}
	.label small {
		font-size: 12px;
		font-weight: 400;
		color: var(--text-2);
	}
	.val {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.val .field {
		width: 90px;
		text-align: right;
	}
	.unit {
		width: 36px;
		font-size: 13px;
		color: var(--text-2);
	}
	.notice .field {
		max-width: 420px;
	}
	.save {
		width: auto;
		margin-top: 16px;
		padding: 0 24px;
	}
	.small {
		font-size: 12px;
	}
	.sub {
		margin: 32px 0 8px;
	}
	.ai-note {
		max-width: 720px;
		margin-bottom: 12px;
	}
	.gate-state {
		max-width: 720px;
		margin: 0 0 8px;
	}
	.gate-locked {
		color: var(--danger);
	}
	.usage {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		max-width: 720px;
		margin-bottom: 8px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--field);
		font-size: 13px;
	}
	.row input[type='checkbox'] {
		width: 20px;
		height: 20px;
	}
	.terms {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 20px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.terms textarea {
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: 13px;
	}
	code {
		font-size: 12px;
	}
</style>
