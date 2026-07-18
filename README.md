# LOGOS Continuity

검증된 Project Truth, Current State, Exploration, Next Actions와 Active Checkpoint를 분리하고, 사용자 승인 후에만 정본을 변경하는 로컬 연속성 엔진입니다.

## 현재 구현

- 새 세션의 자연어 요청에서 프로젝트를 `High / Medium / Low` 신뢰도로 식별합니다.
- `High`는 즉시 복구하고, `Medium`은 사용자 확인 후 복구하며, `Low`는 프로젝트에 연결하지 않습니다.
- Project Truth, Current State, Next Actions, Exploration, Active Checkpoint를 분리해 저장합니다.
- GPT-5.6 또는 안전한 로컬 폴백이 발언을 분류하지만 정본을 자동 변경하지 않습니다.
- 승인된 변경만 SQLite 트랜잭션으로 Commit하고 최근 변경을 Context Assembly에 포함합니다.
- Conflict Resolution Center에서 기존 정본과 충돌 후보를 비교하고 `기존 유지 / 이번 작업만 예외 / 새 결정으로 교체`를 선택합니다.
- 임시 예외는 Working Context에만 적용되며 종료할 수 있고, 정본 교체는 confirmed Commit과 해결 이력을 동시에 기록합니다.
- State Operations Center에서 Current State 변경, Next Action 생성·전환, Exploration 승격·종료, Checkpoint 갱신·해제를 운영합니다.
- Exploration 승격은 승인 전까지 `open`을 유지하고 승인 후에만 `promoted`와 정본 Commit을 함께 기록합니다.
- History & Provenance Center에서 정본 Commit, 충돌 해결, Exploration, Checkpoint 이벤트의 변경 전·후와 이유를 추적합니다.
- 과거 상태 복원은 직접 덮어쓰지 않고 현재 정본을 유지한 채 승인 대기 변경 후보를 생성합니다.
- Project Structure Center에서 Project Registry, 단일 Primary Goal, Workstream과 `Strategic Goal → Milestone → Task` 계층을 운영합니다.
- 구조 변경도 승인 전에는 반영하지 않으며, 승인 시 계층 불변식 검증과 History 기록을 한 트랜잭션으로 처리합니다.
- confirmed Task를 Next Action 승인 후보로 연결해 장기 목표 계층과 현재 실행 목록을 분리하면서 이어줍니다.
- Continuity Command Center에서 전체 프로젝트의 건강 점수, 위험 신호, 처리 우선순위와 권장 이동 경로를 한 화면에 제공합니다.
- Judge Mode에서 7개 핵심 화면을 2분 50초 순서로 안내하고 타이머, 발표 문장, 심사 증명 포인트와 샘플 입력을 제공합니다.
- Submission Evidence Center에서 공식 제출 요건을 `ready / action required / blocked`로 구분하고 영문 설명과 기술 증빙 Markdown을 생성합니다.
- 새 세션 복구 시 정본, 현재 상태, 다음 행동, Checkpoint, 검증 필요 항목을 사람이 읽는 Continuity Brief로 제공합니다.
- Continuity Brief를 Markdown으로 복사해 다음 세션이나 외부 작업에 전달할 수 있습니다.

## 실행

```powershell
& 'C:\Users\raykj\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' install
& 'C:\Users\raykj\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' dev
```

GPT-5.6 분류를 활성화하려면 `.env.example`을 `.env.local`로 복사하고 API 키를 입력합니다. `.env.local`은 Git에서 제외되며 키는 UI나 SQLite에 저장되지 않습니다.

```powershell
Copy-Item .env.example .env.local
# .env.local의 OPENAI_API_KEY 값을 입력
```

키가 없으면 앱은 `LOCAL SAFE MODE`를 표시하고 보수적인 결정론적 분류기를 사용합니다. Build Week 제출 데모에서는 `GPT-5.6 LIVE` 상태와 실제 분류 결과를 보여줘야 합니다.

- UI: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4318`

## 핵심 안전 규칙

- Truth와 Current State 변경은 변경 후보 생성 후 승인해야 Commit됩니다.
- `unverified` 또는 `conflicted` Next Action은 완료로 저장할 수 없습니다.
- `conflicted` 변경 후보는 해결 전 승인할 수 없습니다.
- 충돌 해결 결과와 당시 정본·제안 스냅샷은 별도 감사 기록으로 보존됩니다.
- `temporary_exception`은 Context Assembly에서 정본보다 먼저 적용되지만 Project Truth 자체는 변경하지 않습니다.
- Exploration 승격 후보가 거절되면 Exploration은 `open`으로 남고, `dismissed`는 정본 변경 없이 종료 상태만 기록합니다.
- Next Action 상태 전환도 변경 후보와 승인을 거치며, confirmed가 아니면 완료 처리할 수 없습니다.
- History 복원도 일반 변경과 동일한 승인 게이트를 통과하며, 승인된 복원 자체가 다시 새로운 History 이벤트로 남습니다.
- Checkpoint는 프로젝트당 하나이며 정본을 자동 변경하지 않습니다.
- Context Assembly는 Project Truth와 Current State를 Checkpoint, History, Exploration보다 높은 권위로 조립합니다.
- Milestone은 Strategic Goal 아래, Task는 Milestone 아래에만 둘 수 있습니다.
- confirmed 항목만 완료할 수 있고, 하위 항목이 남아 있으면 상위 목표를 완료할 수 없습니다.
- Workstream은 선택적 교차 분류이며 목표 계층의 부모 관계를 대신하지 않습니다.

## 핵심 데모

1. `새 세션 시작`에서 `LOGOS 해커톤 작업 이어가자`를 입력합니다.
2. LOGOS가 프로젝트를 `High`로 식별하고 Continuity Brief를 즉시 복구합니다.
3. 브리프에서 정본 Current State와 Next Action, `unverified` Checkpoint 경고가 분리된 것을 확인합니다.
4. `유료화도 생각해보자`를 입력해 Exploration에만 저장되는 것을 보여줍니다.
5. `유료화를 공식 제품 목표로 확정한다`를 입력해 승인 대기열을 만들고, 승인 후에만 Truth가 바뀌는 것을 보여줍니다.
6. 애매한 프로젝트 표현은 `Medium` 확인을 요구하고 일반 질문은 `Low`로 프로젝트에 연결하지 않는 것을 보여줍니다.
7. Conflict Center에서 기존 제품 목적과 충돌하는 후보를 만든 뒤, 임시 예외가 Truth를 바꾸지 않는지 확인합니다.
8. 같은 충돌을 `새 결정으로 교체`하면 사용자 승인 후에만 Truth 버전이 증가하는 것을 보여줍니다.
9. State Operations Center에서 Exploration을 Truth 후보로 승격하고 승인 전후의 `open → promoted` 변화를 보여줍니다.
10. Next Action을 `in_progress`로 전환하고 Checkpoint를 갱신한 뒤 복구 완료 시 해제합니다.
11. Structure Center에서 Registry와 `Strategic Goal → Milestone → Task` 계층을 확인합니다.
12. Task 상태 변경 후보를 만들고, 승인 전에는 계층이 유지되며 승인 후 History에 기록되는 것을 보여줍니다.
13. confirmed Task를 Next Action 후보로 연결해 목표 구조와 현재 실행 목록이 이어지는 것을 보여줍니다.
14. Current State를 변경한 뒤 History에서 BEFORE/AFTER와 변경 이유를 확인합니다.
15. `이 상태로 복원 후보`를 눌러 현재 정본이 즉시 바뀌지 않는지 확인하고 승인 후 복원합니다.

## Continuity Command Center

- 모든 프로젝트를 충돌, provenance drift, Working Exception, blocked action, 미결 승인, 검증 상태, Checkpoint 신선도로 평가합니다.
- 위험별 감점 내역을 노출해 건강 점수가 블랙박스가 되지 않도록 합니다.
- 정본 충돌, critical drift, 일반 drift, 예외, 승인 대기, 수명주기 검토 순으로 처리 우선순위를 계산합니다.
- 각 프로젝트의 가장 시급한 작업과 담당 Center를 제안하고 현재 프로젝트에서는 해당 화면으로 바로 이동합니다.
- 프로젝트 전환이 필요한 경우 먼저 안전하게 선택 프로젝트를 바꾸고 다음 이동 경로를 안내합니다.

## Guided Demo / Judge Mode

- 상단 `심사 모드`에서 Command Center부터 Assembled Context까지 7단계 데모를 시작합니다.
- 전체 목표 시간은 2분 50초이며 실제 경과 시간이 3분을 넘으면 타이머가 경고 색상으로 바뀝니다.
- 단계마다 발표 문장, 심사위원에게 보여줄 증명 포인트, 샘플 입력과 해당 화면 바로 열기를 제공합니다.
- 화면 이동은 폼을 미리 채우거나 Center를 열기만 하며 정본 변경이나 승인을 자동 실행하지 않습니다.
- 녹화용 상세 대본은 `docs/JUDGE_DEMO_SCRIPT.md`에 있습니다.

## Submission Evidence Center

- 상단 `제출`에서 공식 Build Week 제출 요건 13개와 현재 준비도를 확인합니다.
- 구현으로 확인 가능한 항목과 YouTube 업로드, 저장소 URL, `/feedback` Session ID처럼 사용자가 완료해야 하는 외부 작업을 분리합니다.
- `OPENAI_API_KEY`가 없으면 GPT-5.6 LIVE 증빙을 완료 처리하지 않고 `blocked`로 표시합니다.
- Devpost용 영문 프로젝트 설명, 핵심 기능, Codex·사용자·GPT-5.6 기여 구분, 아키텍처와 테스트 지침을 제공합니다.
- 전체 Evidence Pack을 Markdown으로 복사하거나 `LOGOS_CONTINUITY_SUBMISSION_EVIDENCE.md`로 다운로드할 수 있습니다.
- 기준 출처는 OpenAI Build Week 공식 페이지, Devpost 공식 규칙과 FAQ입니다.

## Portable Judge Build

- `pnpm package:judge`는 프로덕션 UI, TypeScript 서버, 데모 대본과 플랫폼별 실행기를 하나의 ZIP으로 패키징합니다.
- 결과물은 `artifacts/LOGOS-Continuity-Judge.zip`이며 SHA-256과 생성 시각을 `artifacts/judge-build-manifest.json`에 기록합니다.
- 심사위원은 npm·pnpm·빌드 과정 없이 Node.js 24 이상만 설치하면 실행할 수 있습니다.
- Windows는 `start-windows.cmd`, macOS/Linux는 `bash start.sh`로 실행하며 첫 시작 시 로컬 SQLite 데모 DB를 생성합니다.
- 패키지 내부에서도 Portable Build 마커를 인식해 Submission Evidence의 무료 테스트 경로를 `ready`로 표시합니다.

```powershell
& 'C:\Users\raykj\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' package:judge
```

## Public Judge Deployment

- 루트 `Dockerfile`은 Node.js 24 다단계 빌드로 UI를 생성하고 런타임 이미지에는 정적 결과와 서버만 포함합니다.
- `render.yaml`은 Singapore 리전의 무료 Docker Web Service와 `/api/health` 검사를 정의하며, API 키 없이 Local Safe Mode로 즉시 배포됩니다.
- 서버는 로컬에서 `127.0.0.1`, 배포 환경에서 `HOST=0.0.0.0`으로 바인딩합니다.
- Render 무료 서비스의 SQLite는 일시적이므로 재시작·재배포·유휴 중지 후 데모 상태가 초기화됩니다. 이는 영속 프로덕션 저장소가 아니라 심사용 테스트 경로입니다.
- 실제 공개 URL 생성 절차와 무료 요금제 제약은 `docs/PUBLIC_DEPLOYMENT.md`에 있습니다.

## Provenance Drift Monitor

- committed Context 승격의 원본 스냅샷과 현재 원본 항목을 비교합니다.
- 내용, 검증 상태, 작업 상태, 범주, 원본 프로젝트 상태 변경을 fingerprint 기반으로 감지합니다.
- 동일한 드리프트는 확인 메모와 함께 숨길 수 있지만 원본이 다시 변경되면 새 fingerprint로 경고가 재개됩니다.
- 드리프트 확인은 현재 프로젝트 정본을 자동 변경하지 않으며 History에 baseline/current diff를 기록합니다.
- 확인되지 않은 provenance drift는 Archive 안전 차단 조건에 포함됩니다.
- promotion provenance가 존재하는 프로젝트 관계는 출처 보존을 위해 해제할 수 없습니다.

## Context Promotion Center

- 연결 프로젝트의 confirmed Truth, Current State, 열린 Next Action을 현재 프로젝트의 승인 후보로 선택할 수 있습니다.
- 외부 프로젝트에서 confirmed인 항목도 현재 프로젝트에서는 항상 `unverified` 후보로 시작합니다.
- 승인 전에는 현재 프로젝트 정본이 변경되지 않으며, 거절하면 provenance만 cancelled 상태로 남습니다.
- 원본 프로젝트, 관계, 원본 항목 스냅샷, 생성 이유를 `context_promotions`에 보존합니다.
- 승인 시 대상 프로젝트 Commit History와 원본 프로젝트의 reference promotion History를 함께 기록합니다.
- 미결 승격이 있으면 해당 프로젝트 관계를 해제할 수 없어 출처 연결이 끊기지 않습니다.

## Relationship-Aware Context Bridge

- 승인된 프로젝트 관계만 새 세션 복구와 Context Assembly의 연결 참고 정보로 사용합니다.
- 연결 프로젝트의 confirmed 신호, Current State, Checkpoint, 열린 Next Action을 `linkedProjectReferences`에 별도 조립합니다.
- 연결 참고 정보는 `reference_only`이며 현재 프로젝트의 Truth, Current State, Next Actions로 자동 병합되지 않습니다.
- 관계 방향은 정본 권위를 부여하지 않으며, 연결 정보를 반영하려면 현재 프로젝트에서 별도 승인 후보를 만들어야 합니다.
- Continuity Brief와 복구 UI에서 연결 프로젝트를 명시적인 비정본 영역으로 표시합니다.

## Project Index & Relationship Map

- 모든 프로젝트의 상태, 정본 수, 열린 작업, 미결 승인, Checkpoint, 연결 수를 포트폴리오 카드로 비교합니다.
- `depends_on / supports / related_to / supersedes` 관계를 정규화된 방향 그래프로 저장합니다.
- 관계 생성과 해제는 후보 생성 후 사용자 승인 전까지 실제 그래프를 변경하지 않습니다.
- 자기참조와 중복 관계를 차단하고, 보관된 출발 프로젝트는 복원 승인 전까지 관계를 변경할 수 없습니다.
- 승인된 관계 변경은 출발·대상 양쪽 프로젝트 History에 provenance와 함께 기록됩니다.
- 미결 관계 후보는 Archive 안전 차단 조건에 포함됩니다.

## Archive & Lifecycle Center

- 프로젝트를 `paused / dormant / abandoned`로 보관하고 `active`로 복원합니다.
- 보관 전 미결 정본·구조 승인과 활성 Working Exception을 차단합니다.
- 승인 시 Truth, Action, Exploration, History, Structure, Checkpoint 수량과 복귀 지시를 스냅샷으로 보존합니다.
- 보관된 프로젝트는 복원 승인 전까지 읽기 전용이며 어떤 상태 데이터도 삭제하지 않습니다.
- 데모에서는 `보관`을 열어 후보 생성 → 승인 전 상태 유지 → 스냅샷 생성 → `active` 복원 순서를 보여줍니다.

## OpenAI Build Week

- 선택 트랙: **Work and Productivity**
- Codex: 프로젝트 설계, 구현, 테스트, 브라우저 QA에 사용
- GPT-5.6: 새 세션의 프로젝트 식별과 자연어 발언의 Exploration, Truth 후보, Current State, Next Action 분류
- 제출 전 확인: `docs/BUILD_WEEK_CHECKLIST.md`
- 제출 README에는 Codex가 가속한 부분과 사용자가 직접 내린 제품·설계·엔지니어링 결정을 구분해 기록합니다.

## 검증

```powershell
& 'C:\Users\raykj\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' test
& 'C:\Users\raykj\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' build
```
