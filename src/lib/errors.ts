export function errMsg(e: unknown): string {
	const m = String((e as { message?: string })?.message ?? e ?? '');
	// Supabase Auth 는 트리거 예외를 'Database error saving new user' 로 감싸서 돌려준다
	if (m.includes('school_email_required') || m.includes('Database error saving new user'))
		return '학교 이메일(@cnsa.hs.kr)로만 가입할 수 있어요';
	// IP 단위 한도 — 학교 와이파이에서는 본인이 아니라 학교 전체가 몰린 것이다
	if (m.includes('Request rate limit reached'))
		return '지금 들어오는 사람이 많아요. 몇 초 뒤에 다시 눌러 주세요';
	if (m.includes('Email rate limit') || m.includes('over_email_send_rate_limit'))
		return '메일 요청이 너무 잦아요. 1분 뒤에 다시 받아 주세요';
	if (m.includes('rate limit')) return '요청이 많아요. 잠시 후 다시 시도해 주세요';
	// 비밀번호 로그인 — 계정이 없는지 비밀번호가 틀렸는지는 구분해 주지 않는다 (가입 여부 탐색 방지)
	if (m.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요';
	if (m.includes('Email not confirmed')) return '아직 인증을 마치지 않은 계정입니다. "가입하기"로 인증해 주세요';
	if (m.includes('Password should') || m.includes('weak_password'))
		return '비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요';
	if (m.includes('same_password') || m.includes('should be different'))
		return '지금 쓰는 비밀번호와 달라야 해요';
	// 프로필 검사 (update_my_profile)
	if (m.includes('personal_info')) return '학번·전화번호·SNS 아이디처럼 나를 알 수 있는 정보는 적을 수 없어요';
	if (m.includes('bio_too_long')) return '소개는 60자까지 쓸 수 있어요';
	if (m.includes('too_many_interests')) return '관심사는 5개까지 담을 수 있어요';
	if (m.includes('interest_too_long')) return '관심사 하나는 12자까지 담을 수 있어요';
	if (m.includes('invalid_mbti')) return 'MBTI 를 다시 확인해 주세요';
	// 검열 1단 (규칙 필터) — personal_info 는 위에서
	if (m.includes('blocked_word')) return '보낼 수 없는 표현이 있어요. 다른 말로 바꿔 주세요';
	// 익명편지
	if (m.includes('too_long')) return '글자 수 초과';
	if (m.includes('bad_format')) return '서식을 저장하지 못했어요. 다시 올려 주세요';
	if (m.includes('empty_body')) return '내용을 적어 주세요';
	if (m.includes('not_owner')) return '내가 쓴 글만 지울 수 있어요';
	// 이름 편지 (Phase 23)
	if (m.includes('name_in_roster')) return '학교 명단에 있는 이름이에요. 학교 이메일로 가입했는지 확인해 주세요';
	if (m.includes('bad_name')) return '이름은 한글 또는 영문 2~20자로 적어 주세요';
	// Supabase 는 틀린 코드와 만료된 코드에 같은 문구를 준다 — "만료"라고만 하면 오타에도 새 코드를 받으러 가서 메일 한도를 쓴다
	if (m.includes('Token has expired or is invalid'))
		return '인증 코드가 맞지 않거나 만료됐어요. 숫자를 확인하고, 계속 안 되면 코드를 다시 받아 주세요';
	if (m.includes('Token has expired') || m.includes('expired'))
		return '인증 코드 유효 시간 만료. 다시 받아 주세요';
	if (m.includes('Invalid token') || m.includes('invalid'))
		return '인증 코드가 올바르지 않아요';
	if (m.includes('Failed to fetch') || m.includes('NetworkError'))
		return '네트워크를 확인해 주세요';
	if (m.includes('unauthenticated')) return '로그인이 필요해요';
	return m || '알 수 없는 오류';
}
