# open_magi

[English](README.md) | 繁體中文

`open_magi` 會把 Magi 審議流程打包成可安裝的 OpenCode plugin。它會加入
`magi` skill、三個唯讀 deliberator subagent，以及一個 runtime hook，讓長任務
可以依照明確的驗證指令持續推進，直到完成為止。

## 支援狀態

目前只支援 OpenCode。現在的 installer、config writer、runtime hook，以及內建
的 `magi` skill 都是為 OpenCode 設計。

未來計畫：

1. 先透過實際專案使用穩定 OpenCode plugin 與 Magi protocol。
2. 若 Copilot CLI 的 extension point 足以支援 loop control、subagent
   delegation、artifact 檢查，再加入 Copilot CLI adapter。
3. 使用 Claude Code 原生的安裝與 workflow 機制加入 Claude Code adapter。
4. 使用 Codex 原生的 skill 或 plugin 機制加入 Codex CLI adapter。

未來每個 adapter 都應該使用該 coding agent 自己的安裝路徑與 runtime 模型。
Magi protocol 可以盡量共用，但不假設 OpenCode runtime hook 能直接套用到其他
agent。

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
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup --model deepseek-v4-flash
```

npm package 發布後，可以改用較短的 npm 安裝方式：

```bash
opencode plugin open-magi-opencode -g
npx open-magi-opencode setup --model deepseek-v4-flash
```

請 AI agent 幫你安裝時，可以貼這段：

```text
請從 `open_magi` repo 安裝公開的 OpenCode plugin `open-magi-opencode`：
https://github.com/ladiossoop5star/open_magi

請使用以下指令：

opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git open-magi setup --model deepseek-v4-flash

安裝後請確認 ~/.config/opencode/opencode.json 裡有 plugin entry，以及三個唯讀
subagent：deliberator-melchior、deliberator-balthasar、deliberator-casper。
也請確認 ~/.config/opencode/skills/magi/SKILL.md 存在。
```

如果你的 provider/model 名稱不同，請把
`deepseek-v4-flash` 換成你的 OpenCode `opencode.json` 裡已設定的模型。
setup 指令必須明確指定模型；它不會自動寫入 placeholder default model。

## 更新

如果你是直接從這個 GitHub repo 安裝，使用同一個來源加上 `--force`，
然後重新執行 setup：

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g -f
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup --model deepseek-v4-flash
```

npm package 發布後，若你是從 npm 發布版本安裝，使用 `--force` 取代已安裝的
plugin 版本，再重新執行 setup 更新本機 skill 檔案：

```bash
opencode plugin open-magi-opencode -g -f
npx open-magi-opencode setup --model deepseek-v4-flash
```

setup 會刷新 `~/.config/opencode/skills/magi`，並保留其他 OpenCode 設定。
如果你的本機設定使用不同 provider/model，請替換上面的 model 名稱。

## Setup 會寫入哪些檔案

`open-magi setup` 會寫入 OpenCode config 目錄，預設位置是：

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

setup 會保留既有的 `provider`、`agent`、`plugin` 設定，只新增或更新：

- `plugin[]`: `open-magi-opencode`，除非 OpenCode 已經直接註冊這個 repo package。
- `agent.deliberator-melchior`
- `agent.deliberator-balthasar`
- `agent.deliberator-casper`

三個 deliberator agent 都是 subagent，並且設定 `edit=deny`、`bash=deny`。

## Setup 選項

```bash
open-magi setup \
  --model deepseek-v4-flash \
  --config-dir ~/.config/opencode \
  --plugin-spec open-magi-opencode
```

Dry run：

```bash
open-magi setup --dry-run
```

環境變數：

```bash
OPEN_MAGI_MODEL=deepseek-v4-flash open-magi setup
OPENCODE_CONFIG_DIR=/path/to/opencode-config open-magi setup
```

必須提供 `--model` 或 `OPEN_MAGI_MODEL`。

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
