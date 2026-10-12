# 引擎协议

皮卡鱼运行时说明：https://www.pikafish.com/wiki/reference/engine-runtime.html

一次 `analyze` 按这个顺序对引擎读写：

1. 发送 `uci`，等到 `uciok`。新进程在握手后直接 `position`。`ucinewgame` 只清理置换表和搜索历史，棋盘仍由 `position` 摆。
2. 发送 `position fen <fen>`。局面带历史着法时写成 `position fen <fen> moves <moves...>`。`moves` 从这张 FEN 起逐步落子；重复、长将和长捉依赖这条历史。
3. 发送 `go movetime <ms>`。调用方给了 `depth` 时改用对应的深度限制。
4. 收集 `info`，直到 `bestmove`。
   完成：返回值里的 bestmove、score、pv、depth 来自同一次搜索的最终 `info` 与 `bestmove`。

## 评分

分数从根局面当前行棋方看。正数有利于这一方。

- `score cp N`：按显示尺度换算后的普通评分（`round(100 × v / a)`，`a` 随盘上子力变化）。
- `score mate N`：UCI 步数计的胜负距离。正数表示行棋方胜，负数表示行棋方败。困毙和部分棋规判负也使用这套分数。
- `wdl W D L`：胜／和／负估计，单位千分比，三项合计 1000。

带 `lowerbound` 或 `upperbound` 时按分数界限理解。`bestmove` 后的 `ponder` 只是预计的对手回应，不表示引擎已经开始后台思考。

## 进程

- 结束搜索：先发送 `stop`，再等待 `bestmove`。`stop` 只设置停止标记。
- 同一个 `PikafishEngine` 实例上的搜索串行执行。
- 无法解析的局面或非法历史着法时，引擎会输出 `CRITICAL ERROR` 并退出。把这段消息交给调用方。
- 二进制路径：Windows `pikafish-engine/pikafish.exe`，Linux `pikafish-engine/pikafish`。NNUE 与二进制放在同一目录，由引擎自行加载。
- 握手、`stop`、串行搜索和 NNUE 路径留在 `PikafishEngine` 内。

## 接口

```ts
analyze(input: {
  fen: string
  moves?: string[]
  movetimeMs?: number
  depth?: number
}): Promise<{
  bestMove: string
  score: { type: 'cp' | 'mate'; value: number }
  pv: string[]
  wdl?: { win: number; draw: number; loss: number }
  depth: number
}>
```
