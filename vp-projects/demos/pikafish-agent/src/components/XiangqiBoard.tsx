"use client";

import type { ComponentProps, ReactElement } from "react";
import { Chessboard } from "react-xiangqiboard";

import type { SideToMove } from "@/lib/xiangqi/position";

type Arrow = NonNullable<ComponentProps<typeof Chessboard>["customArrows"]>[number];
type CustomPieces = NonNullable<ComponentProps<typeof Chessboard>["customPieces"]>;

export const xiangqiBoardWidth = 400;

type XiangqiBoardProps = {
  fen: string;
  side: SideToMove;
  arrows: readonly (readonly [string, string, string])[];
  onMove: (from: string, to: string) => boolean;
};

const redInk = "#b91c1c";
const blackInk = "#1c1917";
const piecePaper = "#f8e7c1";

function glyph(char: string, ink: string) {
  return ({ squareWidth }: { squareWidth: number }): ReactElement => (
    <svg viewBox="0 0 100 100" width={squareWidth} height={squareWidth} role="img" aria-label={char}>
      <circle cx="50" cy="50" r="46" fill={piecePaper} stroke={ink} strokeWidth="4" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={ink} strokeWidth="1.5" />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="54"
        fontFamily="KaiTi, STKaiti, SimSun, serif"
        fill={ink}
      >
        {char}
      </text>
    </svg>
  );
}

const chinesePieces: CustomPieces = {
  wK: glyph("帅", redInk),
  wA: glyph("仕", redInk),
  wB: glyph("相", redInk),
  wN: glyph("马", redInk),
  wR: glyph("车", redInk),
  wC: glyph("炮", redInk),
  wP: glyph("兵", redInk),
  bK: glyph("将", blackInk),
  bA: glyph("士", blackInk),
  bB: glyph("象", blackInk),
  bN: glyph("马", blackInk),
  bR: glyph("车", blackInk),
  bC: glyph("炮", blackInk),
  bP: glyph("卒", blackInk),
};

const boardVisualWidth = (xiangqiBoardWidth / 8) * 9;
const boardVisualHeight = (xiangqiBoardWidth / 8) * 10;

export function XiangqiBoard({ fen, side, arrows, onMove }: XiangqiBoardProps) {
  const customArrows = arrows.map((arrow) => [arrow[0], arrow[1], arrow[2]] as Arrow);

  return (
    <div className="relative" style={{ width: boardVisualWidth, height: boardVisualHeight }}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 9 10"
      >
        <rect width="9" height="10" fill="#f3d7a2" />
        <g fill="none" stroke="#6b3e24" strokeWidth="0.045" strokeLinecap="square">
          <path d="M0.5 0.5H8.5M0.5 1.5H8.5M0.5 2.5H8.5M0.5 3.5H8.5M0.5 4.5H8.5M0.5 5.5H8.5M0.5 6.5H8.5M0.5 7.5H8.5M0.5 8.5H8.5M0.5 9.5H8.5" />
          <path d="M0.5 0.5V9.5M8.5 0.5V9.5" />
          <path d="M1.5 0.5V4.5M1.5 5.5V9.5M2.5 0.5V4.5M2.5 5.5V9.5M3.5 0.5V4.5M3.5 5.5V9.5M4.5 0.5V4.5M4.5 5.5V9.5M5.5 0.5V4.5M5.5 5.5V9.5M6.5 0.5V4.5M6.5 5.5V9.5M7.5 0.5V4.5M7.5 5.5V9.5" />
          <path d="M3.5 0.5L5.5 2.5M5.5 0.5L3.5 2.5M3.5 9.5L5.5 7.5M5.5 9.5L3.5 7.5" />
        </g>
        <text
          x="2.5"
          y="5"
          fill="#6b3e24"
          fontSize="0.38"
          fontFamily="SimSun, STSong, serif"
          textAnchor="middle"
          dominantBaseline="central"
        >
          楚河
        </text>
        <text
          x="6.5"
          y="5"
          fill="#6b3e24"
          fontSize="0.38"
          fontFamily="SimSun, STSong, serif"
          textAnchor="middle"
          dominantBaseline="central"
        >
          汉界
        </text>
      </svg>
      <div className="absolute inset-0">
        <Chessboard
          id="xiangqi"
          position={fen}
          boardWidth={xiangqiBoardWidth}
          customPieces={chinesePieces}
          customArrows={customArrows}
          areArrowsAllowed={false}
          arePiecesDraggable
          animationDuration={0}
          showBoardNotation={false}
          dropOffBoardAction="snapback"
          allowDragOutsideBoard={false}
          isDraggablePiece={({ piece }) => piece.startsWith(side === "w" ? "w" : "b")}
          customBoardBackground="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          customDarkSquareStyle={{ backgroundColor: "transparent" }}
          customLightSquareStyle={{ backgroundColor: "transparent" }}
          customBoardStyle={{ borderRadius: "4px" }}
          onPieceDrop={(from, to) => onMove(from, to)}
        />
      </div>
    </div>
  );
}
