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

export type SerialOpenOptions = {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
};

type SerialPortLike = {
  open: (opts: SerialOpenOptions) => Promise<void>;
  close: () => Promise<void>;
  forget?: () => Promise<void>;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
  setSignals?: (s: { dataTerminalReady?: boolean; requestToSend?: boolean }) => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};
type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts?: () => Promise<SerialPortLike[]>;
};

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

  // Digit-grouping commas are removed BEFORE any number is matched. Left in, the number
  // regex stops at the comma and "12,345.60 kg" reads as 345.6 — twelve tonnes silently
  // gone. Only a comma sitting between digits with a group of three behind it is a
  // separator; the commas these frames use between FIELDS ("ST,GS,+ 012.34") never are.
  const scan = raw.replace(/(\d),(?=\d{3}(\D|$))/g, "$1");

  // Overload with no digits → no usable weight.
  const nums = scan.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return { weight: null, stable, raw };

  // Which number on the line IS the weight.
  //
  // "the first one with a decimal point" is right for a plain frame and wrong for one that
  // prints a tare first: "ST,TR, 1.50, GS, 012.34 kg" gave the 1.50. So a number tagged as
  // GROSS wins outright — that is the figure this field wants — then net, then the old
  // rule as the fallback for frames that tag nothing.
  const tagged = (tag: RegExp) => {
    const m = scan.toUpperCase().match(tag);
    return m && m[1] != null ? m[1] : null;
  };
  const pick =
    tagged(/\bG(?:S|ROSS)?\b[^0-9+-]*([-+]?\d+(?:\.\d+)?)/) ??
    tagged(/\b(?:NT|NET)\b[^0-9+-]*([-+]?\d+(?:\.\d+)?)/) ??
    nums.find((n) => n.includes(".")) ??
    nums[nums.length - 1];
  let weight = parseFloat(pick);

  // Unit. An indicator streaming GRAMS was being written into a kg field as-is, so 1234 g
  // was stored as 1,234 kg. "kg" is checked first because every "kg" frame also contains a
  // g; a lone g/gm token means grams, and no unit at all means kg (the shop's own unit).
  if (!Number.isNaN(weight)) {
    const hasKg = /\bK\s*G\b|KGS?\b/.test(upper);
    const hasG = /\b(?:G|GM|GMS|GRAMS?)\b/.test(upper.replace(/\bGS\b|\bGROSS\b/g, ""));
    if (!hasKg && hasG) weight = weight / 1000;
  }
  return { weight: Number.isNaN(weight) ? null : weight, stable, raw };
}

/* ── Port identity ──────────────────────────────────────────────────────────────────
 * Web Serial gives a port no stable id — only the USB vendor/product pair, and nothing
 * at all for a motherboard COM port. That is still enough to skip the picker on the one
 * PC the scale lives on, as long as we refuse to guess when two ports look alike.
 */
const PORT_KEY = "mm-scale-port";
const SILENCE_MS = 8000;

function portKey(port: SerialPortLike): string {
  const info = port.getInfo?.() ?? {};
  const v = info.usbVendorId;
  const p = info.usbProductId;
  return v != null && p != null
    ? `usb:${v.toString(16).padStart(4, "0")}:${p.toString(16).padStart(4, "0")}`
    : "native";
}

/** Human label for the port actually opened — the operator needs to know WHICH one this is. */
export function describePort(port: SerialPortLike): string {
  const key = portKey(port);
  return key === "native" ? "built-in COM port" : `USB serial ${key.slice(4)}`;
}

/** A port this browser already has permission for, when exactly one matches last time's. */
async function rememberedPort(serial: SerialLike): Promise<SerialPortLike | null> {
  let want: string | null = null;
  try { want = window.localStorage.getItem(PORT_KEY); } catch { /* ignore */ }
  if (!want || !serial.getPorts) return null;
  let granted: SerialPortLike[] = [];
  try { granted = await serial.getPorts(); } catch { return null; }
  const hits = granted.filter((p) => portKey(p) === want);
  // Two ports of the same kind are indistinguishable here, so ask rather than open the
  // TSC printer's virtual COM and sit there waiting for a weight that never comes.
  return hits.length === 1 ? hits[0] : null;
}

/** Chrome reports "the OS wouldn't give us the handle" as a NetworkError with this text. */
function isBusy(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  return err?.name === "NetworkError" || /failed to open/i.test(String(err?.message ?? e));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FRAME = { dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", bufferSize: 4096 } as const;

async function openPort(port: SerialPortLike, baudRate: number): Promise<void> {
  try {
    await port.open({ baudRate, ...FRAME });
    return;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    // Already open and already ours — a reload or a half-finished disconnect left it that
    // way. Opening it twice is the error; using it is fine.
    if (err?.name === "InvalidStateError" || /already open/i.test(String(err?.message))) return;
    if (!isBusy(e)) throw e;
    // Windows hands the COM handle back a beat AFTER the previous holder lets go, so the
    // open fired right after closing the old .exe (or reloading this tab) fails and the
    // one a moment later succeeds. Retry once before blaming the operator.
    try { await port.close(); } catch { /* ignore */ }
    await sleep(900);
    await port.open({ baudRate, ...FRAME });
  }
}

function explainOpenFailure(e: unknown, port: SerialPortLike | null): string {
  const err = e as { name?: string; message?: string };
  // The raw fault is kept on the end of every message: without it a failure on the shop
  // floor is a phone call describing a sentence we wrote ourselves.
  const tail = ` [${err?.name || "Error"}: ${String(err?.message || e)}${port ? ` · ${describePort(port)}` : ""}]`;
  if (isBusy(e)) {
    return (
      "Couldn't open the port — either another program is holding it, or this isn't the " +
      "scale's port. Close the old Mahavir .exe and any scale/printer utility, close other " +
      "tabs of this app, unplug-replug the serial cable, then Connect again. In the picker " +
      "choose the USB-Serial / COM port the scale is wired to — not the TSC printer." + tail
    );
  }
  if (err?.name === "SecurityError") {
    return "The browser blocked serial access on this page — it has to be served over HTTPS." + tail;
  }
  return String(err?.message || e) + tail;
}

export function useSerialScale() {
  const serial = getSerial();
  const supported = isSerialSupported();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [portLabel, setPortLabel] = useState<string | null>(null);
  const [reading, setReading] = useState<ScaleReading | null>(null);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilence = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
  }, []);

  const release = useCallback(async () => {
    try { await readerRef.current?.cancel(); } catch { /* ignore */ }
    readerRef.current = null;
    try { await portRef.current?.close(); } catch { /* ignore */ }
    portRef.current = null;
  }, []);

  const disconnect = useCallback(async () => {
    stopRef.current = true;
    clearSilence();
    await release();
    setConnected(false);
    setPortLabel(null);
    setNote(null);
  }, [clearSilence, release]);

  const connect = useCallback(
    async (baudRate = 9600, opts?: { pick?: boolean }) => {
      if (!serial) { setError("Web Serial is not available in this browser / context."); return; }
      setError(null);
      setNote(null);
      setConnecting(true);
      stopRef.current = false;
      clearSilence();
      // Release anything we still hold — re-opening a port this tab already has open
      // fails with the same "Failed to open serial port".
      await release();

      let port: SerialPortLike | null = null;
      try {
        port = (opts?.pick ? null : await rememberedPort(serial)) ?? (await serial.requestPort());
        await openPort(port, baudRate);
        portRef.current = port;
        try { window.localStorage.setItem(PORT_KEY, portKey(port)); } catch { /* ignore */ }
        setPortLabel(describePort(port));
        setConnected(true);
        setConnecting(false);

        // Most indicators only transmit while DTR/RTS are asserted — that is what the old
        // terminal software did on open, and a scale that "connects but stays silent" is
        // usually one waiting for these lines.
        try { await port.setSignals?.({ dataTerminalReady: true, requestToSend: true }); } catch { /* ignore */ }

        const stream = port.readable;
        if (!stream) { setError("Port has no readable stream."); return; }
        const reader = stream.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buf = "";

        // Silence is its own failure and looks identical to success on screen, so name it.
        silenceRef.current = setTimeout(() => {
          setNote(
            `Port is open but the indicator hasn't sent anything in ${SILENCE_MS / 1000}s. ` +
              "Check the baud rate, and that the indicator is set to continuous / auto print " +
              "(some only send on the PRINT key).",
          );
        }, SILENCE_MS);

        // Background read loop — split the byte stream into CR/LF-delimited frames.
        void (async () => {
          try {
            while (!stopRef.current) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const parts = buf.split(/\r\n|\r|\n/);
              buf = parts.pop() ?? "";
              for (const ln of parts) {
                if (!ln.trim()) continue;
                clearSilence();
                setNote(null);
                setReading(parseScaleFrame(ln));
              }
            }
          } catch (e) {
            if (!stopRef.current) setError(String((e as Error)?.message || e));
          } finally {
            // The cable being pulled ends the stream; without this the UI keeps claiming
            // it is connected and the operator waits on a reading that can never arrive.
            if (!stopRef.current) {
              clearSilence();
              setConnected(false);
              setPortLabel(null);
            }
          }
        })();
      } catch (e) {
        setConnecting(false);
        const err = e as { name?: string; message?: string };
        const msg = String(err?.message || e);
        // Cancelling the port picker throws — treat that quietly.
        if (err?.name === "NotFoundError" || /no port selected|cancelled|canceled|aborted/i.test(msg)) return;
        setError(explainOpenFailure(e, port));
      }
    },
    [clearSilence, release, serial],
  );

  // Clean up the port on unmount.
  useEffect(() => () => { void disconnect(); }, [disconnect]);

  return { supported, connected, connecting, error, note, portLabel, reading, connect, disconnect };
}
