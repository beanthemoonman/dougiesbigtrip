/**
 * Per-tick input trace recorder — the recording half of the determinism
 * infrastructure (see docs/testing.md §T1). Records the last ~30 s of
 * input at 64 Hz; press F2 to dump the buffer to the console as JSON.
 *
 * Active only when `?record` is present in the page URL — otherwise
 * the recorder is a no-op, keeping the hot path clean.
 */

/** A single tick of recorded sim input. Mirrors the MovementInput fields the
 *  sim needs; buttons and yaw are primitives for JSON serialisation. */
export interface TraceTick {
  buttons: number;
  yaw: number;
}

/** A full recorded trace of ordered simulation ticks. */
export interface InputTrace {
  ticks: TraceTick[];
}

const MAX_TICKS = 1920; // 30 s at 64 Hz
const DUMP_KEY = 'F2';

export interface TraceRecorder {
  push(tick: TraceTick): void;
}

class RealTraceRecorder implements TraceRecorder {
  private buffer: TraceTick[] = [];

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
  }

  push(tick: TraceTick): void {
    this.buffer.push({ buttons: tick.buttons, yaw: tick.yaw });
    if (this.buffer.length > MAX_TICKS) this.buffer.shift();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== DUMP_KEY) return;
    const trace: InputTrace = { ticks: [...this.buffer] };
    const json = JSON.stringify(trace);
    console.log(
      `TRACE (${trace.ticks.length} ticks, ${(trace.ticks.length / 64).toFixed(1)} s):`,
      json,
    );
  };
}

class NoopTraceRecorder implements TraceRecorder {
  push(): void {}
}

/**
 * Creates a trace recorder. When `?record` is in the URL, returns a real
 * ring-buffer recorder that dumps on F2; otherwise returns a no-op.
 */
export function createTraceRecorder(): TraceRecorder {
  const record = new URLSearchParams(window.location.search).has('record');
  return record ? new RealTraceRecorder() : new NoopTraceRecorder();
}
