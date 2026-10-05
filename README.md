# opencode-go-pool

### Go 계정의 한도가 끝나도, 쓰던 모델은 그대로.

**OpenCode Go 계정을 여러 개 등록하면, 사용 가능한 계정으로 자동으로 넘겨주는 플러그인입니다.**

예를 들어 A 계정으로 Kimi를 쓰다가 한도가 끝나면, B 계정의 **같은 Kimi 모델**로 요청을 다시 보냅니다.

```text
내가 선택한 모델: Kimi

Go A · 한도 도달 ──→ Go B · 사용 가능 ──→ Kimi로 계속 작업
                         │
                         └─ B도 사용할 수 없으면 다음 Go 계정 확인

모든 계정이 막혔다면? 재시도를 멈추고 알려줍니다.
```

[빠른 시작](#빠른-시작-macos) · [명령어](#자주-쓰는-명령어) · [동작 방식](#언제-계정을-바꾸나요) · [설정](#원하는-모델만-쓰고-싶다면) · [문제 해결](#자주-묻는-질문)

## 무엇이 편해지나요?

| 기능 | 쉽게 말하면 |
| --- | --- |
| **계정 자동 전환** | 한도 때문에 막히면 다른 Go 계정으로 이어갑니다. |
| **같은 모델 유지** | Kimi를 골랐는데 갑자기 DeepSeek으로 바뀌지 않습니다. |
| **사용량 자동 확인** | 기본 1시간마다, 최근 사용한 계정은 10분마다 확인합니다. |
| **여러 모델 지원** | DeepSeek뿐 아니라 GLM, Kimi, MiniMax, Qwen, Grok, GPT 등 Go 카탈로그 33개 모델을 포함합니다. |
| **모델 기능 반영** | 모델마다 이미지 입력, 추론 강도, 도구 호출 같은 지원 정보를 적용합니다. |
| **반복 재시도 방지** | 같은 요청에서 이미 실패한 계정은 다시 선택하지 않습니다. |

> **현재는 초기 버전입니다.** GitHub에서 내려받아 설치할 수 있으며, npm에는 아직 게시하지 않았습니다. 실제 제공 모델과 구독 권한은 Go 서버가 결정합니다.

## 준비물

- [OpenCode](https://opencode.ai) **1.18.33 이상, 1.x 버전**
- [Node.js](https://nodejs.org) **최신 LTS 버전 권장** — 최소 Node.js 22
- [OpenCode Go](https://opencode.ai/docs/go/) 계정의 **API 키**
- Git — 이 저장소를 내려받을 때 사용합니다.

**API 키는 계정을 사용할 수 있게 해주는 비밀번호 같은 값**입니다. README, 채팅, GitHub에 붙여넣지 말고 아래 등록 명령의 숨김 입력창에 넣어주세요.

## 빠른 시작 — macOS

### 1. 내려받기

터미널에서 실행합니다.

```sh
git clone https://github.com/haechan1103/opencode-go-pool.git
cd opencode-go-pool
npm install
```

### 2. Go 계정 등록하기

```sh
node bin/cli.js add A
node bin/cli.js add B
```

`Go API key (hidden):`이 뜨면 해당 계정의 키를 붙여넣고 Enter를 누르세요. **입력한 글자가 화면에 보이지 않는 것은 정상입니다.**

- `A`, `B`는 계정을 구분하는 이름입니다. 이메일을 적는 칸이 아닙니다.
- 세 번째 계정은 `node bin/cli.js add C`로 추가합니다.
- 키는 macOS **Keychain(키체인)**에 저장됩니다. 코드나 설정 파일에는 저장하지 않습니다.
- 기존 `OPENCODE_GO_KEY_A` 환경변수 또는 같은 이름의 Keychain 항목이 있으면 다시 입력하지 않고 사용합니다.

등록 상태와 실제 사용량을 확인합니다.

```sh
node bin/cli.js status
node bin/cli.js usage
```

### 3. OpenCode에 플러그인 연결하기

먼저 이 파일의 **전체 경로**를 출력합니다.

```sh
node -e 'console.log(require("node:path").resolve("src/plugin.js"))'
```

출력된 경로를 OpenCode 설정 파일 `~/.config/opencode/opencode.json` 또는 `opencode.jsonc`의 `plugin` 목록에 넣습니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-go-pool/src/plugin.js"]
}
```

`/absolute/path/...`는 예시입니다. **방금 출력된 본인 컴퓨터의 경로로 바꿔주세요.** 기존 설정에 다른 내용이 있다면 파일 전체를 덮어쓰지 말고 `plugin` 목록에 항목만 추가합니다.

예전에 만든 `account-fallback.js`를 사용 중이라면 그 플러그인 등록은 제거하세요. 두 자동 전환 플러그인을 동시에 켜면 같은 요청을 중복 처리할 수 있습니다.

### 4. 재시작하고 모델 선택하기

OpenCode를 완전히 종료한 뒤 다시 실행합니다.

```sh
opencode
```

모델 목록에서 **`OpenCode Go Pool A`**, **`OpenCode Go Pool B`** 등의 계정을 선택하고, 그 안에서 원하는 모델을 고르세요.

**이제 해당 Go Pool 모델을 쓰면 자동 조회와 계정 전환이 동작합니다.** 일반 `/connect`로 연결한 다른 provider는 건드리지 않습니다.

macOS에서는 Keychain을 직접 읽으므로 새 터미널마다 `source go-accounts sync`를 할 필요가 없습니다.

## 자주 쓰는 명령어

아래 명령은 내려받은 `opencode-go-pool` 폴더에서 실행합니다.

| 하고 싶은 일 | 명령어 |
| --- | --- |
| A 계정 등록 | `node bin/cli.js add A` |
| A의 저장된 키 교체 | `node bin/cli.js add A --replace` |
| 등록·키 인식 여부 확인 | `node bin/cli.js status` |
| 모든 계정의 사용량 확인 | `node bin/cli.js usage` |
| A의 사용량만 확인 | `node bin/cli.js usage A` |
| 지원 모델 목록 확인 | `node bin/cli.js models` |
| A를 자동 전환 목록에서 제거 | `node bin/cli.js remove A` |

`remove`는 플러그인의 계정 등록만 제거합니다. Keychain에 저장된 키까지 삭제하지는 않습니다.

계정 이름은 `A`, `B`, `TEAM1`처럼 영문자로 시작하고 영문·숫자·밑줄을 사용하는 이름입니다. 최대 32자, 계정은 최대 100개까지 등록할 수 있습니다.

## 언제 계정을 바꾸나요?

**지금 선택한 계정을 사용할 수 있으면 그대로 씁니다.** 잔여량이 4%라고 바로 바꾸지는 않습니다.

1. **한도에 걸린 것을 확인하면** 다른 사용 가능한 Go 계정을 선택합니다.
2. 조회 사이에 실제 요청이 **한도·인증 오류로 실패해도**, 다음 계정으로 같은 요청을 다시 보냅니다.
3. 다시 보낼 때 **모델·선택한 추론 강도·첨부파일을 유지**합니다.
4. 같은 요청에서 실패한 계정은 다시 선택하지 않습니다.
5. 모든 계정을 사용할 수 없으면 자동 재전송을 멈추고 알려줍니다.

| 상태 | 확인 주기 |
| --- | --- |
| 기본 | 1시간마다 |
| 최근 20분 안에 사용한 계정 | 10분마다 |
| 사용이 끊긴 계정 | 다시 1시간 주기 |
| 한도 리셋 시각이 지난 계정 | 다음 스케줄 확인 때 재조회 |

이 자동 조회는 **OpenCode가 실행 중일 때** 동작합니다. 사용량은 모델별이 아닌 **계정별**입니다. 단기·주간·월간 중 하나라도 한도에 걸리면 해당 계정을 건너뜁니다.

조회가 잠깐 실패하면 마지막 정상 사용량 정보를 유지합니다. 실패했다고 새로 한도 소진으로 판단하지 않습니다.

## 원하는 모델만 쓰고 싶다면

계정을 등록하면 `~/.config/opencode/go-pool.json`이 만들어집니다. `models`를 추가하면 원하는 모델만 목록에 표시할 수 있습니다.

```json
{
  "enabled": true,
  "accounts": ["A", "B", "C"],
  "models": ["deepseek-v4.1-flash", "kimi-k3", "glm-5.3-flash"],
  "polling": {
    "idleMinutes": 60,
    "activeMinutes": 10,
    "activeWindowMinutes": 20
  }
}
```

- `models`를 생략하면 포함된 Go 모델을 모두 등록합니다.
- 정확한 모델 이름은 `node bin/cli.js models`로 확인합니다.
- `polling` 숫자는 **분 단위**입니다.
- 계정이나 모델 목록을 바꾸면 OpenCode를 재시작합니다.
- 다른 설정 경로를 쓰려면 `OPENCODE_GO_POOL_CONFIG` 또는 `XDG_CONFIG_HOME`을 사용합니다.

## 키는 어디에 있나요?

| 저장 위치 | 들어가는 내용 |
| --- | --- |
| macOS Keychain / 본인의 환경변수 | 실제 API 키 |
| `~/.config/opencode/go-pool.json` | 계정 이름, 모델 이름, 조회 주기 — 키 없음 |
| `~/.local/share/opencode-go-pool/` | 사용량 캐시, 오류 대기 상태 — 키 없음 |
| 이 GitHub 저장소 | 코드, 테스트, 공개 모델 정보, 문서 — 개인 키 없음 |

플러그인은 실행 중에 키를 메모리에서 사용하지만 **키·인증 헤더·API 오류 원문을 출력하거나 파일로 기록하지 않습니다.** 사용량 조회와 모델 요청을 보낼 때는 인증을 위해 Go 서버에 키를 전달합니다.

## 자주 묻는 질문

### GPT나 Grok를 고르면 OpenAI/xAI 계정으로 바뀌나요?

아니요. **Go에서 제공하는 GPT/Grok 모델을 Go 키로 사용**하는 것입니다. 별도 OpenAI/xAI 계정으로 전환하지 않습니다.

### Windows나 Linux도 되나요?

환경변수 방식으로 사용할 수 있습니다. 본인의 환경에 `OPENCODE_GO_KEY_A`, `OPENCODE_GO_KEY_B` 등을 설정한 뒤 같은 터미널에서 `add A`, `add B`로 등록하고 OpenCode를 실행하세요. 이 명령에는 키가 아닌 계정 이름만 넣습니다.

macOS 외의 운영체제에서 키를 저장해주는 기능은 아직 없습니다. Windows의 기본 설정·데이터 경로는 AppData이며, XDG 경로도 지원합니다.

### `Invalid API key`가 나와요.

`status`는 **키가 존재하는지**, `usage A`는 **Go 서버에서 조회가 성공하는지** 확인합니다. 키를 교체했다면 OpenCode를 재시작하세요. 환경변수 방식이라면 OpenCode를 실행한 터미널에 그 변수가 있어야 합니다.

### 모든 계정이 막히면 계속 돌지 않나요?

같은 요청에서 이미 실패한 계정을 다시 선택하지 않으므로 반복 재전송을 멈춥니다. 계정을 찾을 수 없을 때 최초 요청 자체가 서버에서 실패하는 것까지 항상 막아주는 것은 아닙니다.

### 오류 때문에 잠시 제외된 계정을 다시 쓰고 싶어요.

OpenCode에서 **“Go Pool 상태 확인해줘”** 또는 **“Go Pool 오류 쿨다운 초기화해줘”**라고 요청할 수 있습니다. 도구 이름은 `go_pool_status`, `go_pool_reset`입니다. 초기화해도 실제 사용량 한도와 같은 요청의 재시도 제한은 유지됩니다.

### 모든 모델에서 이미지가 되나요?

모델마다 다릅니다. `models` 명령이 `text,image`라고 표시하는 모델은 카탈로그상 이미지 입력을 지원합니다. 실제 동작은 Go 서버의 모델 제공 상태에도 영향을 받습니다.

## 개발자용 안내

```sh
npm run check          # 코드 검사 + 테스트
npm run catalog:update # 공개 Go 모델 정보 갱신
npm run check:secrets  # 업로드 대상 파일 검사: 의심되는 값은 출력하지 않음
npm pack --dry-run     # npm에 포함될 파일 확인
```

모델 정보는 [models.dev의 OpenCode Go 카탈로그](https://github.com/anomalyco/models.dev/tree/dev/providers/opencode-go)에서 가져오며, 함께 사용하는 기반 모델 정보와 소스 커밋을 기록합니다. 실행 중에는 내려받은 목록이 아니라 저장소에 포함된 스냅샷을 사용합니다.

비용 표시는 카탈로그 기반 **추정치**입니다. OpenCode v1 설정으로 표현할 수 없는 가격 구간은 포함하지 않아 실제 청구액과 다를 수 있습니다. 사용 한도는 별도의 usage API로 확인합니다.

<details>
<summary>코드 구조와 오류별 대기 시간 보기</summary>

```text
src/plugin.js       OpenCode 진입점
src/hooks.js        모델 등록·계정 전환·요청 재전송
src/pool.js         조회 주기·공유 잠금·오류 대기 상태
src/usage.js        사용량 조회와 응답 검증
src/credentials.js  환경변수·macOS Keychain
src/catalog.js      공개 모델 정보 로드
src/config.js       설정·계정 이름·저장 경로
bin/cli.js          등록·상태·사용량·모델 목록 명령
catalog/           모델 정보 스냅샷
test/              모의 응답 기반 테스트
examples/          키 없는 설정 예시
```

- 실제 한도 리셋 시각을 알면 그 시각까지 계정을 제외합니다.
- 리셋 시각을 모르는 한도 오류는 10분, 인증 오류는 15분 동안 임시 제외합니다.
- 요청 과다 오류는 해당 계정·모델만 5분, 서버·네트워크 오류는 2분 제외합니다.
- 알 수 없는 오류는 자동 전환하지 않습니다.

</details>

검증은 모의 API와 가짜 키로 모델 등록, 조회 주기, 계정 한도 공유, 모델별 오류 구분, 첨부·추론 강도 유지, 반복 방지, 민감정보 비출력을 확인합니다. 모든 모델에 실제 생성 요청을 보낸 테스트는 아닙니다.

## 배포 상태와 라이선스

**현재 설치 방법은 위의 GitHub 내려받기 방식입니다.** npm 게시 전이므로 `npx opencode-go-pool`을 설치 방법으로 사용하지 마세요.

유지관리자가 npm에 게시하려면 검사를 통과한 뒤 `npm pack --dry-run`으로 파일을 확인하고 `npm publish --access public`을 실행합니다. 패키지는 `package.json`의 `files` 목록에 있는 파일만 포함합니다.

MIT License · 공개 모델 데이터의 출처와 라이선스는 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)를 참고하세요.
