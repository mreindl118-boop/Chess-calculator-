/// <reference lib="webworker" />
import { searchBestMove, type SearchParams } from '../lib/checkers/engine';
import type { CheckersColor } from '../lib/checkers/rules';

export interface CheckersWorkerRequest {
  id: number;
  board: number[]; // Int8Array serialized
  toMove: CheckersColor;
  params: SearchParams;
}

export interface CheckersWorkerResponse {
  id: number;
  move: ReturnType<typeof searchBestMove>['move'];
  score: number;
  depth: number;
  nodes: number;
}

self.onmessage = (e: MessageEvent<CheckersWorkerRequest>) => {
  const { id, board, toMove, params } = e.data;
  const outcome = searchBestMove(new Int8Array(board), toMove, params);
  const res: CheckersWorkerResponse = { id, ...outcome };
  (self as unknown as Worker).postMessage(res);
};
