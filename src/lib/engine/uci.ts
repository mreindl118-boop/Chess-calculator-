import { ENGINE_SINGLE, engineScriptUrl, engineThreads } from './engineFiles';

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

  /** options applied so far, replayed after a self-heal respawn */
  private appliedOptions = new Map<string, string | number | boolean>();
  private lastPositionCmd: string | null = null;
  private lastGoCmd: string | null = null;
  private pthreadErrors = 0;
  private healed = false;

  constructor(
    private scriptUrl: string = engineScriptUrl(),
    private threads: number = engineThreads(),
  ) {
    this.worker = this.spawn(scriptUrl);
    this.readyPromise = new Promise<void>((resolve) => {
      this.handshake(resolve);
    });
  }

  private spawn(scriptUrl: string): Worker {
    const worker = new Worker(scriptUrl);
    worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      // The emscripten wrapper reports failed pthread helper spawns as
      // message lines. In some environments (headless/containerized Chromium,
      // low-memory devices) these spawns fail and emscripten respawn-storms,
      // wedging the whole page. Detect it early and self-heal onto the
      // single-threaded build, which has no helper workers at all.
      if (line.includes('worker sent an error!')) {
        this.pthreadErrors++;
        this.selfHeal();
        return;
      }
      for (const l of this.listeners) l(line);
    };
    // Failed pthread spawns can also surface as uncaught ErrorEvents on the
    // engine worker itself rather than message lines.
    worker.onerror = (e) => {
      e.preventDefault?.();
      this.pthreadErrors++;
      this.selfHeal();
    };
    return worker;
  }

  /** uci handshake + option apply + warm-up search (fills the pthread pool). */
  private handshake(onReady: () => void): void {
    const onLine = (line: string) => {
      if (line === 'uciok') {
        this.listeners.delete(onLine);
        this.setOption('Threads', this.threads);
        this.setOption('Hash', 32);
        const onWarm = (l: string) => {
          if (l.startsWith('bestmove')) {
            this.listeners.delete(onWarm);
            onReady();
          }
        };
        this.listeners.add(onWarm);
        this.send('position startpos');
        this.send('go depth 1');
      }
    };
    this.listeners.add(onLine);
    this.send('uci');
  }

  /** Swap to the single-threaded build, replay options and any live search. */
  private selfHeal(): void {
    if (this.healed || this.disposed || this.scriptUrl === ENGINE_SINGLE) {
      // Already single-threaded (or already healed once): nothing left to try.
      this.healed = true;
      return;
    }
    this.healed = true;
    console.warn('[gambitlab] wasm threads unavailable — engine falling back to single-threaded build');
    this.worker.terminate();
    this.scriptUrl = ENGINE_SINGLE;
    this.threads = 1;
    const savedOptions = new Map(this.appliedOptions);
    this.worker = this.spawn(ENGINE_SINGLE);
    this.handshake(() => {
      for (const [name, value] of savedOptions) {
        if (name !== 'Threads') this.setOption(name, value);
      }
      // Pending go() listeners are still attached; re-issue the interrupted
      // search so their bestmove arrives from the new worker.
      if (this.searching && this.lastPositionCmd && this.lastGoCmd) {
        this.send(this.lastPositionCmd);
        this.send(this.lastGoCmd);
      }
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
    this.appliedOptions.set(name, value);
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
    this.lastPositionCmd = cmd;
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
      this.lastGoCmd = cmd;
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
