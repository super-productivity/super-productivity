// Position bookkeeping for the short-syntax parser: the parser strips tokens
// from a working copy of the title stage by stage, but the highlight overlay
// needs the position of every consumed token in the *raw* input. Instead of
// recovering positions afterwards by searching (which guesses wrong whenever a
// token's text also occurs inside a tag, URL or word), every edit is routed
// through this tracker, which keeps a per-character map from working-title
// index to raw-title index. Positions are then read off the map exactly.
export interface TextRange {
  start: number;
  end: number;
}

const WS = /\s/;

export class TrackedTitle {
  private _text: string;
  // _offsets[i] = index in the raw input of _text[i]
  private _offsets: number[];

  constructor(private readonly _raw: string) {
    this._text = _raw;
    this._offsets = Array.from({ length: _raw.length }, (_, i) => i);
  }

  get text(): string {
    return this._text;
  }

  // Raw-input positions of the working-title span [start, end), as maximal
  // contiguous runs (earlier removals inside the span split it into several).
  // Runs are trimmed to visible characters — whitespace at a run's edges is
  // stripped and whitespace-only runs are dropped — since a highlight on a
  // consumed space is noise.
  rawRanges(start: number, end: number): TextRange[] {
    const runs: TextRange[] = [];
    for (let i = start; i < end; i++) {
      const raw = this._offsets[i];
      const last = runs[runs.length - 1];
      if (last && raw === last.end) {
        last.end = raw + 1;
      } else {
        runs.push({ start: raw, end: raw + 1 });
      }
    }
    return runs
      .map((r) => {
        let s = r.start;
        let e = r.end;
        while (s < e && WS.test(this._raw[s])) {
          s++;
        }
        while (e > s && WS.test(this._raw[e - 1])) {
          e--;
        }
        return { start: s, end: e };
      })
      .filter((r) => r.end > r.start);
  }

  remove(start: number, end: number): void {
    this._text = this._text.slice(0, start) + this._text.slice(end);
    this._offsets.splice(start, end - start);
  }

  trim(): void {
    let s = 0;
    let e = this._text.length;
    while (s < e && WS.test(this._text[s])) {
      s++;
    }
    while (e > s && WS.test(this._text[e - 1])) {
      e--;
    }
    if (e < this._text.length) {
      this.remove(e, this._text.length);
    }
    if (s > 0) {
      this.remove(0, s);
    }
  }

  // Equivalent of .trim().replace(/\s+/g, ' '): every interior whitespace run
  // becomes a single space carrying the run's first raw position.
  collapseWhitespace(): void {
    const text: string[] = [];
    const offsets: number[] = [];
    let pendingWsOffset = -1;
    for (let i = 0; i < this._text.length; i++) {
      const ch = this._text[i];
      if (WS.test(ch)) {
        if (text.length && pendingWsOffset === -1) {
          pendingWsOffset = this._offsets[i];
        }
      } else {
        if (pendingWsOffset !== -1) {
          text.push(' ');
          offsets.push(pendingWsOffset);
          pendingWsOffset = -1;
        }
        text.push(ch);
        offsets.push(this._offsets[i]);
      }
    }
    this._text = text.join('');
    this._offsets = offsets;
  }
}
