import { engineScriptUrl, engineThreads } from './engineFiles';

export interface SearchLimits {
  depth?: number;
  movetime?: number;
  nodes?: number;
  infinite?: boolean;
}

export interface EngineInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  /** centipawns from the side-to-move's perspective */
  scoreCp?: number;
  /** mate in N (negative = getting mated) from side-to-move's perspective */
  scoreMate?: number;
  nodes?: number;
  nps?: number;
  time?: number;
  pv: string[];
}

export interface SearchResult {
  bestmove: string;
  ponder?: string;
  /** last full info snapshot per multipv index (1-based keys) */
  lines: Map<number, EngineInfo>;
}

export interface UciEngine {
  ready(): Promise<void>;
  setOption(name: string, value: string | number | boolean): void;
  newGame(): Promise<void>;
  position(fen: string, moves?: string[]): void;
  go(limits: SearchLimits, onInfo?: (info: EngineInfo) => void): Promise<SearchResult>;
  /** Stop the current search; the pending go() resolves with its bestmove. */
  stop(): void;
  dispose(): void;
}

export function parseInfoLine(line: string): EngineInfo | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const info: EngineInfo = { depth: 0, multipv: 1, pv: [] };
  const tokens = line.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        info.depth = parseInt(tokens[++i], 10);
        break;
      case 'seldepth':
        info.seldepth = parseInt(tokens[++i], 10);
        break;
      case 'multipv':
        info.multipv = parseInt(tokens[++i], 10);
        break;
      case 'score': {
        const kind = tokens[++i];
        const val = parseInt(tokens[++i], 10);
        if (kind === 'cp') info.scoreCp = val;
        else if (kind === 'mate') info.scoreMate = val;
        // ignore lowerbound/upperbound qualifiers
        break;
      }
      case 'nodes':
        info.nodes = parseInt(tokens[++i], 10);
        break;
      case 'nps':
        info.nps = parseInt(tokens[++i], 10);
        break;
      case 'time':
        info.time = parseInt(tokens[++i], 10);
        break;
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }
  return info.pv.length > 0 ? info : null;
}

/**
 * Stockfish WASM running in its own Web Worker, speaking UCI over postMessage.
 * Never blocks the main thread; all engine work happens in the worker (plus
 * pthread sub-workers in the multi-threaded build).
 */
export class StockfishEngine implements UciEngine {
  private worker: Worker;
  private readyPromise: Promise<void>;
  private listeners = new Set<(line: string) => void>();
  private searching = false;
  private disposed = false;

  constructor(scriptUrl: string = engineScriptUrl()) {
    this.worker = new Worker(scriptUrl);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of this.listeners) l(line);
    };
    this.readyPromise = new Promise<void>((resolve) => {
      const onLine = (line: string) => {
        if (line === 'uciok') {
          this.listeners.delete(onLine);
          this.setOption('Threads', engineThreads());
          this.setOption('Hash', 32);
          resolve();
        }
      };
      this.listeners.add(onLine);
      this.send('uci');
    });
  }

  private send(cmd: string) {
    if (!this.disposed) this.worker.postMessage(cmd);
  }

  onLine(fn: (line: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  setOption(name: string, value: string | number | boolean): void {
    this.send(`setoption name ${name} value ${value}`);
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.isReady();
  }

  private isReady(): Promise<void> {
    return new Promise((resolve) => {
      const off = this.onLine((line) => {
        if (line === 'readyok') {
          off();
          resolve();
        }
      });
      this.send('isready');
    });
  }

  position(fen: string, moves: string[] = []): void {
    const cmd =
      moves.length > 0 ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`;
    this.send(cmd);
  }

  go(limits: SearchLimits, onInfo?: (info: EngineInfo) => void): Promise<SearchResult> {
    if (this.searching) throw new Error('engine already searching');
    this.searching = true;
    const lines = new Map<number, EngineInfo>();
    return new Promise<SearchResult>((resolve) => {
      const off = this.onLine((line) => {
        if (line.startsWith('info ')) {
          const info = parseInfoLine(line);
          if (info) {
            lines.set(info.multipv, info);
            onInfo?.(info);
          }
        } else if (line.startsWith('bestmove')) {
          off();
          this.searching = false;
          const parts = line.split(/\s+/);
          resolve({ bestmove: parts[1], ponder: parts[3], lines });
        }
      });
      let cmd = 'go';
      if (limits.infinite) cmd += ' infinite';
      if (limits.depth !== undefined) cmd += ` depth ${limits.depth}`;
      if (limits.nodes !== undefined) cmd += ` nodes ${limits.nodes}`;
      if (limits.movetime !== undefined) cmd += ` movetime ${limits.movetime}`;
      this.send(cmd);
    });
  }

  stop(): void {
    if (this.searching) this.send('stop');
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.worker.terminate();
    this.listeners.clear();
  }
}
