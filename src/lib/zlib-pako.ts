/**
 * Browser-side replacement for Node's `zlib` module.
 *
 * The `web_pen_sdk` parser calls `zlib.unzip(Uint8Array, (err, res) => ...)` when
 * decompressing offline stroke data. pako provides a synchronous
 * `inflate`/`ungzip` that works in the browser — we wrap it in Node's callback
 * shape so the SDK continues to compile against the same API.
 *
 * `zlib.unzip` in Node transparently handles both deflate/zlib- and gzip-wrapped
 * buffers; `pako.inflate` handles both as long as the bytes are valid deflate
 * with a zlib or raw header, and `pako.ungzip` handles gzip. We try inflate
 * first and fall back to ungzip on failure.
 */
import * as pako from 'pako';

type UnzipCallback = (err: Error | null, result?: Uint8Array) => void;

export function unzip(data: Uint8Array, callback: UnzipCallback): void {
  try {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    let result: Uint8Array;
    try {
      result = pako.inflate(buf);
    } catch {
      result = pako.ungzip(buf);
    }
    callback(null, result);
  } catch (err) {
    callback(err instanceof Error ? err : new Error(String(err)));
  }
}

export function inflateSync(data: Uint8Array): Uint8Array {
  return pako.inflate(data);
}

export function deflateSync(data: Uint8Array): Uint8Array {
  return pako.deflate(data);
}

export function gunzip(data: Uint8Array, callback: UnzipCallback): void {
  try {
    callback(null, pako.ungzip(data));
  } catch (err) {
    callback(err instanceof Error ? err : new Error(String(err)));
  }
}

export function gzip(data: Uint8Array, callback: UnzipCallback): void {
  try {
    callback(null, pako.gzip(data));
  } catch (err) {
    callback(err instanceof Error ? err : new Error(String(err)));
  }
}

export function inflate(data: Uint8Array, callback: UnzipCallback): void {
  unzip(data, callback);
}

export function deflate(data: Uint8Array, callback: UnzipCallback): void {
  try {
    callback(null, pako.deflate(data));
  } catch (err) {
    callback(err instanceof Error ? err : new Error(String(err)));
  }
}

export default {
  unzip,
  inflate,
  inflateSync,
  deflate,
  deflateSync,
  gunzip,
  gzip,
};
