import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface MorningSettings {
  enabled: boolean;
  time: string; // "HH:MM" (PC のローカル時計基準)
  days: number[]; // 0(日)〜6(土)
  patternId: string;
  customMessage: string;
  voiceURI: string;
  rate: number;
  pitch: number;
}

const STORAGE_KEY = "morning-call-settings-v1";
const LAST_FIRED_KEY = "morning-call-last-fired";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const PATTERNS: { id: string; label: string; template: string }[] = [
  { id: "standard", label: "スタンダード", template: "おはようございます。ただいま{time}です。今日も一日、頑張りましょう。" },
  { id: "genki", label: "元気いっぱい", template: "おはよう!起きる時間だよ!{time}になったよ!今日も元気に頑張ろう!" },
  { id: "calm", label: "やさしく", template: "おはようございます。{time}になりました。ゆっくり起きて、今日も良い一日にしましょうね。" },
  { id: "business", label: "ビジネス", template: "おはようございます。ただいま{time}です。本日の業務を開始してください。" },
  { id: "custom", label: "カスタム(自由入力)", template: "" }
];

const DEFAULT_SETTINGS: MorningSettings = {
  enabled: false,
  time: "08:30",
  days: [0, 1, 2, 3, 4, 5, 6],
  patternId: "standard",
  customMessage: "おはようございます。起きる時間です。",
  voiceURI: "",
  rate: 1,
  pitch: 1
};

function loadSettings(): MorningSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function messageFor(settings: MorningSettings) {
  const template =
    settings.patternId === "custom"
      ? settings.customMessage
      : PATTERNS.find((p) => p.id === settings.patternId)?.template ?? "";
  return template.split("{time}").join(settings.time);
}

function nextFireLabel(settings: MorningSettings): string | null {
  if (!settings.enabled || settings.days.length === 0) return null;
  const [h, m] = settings.time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (d <= now) continue;
    if (settings.days.includes(d.getDay())) {
      if (i === 0) return `次回: 今日 ${settings.time}`;
      if (i === 1) return `次回: 明日 ${settings.time}`;
      return `次回: ${d.getMonth() + 1}/${d.getDate()} ${settings.time}`;
    }
  }
  return null;
}

export default function MorningCall() {
  const [settings, setSettings] = useState<MorningSettings>(loadSettings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [nowLabel, setNowLabel] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastFiredRef = useRef<string>(localStorage.getItem(LAST_FIRED_KEY) ?? "");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  };

  const playChime = useCallback(() => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") void ctx.resume();
    const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const start = now + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }, []);

  const speakMessage = useCallback(
    (text: string) => {
      if (!text || !("speechSynthesis" in window)) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ja-JP";
      utter.rate = settings.rate;
      utter.pitch = settings.pitch;
      const voice = voices.find((v) => v.voiceURI === settings.voiceURI);
      if (voice) utter.voice = voice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    },
    [settings.rate, settings.pitch, settings.voiceURI, voices]
  );

  const triggerNow = useCallback(() => {
    playChime();
    const text = messageFor(settings);
    window.setTimeout(() => speakMessage(text), 750);
  }, [playChime, speakMessage, settings]);

  useEffect(() => {
    if (!settings.enabled) return;
    const id = window.setInterval(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const current = `${hh}:${mm}`;
      const todayStr = localDateStr(now);
      setNowLabel(current);
      if (current === settings.time && settings.days.includes(now.getDay()) && lastFiredRef.current !== todayStr) {
        lastFiredRef.current = todayStr;
        localStorage.setItem(LAST_FIRED_KEY, todayStr);
        triggerNow();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [settings, triggerNow]);

  const toggleDay = (day: number) => {
    setSettings((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day].sort()
    }));
  };

  const setAllDays = (days: number[]) => setSettings((prev) => ({ ...prev, days }));

  const preview = useMemo(() => messageFor(settings), [settings]);
  const nextFire = useMemo(() => nextFireLabel(settings), [settings, nowLabel]);

  const japaneseVoices = voices.filter((v) => v.lang.startsWith("ja"));
  const voiceOptions = japaneseVoices.length > 0 ? japaneseVoices : voices;

  return (
    <div className="morning-view">
      <div className="morning-card">
        <div className="morning-row morning-row-top">
          <label className="morning-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            毎朝のモーニングコールを有効にする
          </label>
          {nextFire && <span className="muted">{nextFire}</span>}
        </div>

        <div className="morning-row">
          <label htmlFor="morning-time">時刻（この端末の時計と連動）</label>
          <input
            id="morning-time"
            type="time"
            value={settings.time}
            onChange={(e) => setSettings((prev) => ({ ...prev, time: e.target.value }))}
          />
        </div>

        <div className="morning-row morning-days">
          <span className="muted">曜日</span>
          <div className="weekday-buttons">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                className={settings.days.includes(day) ? "weekday-btn active" : "weekday-btn"}
                onClick={() => toggleDay(day)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="weekday-presets">
            <button type="button" onClick={() => setAllDays([0, 1, 2, 3, 4, 5, 6])}>
              毎日
            </button>
            <button type="button" onClick={() => setAllDays([1, 2, 3, 4, 5])}>
              平日
            </button>
            <button type="button" onClick={() => setAllDays([0, 6])}>
              週末
            </button>
          </div>
        </div>

        <div className="morning-row morning-patterns">
          <span className="muted">メッセージパターン</span>
          {PATTERNS.map((p) => (
            <label className="pattern-option" key={p.id}>
              <input
                type="radio"
                name="pattern"
                checked={settings.patternId === p.id}
                onChange={() => setSettings((prev) => ({ ...prev, patternId: p.id }))}
              />
              <span className="pattern-label">{p.label}</span>
              {p.id !== "custom" && (
                <span className="pattern-text muted">{p.template.split("{time}").join(settings.time)}</span>
              )}
            </label>
          ))}
          {settings.patternId === "custom" && (
            <textarea
              className="custom-message-input"
              rows={3}
              value={settings.customMessage}
              onChange={(e) => setSettings((prev) => ({ ...prev, customMessage: e.target.value }))}
              placeholder="読み上げたいメッセージを入力してください（{time} と書くとその位置に時刻が入ります）"
            />
          )}
        </div>

        {voiceOptions.length > 0 && (
          <div className="morning-row">
            <label htmlFor="morning-voice">読み上げ音声</label>
            <select
              id="morning-voice"
              value={settings.voiceURI}
              onChange={(e) => setSettings((prev) => ({ ...prev, voiceURI: e.target.value }))}
            >
              <option value="">端末の標準音声</option>
              {voiceOptions.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="morning-row morning-sliders">
          <label>
            速さ {settings.rate.toFixed(1)}
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={settings.rate}
              onChange={(e) => setSettings((prev) => ({ ...prev, rate: Number(e.target.value) }))}
            />
          </label>
          <label>
            高さ {settings.pitch.toFixed(1)}
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={settings.pitch}
              onChange={(e) => setSettings((prev) => ({ ...prev, pitch: Number(e.target.value) }))}
            />
          </label>
        </div>

        <p className="preview-box">「{preview}」</p>

        <div className="morning-actions">
          <button className="primary" onClick={triggerNow}>
            🔔 今すぐテスト再生
          </button>
        </div>

        <p className="muted timer-note">
          この機能はこのアプリ（ブラウザ／PWA）を開いている間だけ、端末の時計を見て動作します。
          スリープさせず、閉じずに開いたままにしておいてください。
          ブラウザの自動再生制限があるため、一度「今すぐテスト再生」を押しておくと、以降の自動再生が有効になります。
        </p>
        <p className="muted timer-note">
          iPad で使う場合は、画面ロック（自動ロック）がかかるとアプリが停止してしまいます。
          設定アプリの「画面表示と明るさ」→「自動ロック」を「なし」にし、充電しながら画面をつけたまま
          このアプリを開いておいてください。
        </p>
      </div>
    </div>
  );
}
