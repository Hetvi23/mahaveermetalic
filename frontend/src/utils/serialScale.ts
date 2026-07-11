import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Serial weighing-scale reader.
 *
 * Reads an RS-232 / USB-serial weight indicator directly in Chrome/Edge on the PC the
 * scale is cabled to (no install). Requires a secure context (HTTPS or localhost) and a
 * one-time user gesture to pick the port. Not available in Firefox/Safari/iOS — callers
 * must keep a manual-entry fallback.
 *
 * The parser is deliberately tolerant because cheap Indian indicators (National, Essae,
 * Avery India, …) are not standardised: most stream a continuous ASCII frame carrying a
 * stability token (ST = stable, US = unstable/motion) and a signed decimal, e.g.
 * `ST,GS,+ 012.34 kg`. We surface the raw frame so an unknown format can be diagnosed
 * on screen and the parser tuned if needed.
 */

type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};
type SerialLike = { requestPort: () => Promise<SerialPortLike> };

export type ScaleReading = { weight: number | null; stable: boolean; raw: string };

export function getSerial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

/** True when Web Serial can actually run here (API present + secure context). */
export function isSerialSupported(): boolean {
  if (!getSerial()) return false;
  // navigator.serial only exists in secure contexts anyway, but guard defensively.
  return typeof window === "undefined" || window.isSecureContext;
}

/** Parse one line from a weight indicator into a normalised reading. */
export function parseScaleFrame(line: string): ScaleReading {
  const raw = line.trim();
  if (!raw) return { weight: null, stable: false, raw };
  const upper = raw.toUpperCase();

  // Stability: explicit motion/unstable token wins; else a stable token; else assume stable
  // (some scales just stream the number with no status).
  let stable = true;
  if (/(^|[^A-Z])US([^A-Z]|$)|MOTION|UNSTABLE/.test(upper)) stable = false;
  else if (/(^|[^A-Z])ST([^A-Z]|$)|STABLE/.test(upper)) stable = true;

  // Overload with no digits → no usable weight.
  const nums = raw.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return { weight: null, stable, raw };

  // Prefer a decimal value (the weight); fall back to the last number on the line.
  const pick = nums.find((n) => n.includes(".")) ?? nums[nums.length - 1];
  const weight = parseFloat(pick);
  return { weight: Number.isNaN(weight) ? null : weight, stable, raw };
}

export function useSerialScale() {
  const serial = getSerial();
  const supported = isSerialSupported();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<ScaleReading | null>(null);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopRef = useRef(false);

  const disconnect = useCallback(async () => {
    stopRef.current = true;
    try { await readerRef.current?.cancel(); } catch { /* ignore */ }
    readerRef.current = null;
    try { await portRef.current?.close(); } catch { /* ignore */ }
    portRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(
    async (baudRate = 9600) => {
      if (!serial) { setError("Web Serial is not available in this browser / context."); return; }
      setError(null);
      setConnecting(true);
      stopRef.current = false;
      try {
        const port = await serial.requestPort();
        await port.open({ baudRate });
        portRef.current = port;
        setConnected(true);
        setConnecting(false);

        const stream = port.readable;
        if (!stream) { setError("Port has no readable stream."); return; }
        const reader = stream.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buf = "";
        // Background read loop — split the byte stream into CR/LF-delimited frames.
        void (async () => {
          try {
            while (!stopRef.current) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const parts = buf.split(/\r\n|\r|\n/);
              buf = parts.pop() ?? "";
              for (const ln of parts) if (ln.trim()) setReading(parseScaleFrame(ln));
            }
          } catch (e) {
            if (!stopRef.current) setError(String((e as Error)?.message || e));
          }
        })();
      } catch (e) {
        setConnecting(false);
        const msg = String((e as Error)?.message || e);
        // Cancelling the port picker throws — treat that quietly.
        if (!/no port selected|cancelled|canceled|aborted/i.test(msg)) setError(msg);
      }
    },
    [serial],
  );

  // Clean up the port on unmount.
  useEffect(() => () => { void disconnect(); }, [disconnect]);

  return { supported, connected, connecting, error, reading, connect, disconnect };
}
