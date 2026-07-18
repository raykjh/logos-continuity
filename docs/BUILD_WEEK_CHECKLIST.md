# OpenAI Build Week Submission Checklist

확인일: 2026-07-18

## 공식 일정

- 제출 마감: 2026-07-21 17:00 PDT / 2026-07-22 09:00 KST
- 심사: 2026-07-22부터
- 결과 발표: 2026-08-12 전후

## 프로젝트 정합성

- [x] Codex로 프로젝트를 구현했다.
- [x] GPT-5.6 Responses API 연결 코드를 포함한다.
- [ ] 실제 API 키로 `GPT-5.6 LIVE` 분류를 검증하고 화면을 녹화한다.
- [x] 트랙을 하나로 선택했다: **Work and Productivity**.
- [x] 실행 가능한 로컬 데모와 테스트 데이터를 제공한다.
- [x] High/Medium/Low 프로젝트 식별과 정본 기반 Continuity Brief를 구현했다.
- [x] conflicted 후보의 비교, 임시 예외, 정본 유지, 승인 교체와 해결 이력을 구현했다.
- [x] Current State, Next Actions, Exploration, Checkpoint를 운영하는 State Operations Center를 구현했다.
- [x] 변경 전후·이유·출처와 승인 기반 복원을 제공하는 History & Provenance Center를 구현했다.
- [x] Registry, Workstream, `Strategic Goal → Milestone → Task`를 운영하는 Project Structure Center를 구현했다.
- [x] 구조 승인 게이트, 부모 계층, verified completion, 상위 목표 완료 조건을 자동 테스트로 검증했다.
- [x] 포트폴리오 건강 점수, 설명 가능한 감점, 위험 우선순위와 직접 이동을 제공하는 Continuity Command Center를 구현했다.
- [x] 2분 50초의 7단계 Guided Demo / Judge Mode와 녹화 대본을 구현했다.
- [x] 공식 요건을 자동 증빙과 외부 작업으로 분리하는 Submission Evidence Center와 영문 Markdown 내보내기를 구현했다.
- [x] 설치·재빌드 없이 Node.js 24에서 실행되는 Windows/macOS/Linux Portable Judge Build와 SHA-256 manifest를 생성했다.
- [x] Node.js 24 Dockerfile, 무료 Render Blueprint, 공개 바인딩과 HTTP health check를 준비했다.
- [x] 기존 작업과 Build Week 기간 중 추가 작업을 문서에서 구분할 수 있다.
- [ ] Git 저장소를 만들고 Build Week 기간의 날짜가 남는 커밋 기록을 준비한다.

## 필수 제출물

- [ ] 영어 프로젝트 설명: 문제, 기능, 작동 방식, GPT-5.6과 Codex 사용법
- [ ] 3분 미만의 공개 YouTube 데모 영상
- [x] 3분 미만 녹화를 위한 앱 내 타이머·단계 안내와 `docs/JUDGE_DEMO_SCRIPT.md` 대본
- [ ] 영상 오디오에서 무엇을 만들었고 GPT-5.6과 Codex를 어떻게 사용했는지 설명
- [ ] 공개 저장소 URL 또는 심사 계정과 공유한 비공개 저장소 URL
- [x] 설치 및 실행 지침
- [ ] 무료로 접근 가능한 테스트 방법 또는 데모 인스턴스
- [x] 무료 배포 가능한 Portable Judge ZIP과 영문 실행 지침 준비
- [ ] `render.yaml`을 실제 저장소에서 배포하고 생성된 공개 URL을 Devpost에 입력
- [ ] `/feedback`으로 핵심 Codex 작업 스레드의 Session ID 생성 및 제출
- [ ] 모든 제출 자료를 영어로 작성하거나 영어 번역 제공

## README에 추가로 남길 증빙

- Codex가 가속한 작업: 스키마, 승인 게이트, Context Assembly, UI, 테스트, 브라우저 QA
- 사용자 결정: 제품 목적, Work and Productivity 트랙, 정본 안전 원칙, 데모 서사
- GPT-5.6 기여: 발언 분류 결과, confidence, rationale, 분류 후 안전한 저장 대상
- Codex 세션 로그 또는 날짜가 있는 커밋 기록

## 심사 기준 대응

- Technical implementation: 정본과 비정본 분리, SQLite 제약, 승인·충돌해결·구조 변경 트랜잭션, provenance snapshot, GPT-5.6 구조화 분류
- Design and UX: Command Center 우선순위에서 시작해 새 세션 식별, Continuity Brief, Conflict/State/Structure Operations, History 복원을 연결된 흐름에서 시연
- Potential impact: 장기 AI 작업에서 과거·미확정·충돌 정보가 정본을 오염시키는 문제 해결
- Quality of idea: 일반 대화 회상이 아니라 검증 상태와 권위 순서를 갖는 연속성 계층

## 공식 출처

- 2026-07-18 재확인: 제출 마감, 3분 미만 공개 YouTube 영상과 음성 설명, 저장소 접근, README 협업 설명, `/feedback` Session ID, 무료 테스트 경로, 영어 자료 요건을 공식 규칙·FAQ에서 확인했다.

- [x] 삭제 없는 보관·복원, 수명주기 승인 게이트, 보관 매니페스트, 읽기 전용 잠금을 구현했다.
- Design and UX 시연 흐름에 Archive & Lifecycle Center의 보관·복원을 포함한다.

- https://openai.com/build-week/
- https://openai.devpost.com/rules
- https://openai.devpost.com/details/faqs
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- [x] Project Index에서 전체 프로젝트 상태와 관계 그래프를 한 화면에 표시
- [x] 프로젝트 관계 생성·해제를 승인 기반 트랜잭션으로 처리
- [x] 자기참조·중복 관계·보관 프로젝트 변경 차단 테스트
- [x] 관계 기반 Context Bridge를 reference-only 경계로 조립
- [x] 연결 프로젝트 정본이 현재 프로젝트 정본에 섞이지 않는 불변식 테스트
- [x] Continuity Brief에서 연결 프로젝트를 비정본 참고 영역으로 표시
- [x] 연결 맥락을 강제 unverified 승인 후보로 승격
- [x] 원본 프로젝트·관계·항목 스냅샷 provenance 보존
- [x] 미결 승격과 관계 해제 경합 차단
- [x] 승격 원본의 내용·검증·작업 상태 drift 감지
- [x] fingerprint 기반 확인 및 재변경 경고 재개
- [x] 미확인 drift를 Archive 안전 차단 조건에 포함
