import { useCallback, useEffect, useRef, useState } from "react";

interface Phase {
  id: string;
  name: string;
  seconds: number;
}

const DEFAULT_PHASES: Phase[] = [
  { id: "sink", name: "沈める", seconds: 10 },
  { id: "jerk", name: "しゃくる", seconds: 3 }
];

const STORAGE_KEY = "interval-timer-phases";
const PHASE_COLORS = ["#4c7bf3", "#f2b134", "#06c755", "#ef5164", "#a855f7"];

function loadPhases(): Phase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PHASES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_PHASES;
}

function newPhaseId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function TimerView() {
  const [phases, setPhases] = useState<Phase[]>(loadPhases);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remaining, setRemaining] = useState(phases[0]?.seconds ?? 0);
  const [cycle, setCycle] = useState(0);
  const [muted, setMuted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const tickCountRef = useRef(0);
  const phaseIndexRef = useRef(0);
  const remainingRef = useRef(phases[0]?.seconds ?? 0);
  const cycleRef = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(phases));
  }, [phases]);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  };

  const playTone = useCallback((big: boolean) => {
    if (mutedRef.current) return;
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = big ? 880 : 1320;
    const now = ctx.currentTime;
    const peak = big ? 0.5 : 0.1;
    const duration = big ? 0.2 : 0.06;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }, []);

  const clearScheduledTick = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const scheduleNext = useCallback(() => {
    const elapsed = performance.now() - startRef.current;
    const nextTick = tickCountRef.current + 1;
    const delay = nextTick * 1000 - elapsed;
    timeoutRef.current = window.setTimeout(() => {
      tickCountRef.current += 1;
      remainingRef.current -= 1;
      if (remainingRef.current <= 0) {
        phaseIndexRef.current = (phaseIndexRef.current + 1) % phases.length;
        if (phaseIndexRef.current === 0) cycleRef.current += 1;
        remainingRef.current = phases[phaseIndexRef.current].seconds;
        playTone(true);
      } else {
        playTone(false);
      }
      setPhaseIndex(phaseIndexRef.current);
      setRemaining(remainingRef.current);
      setCycle(cycleRef.current);
      scheduleNext();
    }, Math.max(0, delay));
  }, [phases, playTone]);

  const start = () => {
    if (running || phases.length === 0) return;
    getAudioCtx();
    if (!started) {
      phaseIndexRef.current = 0;
      remainingRef.current = phases[0].seconds;
      cycleRef.current = 0;
      setPhaseIndex(0);
      setRemaining(phases[0].seconds);
      setCycle(0);
      setStarted(true);
      playTone(true);
    }
    startRef.current = performance.now();
    tickCountRef.current = 0;
    setRunning(true);
    scheduleNext();
  };

  const pause = () => {
    setRunning(false);
    clearScheduledTick();
  };

  const reset = () => {
    clearScheduledTick();
    setRunning(false);
    setStarted(false);
    phaseIndexRef.current = 0;
    remainingRef.current = phases[0]?.seconds ?? 0;
    cycleRef.current = 0;
    setPhaseIndex(0);
    setRemaining(phases[0]?.seconds ?? 0);
    setCycle(0);
  };

  useEffect(() => {
    return () => {
      clearScheduledTick();
      void audioCtxRef.current?.close();
    };
  }, []);

  const updatePhaseName = (id: string, name: string) => {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const updatePhaseSeconds = (id: string, value: string) => {
    const seconds = Math.max(1, Math.round(Number(value) || 1));
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, seconds } : p)));
  };

  const addPhase = () => {
    setPhases((prev) => [...prev, { id: newPhaseId(), name: `フェーズ${prev.length + 1}`, seconds: 5 }]);
  };

  const removePhase = (id: string) => {
    setPhases((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const currentPhase = phases[phaseIndex];
  const displaySeconds = started ? remaining : currentPhase?.seconds ?? 0;
  const color = PHASE_COLORS[phaseIndex % PHASE_COLORS.length];

  return (
    <div className="timer-view">
      {!started && (
        <div className="phase-editor">
          <h2>フェーズ設定</h2>
          {phases.map((p) => (
            <div className="phase-row" key={p.id}>
              <input
                type="text"
                className="phase-name-input"
                value={p.name}
                onChange={(e) => updatePhaseName(p.id, e.target.value)}
              />
              <input
                type="number"
                min={1}
                className="phase-seconds-input"
                value={p.seconds}
                onChange={(e) => updatePhaseSeconds(p.id, e.target.value)}
              />
              <span className="muted">秒</span>
              {phases.length > 1 && (
                <button className="phase-remove" onClick={() => removePhase(p.id)} aria-label="削除">
                  ✕
                </button>
              )}
            </div>
          ))}
          <button onClick={addPhase}>+ フェーズを追加</button>
        </div>
      )}

      <div className="timer-display" style={{ borderColor: color, background: running ? `${color}22` : undefined }}>
        <span className="phase-name-label" style={{ color }}>
          {currentPhase?.name ?? "-"}
        </span>
        <span className="timer-time">{displaySeconds}</span>
        <span className="timer-sub muted">サイクル {cycle} 回目</span>
      </div>

      <div className="timer-actions">
        {!running ? (
          <button className="primary" onClick={start}>
            {started ? "再開" : "スタート"}
          </button>
        ) : (
          <button className="danger" onClick={pause}>
            一時停止
          </button>
        )}
        <button onClick={reset} disabled={!started}>
          リセット
        </button>
        <button onClick={() => setMuted((m) => !m)}>{muted ? "🔇 ミュート中" : "🔊 音あり"}</button>
      </div>
      <p className="muted timer-note">毎秒小さい音、フェーズが切り替わる瞬間に大きい音が鳴ります。</p>
    </div>
  );
}
