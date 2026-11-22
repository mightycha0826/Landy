import { compileModule } from 'svelte/compiler';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// 실제 클라이언트 모듈을 컴파일해 계정 전환·늦은 응답을 검사한다. 외부 서버는 사용하지 않는다.
const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
const urls = new Map();
let passed = 0;
function write(name, source) {
	const path = root + 'scripts/.account-' + name + '.tmp.mjs';
	writeFileSync(path, source);
	files.push(path);
	const url = pathToFileURL(path).href;
	urls.set(name, url);
	return url;
}
function build(path, name, imports = {}) {
	let source = stripTypeScriptTypes(readFileSync(root + path, 'utf8')).replaceAll('import.meta.env.DEV', 'false');
	for (const [specifier, target] of Object.entries(imports)) {
		source = source.replaceAll("'" + specifier + "'", JSON.stringify(urls.get(target)));
	}
	return write(name, path.endsWith('.svelte.ts') ? compileModule(source, { generate: 'client', filename: path, dev: false }).js.code : source);
}
const check = (name, ok) => {
	assert.ok(ok, name);
	passed++;
	console.log('  PASS  ' + name);
};
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const interval = globalThis.setInterval;
globalThis.setInterval = () => 1;

try {
	build('src/lib/accountScope.ts', 'scope');
	build('src/lib/drafts.ts', 'drafts', { './accountScope': 'scope' });
	write('supabase', [
		'export const pending = new Map();',
		'const ask = (key, args) => new Promise(resolve => {',
		' const list = pending.get(key) ?? []; list.push({resolve, args}); pending.set(key, list);',
		'});',
		'export function answer(key, data, error = null) {',
		' const call = pending.get(key)?.shift();',
		' if (!call) throw new Error("no pending request: " + key);',
		' call.resolve({data, error}); return call.args;',
		'}',
		'export const hasSupabase = true;',
		'export const supabase = {',
		' auth: {',
		'  async getSession() {return {data: {session: null}};},',
		'  onAuthStateChange(fn) {this.emit = fn;},',
		'  async signOut() {this.emit("SIGNED_OUT", null); return {error: null};}',
		' },',
		' rpc(fn, args) {return fn === "ensure_self" ? Promise.resolve({data: null, error: this.ensureError ?? null}) : ask(fn, args);},',
		' from(table) {let uid, patch; return {select() {return this;}, update(value) {patch = value; return this;},',
		'  eq(_key, id) {uid = id; return patch ? ask("update:" + table, {uid, patch}) : this;},',
		'  maybeSingle() {return ask(table, {uid});}};},',
		' channel() {return {on() {return this;}, subscribe() {return this;}};},',
		' async removeChannel() {}',
		'};'
	].join('\n'));
	write('push', 'export const disablePush = async () => {}; export const syncPush = async () => {};');
	write('rpc', 'export const rpc = async () => null;');
	build('src/lib/toast.svelte.ts', 'toast');
	build('src/lib/errors.ts', 'errors');
	build('src/lib/state.svelte.ts', 'state', {
		'./supabase': 'supabase', './rpc': 'rpc', './push': 'push', './accountScope': 'scope', './toast.svelte': 'toast',
		'./errors': 'errors'
	});
	write('api', 'import {supabase} from ' + JSON.stringify(urls.get('supabase')) + ';\n' +
		'export const fetchMailbox = async (box, before) => (await supabase.rpc("mailbox:" + box, {before})).data;\n' +
		'export const fetchUnread = async () => (await supabase.rpc("dm_unread")).data;');
	build('src/lib/letters/unread.svelte.ts', 'unread', {'./api': 'api', '../accountScope': 'scope'});
	build('src/lib/letters/mailbox.svelte.ts', 'mailbox', {'./api': 'api', './unread.svelte': 'unread', '../accountScope': 'scope', '../errors': 'errors'});
	build('src/lib/notices.svelte.ts', 'notices', {'./supabase': 'supabase', './accountScope': 'scope'});
	write('visible', 'export const whileVisible = () => () => {};');
	build('src/lib/inbox.svelte.ts', 'inbox', {'./supabase': 'supabase', './state.svelte': 'state', './visible': 'visible', './accountScope': 'scope'});
	write('prefs', 'export const PREFS = {inApp: true};');
	build('src/lib/inapp.svelte.ts', 'inapp', {'./prefs.svelte': 'prefs', './accountScope': 'scope'});

	const A = await import(urls.get('scope'));
	const {supabase, answer, pending} = await import(urls.get('supabase'));
	const {S, UI, init, retryAccount, loadProfile, loadAccount, recheckMaint, setProfileField} = await import(urls.get('state'));
	const M = await import(urls.get('mailbox'));
	const U = await import(urls.get('unread'));
	const N = await import(urls.get('notices'));
	const {INBOX} = await import(urls.get('inbox'));
	const I = await import(urls.get('inapp'));
	const session = id => ({user: {id, email: id + '@cnsa.hs.kr'}});
	const notice = name => ({notices: [{id: 1, title: name}], personal: [{id: 2, title: name}], last_seen: 1});
	const mail = name => ({letters: [{id: 3, thread_id: 1, to_name: name}], folders: [{id: 1, name}]});
	const room = {room_id: 'room-a', status: 'active', pinned: false, unread: 0, joined: true};
	const inbox = rooms => ({rooms, server_now: new Date().toISOString()});
	async function settleLogin(id) {
		await drain();
		check('프로필 조회 대상은 ' + id + '로 고정', answer('profiles', {id, onboarded: true}).uid === id);
		answer('app_settings', {is_open: true});
		answer('my_account', {name: id, has_password: true});
		await drain();
		answer('heartbeat', {ach_new: false});
		await drain();
	}
	await init();
	supabase.auth.emit('SIGNED_IN', session('a'));
	await settleLogin('a');
	await Promise.all([
		(async () => {const p = N.loadNotices(); answer('my_notices', notice('A')); await p;})(),
		(async () => {const p = M.loadBox('received'); answer('mailbox:received', mail('A')); await p;})(),
		(async () => {const p = U.refreshUnread(); answer('dm_unread', 7); await p;})(),
		(async () => {const p = INBOX.load(); answer('my_rooms', inbox([room])); await p;})()
	]);
	M.ANNOUNCED.add(3); M.POSTED.pending = true; M.KNOCK.hand = {count: 1};
	U.LIST.tab = 'sent';
	I.notifyInApp({key: 'old', title: 'A', body: 'private A', url: '/x', kind: 'notice'});
	check('A의 개인정보 캐시가 채워짐', S.me.name === 'a' && N.NOTICES.personal[0].title === 'A' && M.BOX.folders[0].name === 'A');
	const tokenA = A.accountToken();
	const oldWrite = setProfileField({ want: 'any' });
	const late = [N.loadNotices(true), M.loadBox('received'), U.refreshUnread(), INBOX.load(), loadProfile(), loadAccount(), recheckMaint()];
	supabase.auth.emit('SIGNED_IN', session('b'));
	const writeArgs = answer('update:profiles', null);
	await oldWrite;
	check('늦은 프로필 저장도 원래 계정을 수정하고 새 계정의 조회를 만들지 않음', writeArgs.uid === 'a' && writeArgs.patch.want === 'any' && pending.get('profiles').filter((call) => call.args.uid === 'b').length === 1);
	check('계정 변경 즉시 공지·편지·폴더·채팅 캐시가 지워짐', N.NOTICES.personal.length === 0 && !N.NOTICES.loaded && M.BOX.received.length === 0 && M.BOX.folders.length === 0 && !M.BOX.loaded.received && INBOX.rooms.length === 0 && !INBOX.loaded);
	check('안 읽음·알림·연출 상태도 지워짐', U.DM.unread === 0 && !U.DM.loaded && U.LIST.tab === 'received' && I.INAPP.cur === null && M.ANNOUNCED.size === 0 && !M.POSTED.pending && M.KNOCK.hand === null);
	check('계정 정보와 UI 수명이 새 세대로 바뀜', S.me === undefined && S.profile === null && S.accountVersion > tokenA && !UI.achNew);
	answer('my_notices', notice('LATE A')); answer('mailbox:received', mail('LATE A'));
	answer('dm_unread', 99); answer('my_rooms', inbox([room]));
	check('늦은 프로필 요청도 원래 A의 ID를 사용', answer('profiles', {id: 'a', nickname: 'LATE A'}).uid === 'a');
	answer('my_account', {name: 'LATE A'}); answer('heartbeat', {ach_new: true, maintenance: {msg: 'A'}});
	await Promise.all(late);
	check('늦은 A 응답이 개인정보·로딩 상태를 덮어쓰지 않음', S.profile === null && S.me === undefined && S.profileLoading && S.maint === null && !UI.achNew && N.NOTICES.personal.length === 0 && !N.NOTICES.loaded && !M.BOX.loaded.received && !U.DM.loaded && !INBOX.loaded);
	await settleLogin('b');
	const preference = setProfileField({ letters_open: false });
	const preferenceArgs = answer('update:profiles', null);
	await drain();
	const profileArgs = answer('profiles', {id: 'b', letters_open: false});
	await preference;
	check('같은 계정의 설정 저장은 본인 행을 수정하고 프로필을 갱신', preferenceArgs.uid === 'b' && profileArgs.uid === 'b' && S.profile.letters_open === false);
	const bToken = A.accountToken();
	supabase.auth.emit('TOKEN_REFRESHED', session('b'));
	check('같은 계정 토큰 갱신은 데이터·세대를 유지', S.me.name === 'b' && A.accountToken() === bToken);
	const bNotice = N.loadNotices(); answer('my_notices', notice('B')); await bNotice;
	check('A의 공지 freshness가 B의 첫 조회를 막지 않음', N.NOTICES.personal[0].title === 'B');
	const revision = INBOX.roomRevision;
	const open = INBOX.load(); answer('my_rooms', inbox([room])); await open;
	check('방 목록이 추가되면 평가 큐 갱신', INBOX.roomRevision === revision + 1);
	const again = INBOX.load(); answer('my_rooms', inbox([{...room, unread: 1}])); await again;
	check('동일 방의 읽음·메시지 변경은 평가 큐 유지', INBOX.roomRevision === revision + 1);
	const closed = INBOX.load(); answer('my_rooms', inbox([])); await closed;
	check('일반 방이 목록에서 제거돼도 평가 큐 갱신', INBOX.roomRevision === revision + 2);
	const first = N.loadNotices(true), second = N.loadNotices(true);
	const calls = pending.get('my_notices');
	calls[1].resolve({data: notice('NEW B')});
	await second;
	answer('my_notices', notice('OLD B')); calls.splice(0);
	await first;
	check('중첩 조회는 최신 요청 결과를 유지', N.NOTICES.personal[0].title === 'NEW B');
	supabase.auth.emit('SIGNED_OUT', null);
	check('로그아웃도 개인정보와 인증 부가정보를 초기화', S.me === undefined && S.hasPassword === null && S.settings === null && M.BOX.received.length === 0 && N.NOTICES.personal.length === 0 && INBOX.rooms.length === 0);
	await assert.rejects(setProfileField({ want: 'any' }), /unauthenticated/);
	check('로그인하지 않은 프로필 저장은 데이터베이스에 요청하지 않음', pending.get('update:profiles').length === 0);
	supabase.auth.emit('SIGNED_IN', session('b'));
	check('같은 ID로 재로그인해도 새 계정 수명', A.accountToken() > bToken && !A.accountIsCurrent(bToken));
	await settleLogin('b');
	I.dismissInApp();
	const oneLoad = INBOX.load(), sharedLoad = INBOX.load();
	check('inbox 중첩 요청은 하나의 RPC를 공유', pending.get('my_rooms').length === 1);
	answer('my_rooms', inbox([])); await Promise.all([oneLoad, sharedLoad]);
	supabase.auth.emit('SIGNED_OUT', null);
	supabase.auth.emit('SIGNED_IN', session('c'));
	await drain();
	answer('profiles', null, { message: 'offline' }); answer('app_settings', { is_open: true }); answer('my_account', { name: 'c' });
	await drain();
	check('계정 조회 실패는 복구 가능한 오류 상태', !!S.bootError && !S.profileLoading);
	const recovery = retryAccount(); await settleLogin('c'); await recovery;
	check('같은 계정 재시도는 프로필을 다시 읽고 오류 해제', !S.bootError && S.profile.id === 'c');
	supabase.auth.emit('SIGNED_OUT', null);
	supabase.ensureError = { code: '23503', message: 'profiles_id_fkey' };
	supabase.auth.emit('SIGNED_IN', session('gone'));
	await drain();
	supabase.ensureError = null;
	check('★ 서버에서 지워진 계정은 오류 화면에 갇히지 않고 로그아웃', S.session === null && !S.bootError && !S.profileLoading);
	supabase.auth.emit('SIGNED_IN', session('c'));
	await settleLogin('c');
	const D = await import(urls.get('drafts'));
	const stored = new Map();
	globalThis.localStorage = { get length() { return stored.size; }, key: (i) => [...stored.keys()][i], getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
	const valid = (v) => !!v && typeof v.body === 'string';
	D.writeDraft('letter:1', { body: '작성한 편지' });
	check('초안 본문을 기기에서 복원', D.readDraft('letter:1', valid).body === '작성한 편지');
	D.clearDraft('letter:1'); check('보내기·버리기는 초안을 제거', D.readDraft('letter:1', valid) === null);
	D.writeDraft('profile', { body: '소개' }); const old = A.accountToken(); A.changeAccount('d');
	check('계정 전환은 이전 계정 초안을 제거', stored.size === 0 && D.readDraft('profile', valid) === null);
	D.writeDraft('profile', { body: '늦은 응답' }, old); check('늦은 계정의 초안 저장도 거부', stored.size === 0);
	D.writeDraft('expired', { body: '지난 글' });
	const originalNow = Date.now; Date.now = () => originalNow() + 25 * 3600_000;
	check('24시간 지난 초안은 읽히지 않고 정리', D.readDraft('expired', valid) === null && stored.size === 0); Date.now = originalNow;
} finally {
	globalThis.setInterval = interval;
	for (const path of files) rmSync(path, {force: true});
}
console.log('\n' + passed + ' passed, 0 failed\n');
