import { appendFileSync } from "node:fs";
import readline from "node:readline";

const logPath = process.argv[2];
const mute = process.argv[3] === "mute";

function record(line) {
  if (!logPath) return;
  appendFileSync(logPath, `${line}\n`);
}

function emit(line) {
  process.stdout.write(`${line}\n`);
}

let position = "";
let searchReplied = false;
let slowTimer;

function reply() {
  if (searchReplied) return;
  searchReplied = true;
  clearTimeout(slowTimer);
  emit("info depth 1 seldepth 1 multipv 1 score cp 10 nodes 3 nps 100 time 1 pv h2e2");
  emit(
    "info depth 2 seldepth 2 multipv 1 score cp 24 wdl 410 500 90 nodes 20 nps 200 time 2 pv h2e2 h9g7 b0c2",
  );
  emit("bestmove h2e2 ponder h9g7");
  record("OUT bestmove");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  record(`IN ${line}`);
  if (line === "quit") {
    process.exit(0);
  }
  if (mute) return;
  if (line === "uci") {
    emit("id name FakePikafish");
    emit("uciok");
    return;
  }
  if (line === "isready") {
    emit("readyok");
    return;
  }
  if (line.startsWith("position ")) {
    position = line;
    searchReplied = false;
    if (line.includes("invalid")) {
      process.stdout.write(
        "info string CRITICAL ERROR: Command failed. Reason: invalid fen\n",
        () => process.exit(1),
      );
      return;
    }
    return;
  }
  if (line.startsWith("go ")) {
    if (position.includes("invalid") || position.includes("hold") || position.includes("frozen"))
      return;
    if (position.includes("slow")) {
      slowTimer = setTimeout(reply, 300);
      return;
    }
    reply();
    return;
  }
  if (line === "stop") {
    if (position.includes("frozen")) return;
    reply();
  }
});

input.on("close", () => {
  process.exit(0);
});

process.stdout.on("error", () => {
  process.exit(0);
});
