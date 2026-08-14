import { useCallback, useEffect, useRef, useState } from "react";

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TimerView() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const secondsRef = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  };

  const playTick = useCallback((big: boolean) => {
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
    const nextSecond = secondsRef.current + 1;
    const delay = nextSecond * 1000 - elapsed;
    timeoutRef.current = window.setTimeout(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      playTick(secondsRef.current % 10 === 0);
      scheduleNext();
    }, Math.max(0, delay));
  }, [playTick]);

  const start = () => {
    if (running) return;
    getAudioCtx();
    startRef.current = performance.now() - secondsRef.current * 1000;
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
    secondsRef.current = 0;
    setSeconds(0);
  };

  useEffect(() => {
    return () => {
      clearScheduledTick();
      void audioCtxRef.current?.close();
    };
  }, []);

  const tenSecCount = Math.floor(seconds / 10);

  return (
    <div className="timer-view">
      <div className={`timer-display${seconds > 0 && seconds % 10 === 0 ? " timer-pulse" : ""}`}>
        <span className="timer-time">{formatTime(seconds)}</span>
        <span className="timer-sub muted">
          {seconds}秒経過 ・ 10秒区切り {tenSecCount}回
        </span>
      </div>
      <div className="timer-actions">
        {!running ? (
          <button className="primary" onClick={start}>
            {seconds > 0 ? "再開" : "スタート"}
          </button>
        ) : (
          <button className="danger" onClick={pause}>
            一時停止
          </button>
        )}
        <button onClick={reset} disabled={seconds === 0 && !running}>
          リセット
        </button>
        <button onClick={() => setMuted((m) => !m)}>{muted ? "🔇 ミュート中" : "🔊 音あり"}</button>
      </div>
      <p className="muted timer-note">毎秒、小さい音が鳴ります。10秒ごとに大きい音が鳴ります。</p>
    </div>
  );
}
