import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/accountDeletion.ts', import.meta.url), 'utf8'));
const { deletionRequestBody, isDeletionInquiry, DELETION_NOTE_MAX } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('계정 삭제 요청은 기존 계정 문의에서 정확히 구분된다', () => {
	assert(isDeletionInquiry({ kind: 'account', body: deletionRequestBody('') }));
	assert(!isDeletionInquiry({ kind: 'bug', body: deletionRequestBody('') }));
	assert(!isDeletionInquiry({ kind: 'account', body: '계정을 삭제하려면 어떻게 하나요?' }));
});
test('선택 설명이 없어도 요청하고, 설명이 있으면 서버 본문 상한을 지킨다', () => {
	assert(deletionRequestBody('   ').length >= 5);
	assert.equal(deletionRequestBody('가'.repeat(DELETION_NOTE_MAX)).length, 1000);
	assert.throws(() => deletionRequestBody('가'.repeat(DELETION_NOTE_MAX + 1)));
	assert(deletionRequestBody('  요청을 확인해 주세요  ').endsWith('요청을 확인해 주세요'));
});
