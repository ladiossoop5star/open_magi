# open_magi

[English](README.md) | 繁體中文

`open_magi` 會把 Magi 審議流程打包成可安裝的 OpenCode plugin。它會加入
`magi` skill、三個唯讀 deliberator subagent，以及一個 runtime hook，讓長任務
可以依照明確的驗證指令持續推進，直到完成為止。

## 支援狀態

OpenCode 是目前唯一 production-supported runtime。現在最完整的 installer、
config writer、runtime hook，以及 runtime backstop 都是為 OpenCode 設計。

Codex 支援目前是 experimental。它有獨立的 Codex plugin package root、Codex
skill、Stop hook，以及 setup CLI，但還沒有 OpenCode 等級的 timeout、
auto-continue、question denial、artifact repair runtime backstop。

未來計畫：

1. 先透過實際專案使用穩定 OpenCode plugin 與 Magi protocol。
2. 驗證 Codex-native hooks 與 custom agents 是否能補齊 runtime backstop。
3. 若 Copilot CLI 的 extension point 足以支援 loop control、subagent
   delegation、artifact 檢查，再加入 Copilot CLI adapter。
4. 使用 Claude Code 原生的安裝與 workflow 機制加入 Claude Code adapter。

未來每個 adapter 都應該使用該 coding agent 自己的安裝路徑與 runtime 模型。
Magi protocol 可以盡量共用，但不假設 OpenCode runtime hook 能直接套用到其他
agent。各 adapter 的設定檔也應放在該 coding agent 自己的設定目錄，不放在共用
的 Open Magi global config 目錄。

## Adapter Package Layout

repo 內會把共用 Magi protocol asset 和可安裝 adapter package 分開：

```text
shared/magi/
  prompts/
  references/

skills/magi/
  OpenCode 安裝用的 magi skill

adapters/codex/
  .codex-plugin/
  bin/
  hooks/
  lib/
  skills/magi/
```

`shared/magi` 只作為維護 source of truth，不會直接安裝到 OpenCode 或 Codex。
測試會強制 shared prompts/common references 和各 adapter skill 保持一致，同時
允許每個 adapter 擁有自己的 runtime reference。

OpenCode npm package 只包含 OpenCode runtime plugin、OpenCode setup CLI、
OpenCode `skills/magi`。Codex marketplace entry 指向 `./adapters/codex`，
所以 Codex 只會安裝 Codex plugin manifest、Codex Stop hook、Codex setup CLI、
Codex `skills/magi`。

## 開發衛生

小修改、文件更新、一般 debug 可以直接 commit 到 `main`。高風險或大型變更請先開
branch，驗證完成後再合併回 `main`。

真實 runtime log、本機測試資料、私人筆記不要進 repository。`.gitignore` 會擋住
`.open_magi/`、`docs/superpowers/`、`.env` 檔、editor swap files、`tmp/`。
測試 fixture 請使用 generic path，例如 `/tmp/open_magi_repo`，以及 generic user，
例如 `example-user`。

公開 push 前請先執行：

```bash
npm test
npm pack --dry-run
git diff --check
```

## 安裝

在 npm package 正式發布前，請直接從公開 GitHub repo 安裝：

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g
```

npm package 發布後，可以改用較短的 npm 安裝方式：

```bash
opencode plugin open-magi-opencode -g
```

請 AI agent 幫你安裝時，可以貼這段：

```text
請從 `open_magi` repo 安裝公開的 OpenCode plugin `open-magi-opencode`：
https://github.com/ladiossoop5star/open_magi

請使用以下指令：

opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g

plugin install 會先寫入 template。安裝後請編輯 ~/.config/opencode/opencode.json，
把三個 `default-model` 改成 deliberator-melchior、deliberator-balthasar、
deliberator-casper 要使用的 OpenCode model。也請確認
~/.config/opencode/skills/magi/SKILL.md 存在。
```

請使用你的 OpenCode `opencode.json` 裡已設定的模型。三個 deliberator 可以共用
同一個 model，也可以讓 Melchior、Balthasar、Casper 各自使用不同 model。改完
model 後請重啟 OpenCode。

## Codex 實驗說明

Codex 支援會獨立包在 `adapters/codex`。不要用 OpenCode npm package 或
OpenCode setup 指令來設定 Codex。現在的 Codex 安裝、設定與限制請看
[Codex experimental notes](adapters/codex/README.md)。

## 更新

如果你是直接從這個 GitHub repo 安裝，使用同一個來源加上 `--force`：

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g -f
```

npm package 發布後，若你是從 npm 發布版本安裝，使用 `--force` 取代已安裝的
plugin 版本，重新觸發 install hook 更新本機 skill 檔案：

```bash
opencode plugin open-magi-opencode -g -f
```

plugin install hook 會刷新 `~/.config/opencode/skills/magi`，並保留其他
OpenCode 設定。如果三個 model 值仍是 `default-model`，請手動修改，或使用下面的
setup 指令直接寫入真實模型。

## 安裝會寫入哪些檔案

plugin install 會寫入 OpenCode config 目錄，預設位置是：

```text
~/.config/opencode/
```

會產生或更新：

```text
~/.config/opencode/opencode.json
~/.config/opencode/skills/magi/SKILL.md
~/.config/opencode/skills/magi/prompts/melchior.md
~/.config/opencode/skills/magi/prompts/balthasar.md
~/.config/opencode/skills/magi/prompts/casper.md
```

install hook 會保留既有的 `provider`、`agent`、`plugin` 設定，只新增或更新：

- `plugin[]`: `open-magi-opencode`，除非 OpenCode 已經直接註冊這個 repo package。
- `agent.deliberator-melchior`
- `agent.deliberator-balthasar`
- `agent.deliberator-casper`

三個 deliberator agent 都是 subagent，並且設定 `edit=deny`、`bash=deny`。

## Setup 選項

CLI setup 指令是選用的。如果 install hook 被跳過，可以用它修復或重新產生設定。
如果你要刻意寫入可手動編輯的 `default-model` placeholder，需要明確指定：

```bash
open-magi setup --allow-default-model
```

接著編輯 `~/.config/opencode/opencode.json`，替換：

```text
agent.deliberator-melchior.model
agent.deliberator-balthasar.model
agent.deliberator-casper.model
```

三個 deliberator 共用同一個 model，且不使用 placeholder：

```bash
open-magi setup \
  --model deepseek-v4-flash \
  --config-dir ~/.config/opencode \
  --plugin-spec open-magi-opencode
```

三個 deliberator 各自使用不同 model：

```bash
open-magi setup \
  --melchior-model model-a \
  --balthasar-model model-b \
  --casper-model model-c
```

Dry run：

```bash
open-magi setup --model deepseek-v4-flash --dry-run
```

環境變數：

```bash
OPEN_MAGI_MODEL=deepseek-v4-flash open-magi setup
OPEN_MAGI_MELCHIOR_MODEL=model-a \
OPEN_MAGI_BALTHASAR_MODEL=model-b \
OPEN_MAGI_CASPER_MODEL=model-c \
  open-magi setup
OPENCODE_CONFIG_DIR=/path/to/opencode-config open-magi setup --model deepseek-v4-flash
```

互動式 prompt 模式：

```bash
open-magi setup --interactive
```

## 使用方式

安裝後，在專案目錄啟動 OpenCode：

```bash
opencode .
```

然後要求 Magi：

```text
magi，目標是：修好測試，直到 npm test 全部通過。
```

也可以使用：

```text
magi，目標是：完成這個 refactor 並跑驗證。
三智者 loop，goal: diagnose this bug and fix it.
deliberation loop until done.
```

## Runtime 檔案

Magi 在每個專案中的 runtime log 會寫在：

```text
.open_magi/magi-log/
```

預期結構：

```text
.open_magi/magi-log/
├── state.json
├── checklist.md
├── round-001/
│   ├── research-prompt.md
│   ├── council-001/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   ├── report-casper.md
│   │   └── synthesis.md
│   ├── verdict.md
│   └── verification.md
└── final-report.md
```

`checklist.md` 是必要的 phase-transition gate。Magi 進入下一階段前會讀取
它；如果缺少 `council-001/report-melchior.md`、
`council-001/report-balthasar.md`、`council-001/report-casper.md` 等必要
artifact，plugin 會重新打開 loop 要求修復。

修改 code 之前，Magi 可以在同一個 round 內進行多次 bounded council pass：
預設最多 3 次，困難問題硬上限 5 次。前兩次使用一票否決制，避免太早實作；
達到上限仍未完全收斂時，Magi 必須選擇最小、可回退、可驗證的下一步，而不是
詢問使用者 debug 方向。

deliberator timeout 是由 plugin 強制執行，不只是 prompt 約束。預設每個
deliberator child session 最多 30 分鐘。逾時時，plugin 會對該 child session
呼叫 OpenCode `session.abort`，並在目前 council 目錄直接寫入對應 timeout
report，例如：

```text
.open_magi/magi-log/round-001/council-001/report-melchior.md
```

timeout report 會使用 `status: timeout`、`stance: needs_evidence`、
`blocking_objection: yes`，讓 council gate 可以繼續判定，不需要詢問使用者
下一步方向。

## 測試

```bash
npm test
npm pack --dry-run
```

Live E2E 測試需要可用的 OpenCode provider。在這個環境中請使用：

```bash
opencode run --agent build --model deepseek-v4-flash \
  "Use the magi skill. Goal: create result.txt with PASS. Verification command: grep -qx PASS result.txt"
```
