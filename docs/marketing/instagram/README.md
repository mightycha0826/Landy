# Landy 인스타그램 소개 시리즈

‘우리학교 / 익명친구 / Landy’ 표지 3개를 연결한 시리즈다. 각 게시물은 5장이다. 2026-10-04 수정에서는 첫 대화·첫 편지를 궁금하게 만드는 문구에 핵심 기능 설명을 2~3줄씩 더하고 색감을 높였다.

- [우리학교 · Landy 소개](./01-Landy-Introduction.pdf)
- [익명친구 · 랜덤채팅](./02-Landy-Random-Chat.pdf)
- [Landy · 익명편지](./03-Landy-Anonymous-Letters.pdf)

- [연결 표지 PDF](./Covers-Connected-Preview.pdf) · [미리보기](./Covers-Connected-Preview.png)
- [업로드용 PNG 15장 + 캡션 ZIP](./Landy-Instagram-Upload.zip)
- [캡션·게시 순서](./CAPTIONS.md)

Landy 표지는 저장소의 **롯데리아 촵땡겨체**를 사용한다. 표지 앱 로고는 870px이며 편지는 첫 번째/두 번째 경계에서 이어진다.

분홍·코랄·레몬색·선명한 보라·하늘색을 사용한다. 각 게시물의 마지막 장 메인 로고는 680px다. 세 표지는 기존 노랑·분홍·보라·하늘색 팔레트를 복원하고 배경과 연결 곡선의 그라데이션 방향을 오른쪽에서 왼쪽으로 뒤집었다. 배경 로고 없이 편지와 곡선이 이어지도록 유지했다. 본문 12장의 오른쪽 아래에는 1,540px 로고를 배경 색감에 맞춘 단색 실루엣으로 바꾸고 불투명도 24%로 일부만 걸쳐 배치했다. 큰 타이포그래피, 여백, 곡선과 봉투·로고 구성은 유지했다. 카드형 박스·버튼·작은 라벨·영문 태그·페이지 번호는 넣지 않았다. 본문 글자는 최소 46px이며 학교 인증, 채팅 연장·힌트·고정, 편지 대상 검색·서명·답장·보관을 쉽게 설명한다.

## 이미지 폴더

각 게시물 폴더 안의 이미지를 01.png → 05.png 순서로 업로드한다. 01.png가 표지다.

```text
png/
  01-우리학교/  01.png ~ 05.png
  02-익명친구/  01.png ~ 05.png
  03-Landy/     01.png ~ 05.png
```

## 게시하기

일반적인 최신순 배치에서는 **03 → 02 → 01**로 게시한다. 각 게시물은 PNG 01~05 순이며 01이 표지다. 계정의 고정/재정렬/미리보기 상태를 확인해 같은 줄에 배치한다. PNG는 1,080 × 1,440px, 3:4 비율이며 PDF는 공유용이다.

3:4 지원 참고: [Instagram 지원 발표 보도](https://9to5mac.com/2025/05/29/instagram-changes-standard-photo-aspect-ratio/). 업로드 도구에서 실제 잘림을 확인한다.

## 내용 기준·재생성

[PRD](../../PRD.md)와 [유저 플로우](../../USER-FLOWS.md)의 제품 범위를 바탕으로 했다. 근거 없는 성과·후기, 즉시 매칭·완전 익명·전달 보증, 확인되지 않은 URL/QR은 넣지 않았다. 운영 정책은 앱 안내를 따른다.

~~~powershell
node scripts/generate-instagram-posts.mjs
Compress-Archive -LiteralPath 'docs/marketing/instagram/png','docs/marketing/instagram/CAPTIONS.md' -DestinationPath 'docs/marketing/instagram/Landy-Instagram-Upload.zip' -CompressionLevel Optimal -Force
~~~

로컬 Chrome/Edge, 프로젝트의 playwright-core·sharp와 저장소 글꼴을 사용한다. 글꼴·문구/배치·텍스트와 그림 겹침·넘침·박스 제거·PDF 장수·PNG 크기·표지 연결을 검사한다. HTML·검증 결과·전체 장 미리보기는 실행 결과의 임시 폴더에 남는다. 브라우저를 찾지 못하면 LANDY_PDF_BROWSER를 지정한다.
