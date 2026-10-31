# Landy 인스타그램 리뉴얼 · 2026-10-31

새 로고의 차콜·핑크·피치에 맞춘 3개 게시물, 각 5장(총 15장). 상·하단 반복 문구, 시리즈·페이지 표기, 넘김 안내, 장식용 손글씨를 삭제했다. 표지는 제목과 그래픽만, 본문은 제목과 핵심 설명 1~2줄만 남겼다. 본문 크기는 48px다. 기존 게시물은 상위 폴더에 보존했다.

## 파일

- [업로드용 PNG 15장 + 캡션 ZIP](./Landy-Instagram-Renewal-Upload.zip)
- [연결 표지](./Covers-Connected-Preview.png) · [프로필 간격 미리보기](./Profile-Grid-Preview.png)
- [전체 15장 미리보기](./All-Slides-Preview.png)
- [소개 PDF](./01-Landy-Introduction.pdf) · [랜덤채팅 PDF](./02-Landy-Random-Chat.pdf) · [익명편지 PDF](./03-Landy-Anonymous-Letters.pdf)
- [연결 표지 PDF](./Covers-Connected-Preview.pdf) · [캡션](./CAPTIONS.md)

## 업로드

각 폴더 안의 01.png → 05.png 순서로 한 게시물을 만든다. 01.png가 표지다.

- png/01-우리학교/ — 왼쪽, Landy 소개
- png/02-익명친구/ — 가운데, 랜덤채팅
- png/03-Landy/ — 오른쪽, 익명편지

최신 게시물이 앞에 오는 배치 기준으로 **03 → 02 → 01** 순서로 게시해 같은 줄에 놓는다. 계정의 프로필 편집/고정/업로드 미리보기에서 실제 순서와 잘림을 확인한다.

PNG는 기존과 같은 **1080 × 1440px(3:4)**. 연결 원본은 **3240 × 1440px**이며 한 장을 정밀하게 3등분했다. 프로필 미리보기에는 16px 간격을 넣어 실제 분리감을 확인할 수 있다. 연결 표지 이미지는 확인용이고 업로드에는 각 폴더의 01.png를 사용한다.

## 제작·검수

로고는 branding/icon-source.png 원본을 직접 삽입했다. 색·형태를 다시 그리지 않았다. 연결 표지의 로고는 원본 배경색을 자연스럽게 이어 주는 lighten 합성만 적용했다. 폰트는 Wanted Sans, 손글씨는 나눔손글씨 펜. 도형·타이포그래피는 HTML/CSS/SVG로 제작해 source/의 HTML에서 수정할 수 있다. 외부 생성 이미지·서비스 화면 캡처·실제 학생 대화는 사용하지 않았다. 예시 대화와 편지 문구는 홍보용 창작이다.

[제품 명세](../../../PRD.md) 기준으로 학교 인증·쌍방 연장·힌트·고정·익명편지·답장·보관 기능을 설명했다. 익명성 범위와 운영 전 확인 사항은 캡션 제작 메모에 적었다.

재생성: 저장소 루트에서 `node scripts/generate-instagram-renewal.mjs`. 로컬 Chrome/Edge, playwright-core, sharp를 사용한다. 브라우저 경로는 LANDY_PDF_BROWSER로 지정할 수 있다. 생성 후 PNG 폴더와 CAPTIONS.md를 ZIP으로 묶는다.

validation.json에는 로고 SHA-256, 표지 픽셀 연결 검사, PNG 크기, PDF 장수, 글꼴 로드, 텍스트 넘침·겹침 검사 결과가 담긴다. PDF는 별도로 렌더링해 시각 검수한다.
