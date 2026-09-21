import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteAudio, loadAudio, saveAudio } from "../audioStore";

interface DateRule {
  id: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  patternId: string;
  customMessage: string;
}

interface MorningSettings {
  enabled: boolean;
  time: string; // "HH:MM" (この端末のローカル時計基準)
  days: number[]; // 0(日)〜6(土)
  voiceSource: "tts" | "upload";
  patternId: string;
  customMessage: string;
  dateRules: DateRule[];
  voiceURI: string;
  rate: number;
  pitch: number;
}

const STORAGE_KEY = "morning-call-settings-v1";
const LAST_FIRED_KEY = "morning-call-last-fired";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const PATTERNS: { id: string; label: string; template: string }[] = [
  { id: "notice", label: "回覧物確認（職員向け）", template: "{time}になりました。職員の皆さんは回覧物、ファイルを確認してください。" },
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
  voiceSource: "tts",
  patternId: "notice",
  customMessage: "おはようございます。起きる時間です。",
  dateRules: [],
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

function textForPattern(patternId: string, customMessage: string, time: string) {
  const template = patternId === "custom" ? customMessage : PATTERNS.find((p) => p.id === patternId)?.template ?? "";
  return template.split("{time}").join(time);
}

function findActiveDateRule(rules: DateRule[], date: Date): DateRule | null {
  const dateStr = localDateStr(date);
  return rules.find((r) => r.startDate && r.endDate && r.startDate <= dateStr && dateStr <= r.endDate) ?? null;
}

function messageFor(settings: MorningSettings, date: Date = new Date()) {
  const activeRule = findActiveDateRule(settings.dateRules, date);
  if (activeRule) {
    return textForPattern(activeRule.patternId, activeRule.customMessage, settings.time);
  }
  return textForPattern(settings.patternId, settings.customMessage, settings.time);
}

function newRuleId() {
  return Math.random().toString(36).slice(2, 9);
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateStr(date);
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
  const [audioInfo, setAudioInfo] = useState<{ name: string; url: string } | null>(null);
  const [audioError, setAudioError] = useState("");
  const [lastFired, setLastFired] = useState<string>(localStorage.getItem(LAST_FIRED_KEY) ?? "");
  const [bulkStartDate, setBulkStartDate] = useState("");
  const [bulkText, setBulkText] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastFiredRef = useRef<string>(lastFired);
  const audioInfoRef = useRef<{ name: string; url: string } | null>(null);
  audioInfoRef.current = audioInfo;

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

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    loadAudio()
      .then((stored) => {
        if (cancelled || !stored) return;
        createdUrl = URL.createObjectURL(stored.blob);
        setAudioInfo({ name: stored.name, url: createdUrl });
      })
      .catch(() => {
        // 保存済み音声がない、または読み込みに失敗した場合は無視
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
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

  const playUploadedAudio = useCallback(() => {
    const info = audioInfoRef.current;
    if (!info) return;
    const audio = new Audio(info.url);
    void audio.play();
  }, []);

  const triggerNow = useCallback(() => {
    playChime();
    window.setTimeout(() => {
      if (settings.voiceSource === "upload") {
        playUploadedAudio();
      } else {
        speakMessage(messageFor(settings));
      }
    }, 750);
  }, [playChime, playUploadedAudio, speakMessage, settings]);

  useEffect(() => {
    if (!settings.enabled) return;
    const id = window.setInterval(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const current = `${hh}:${mm}`;
      const todayStr = localDateStr(now);
      setNowLabel(current);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const [targetH, targetM] = settings.time.split(":").map(Number);
      const targetMinutes = targetH * 60 + targetM;
      // 完全一致ではなく「指定時刻を過ぎているか」で判定する。
      // スリープ／画面ロックから復帰した直後にタイマーが動き出した場合でも、
      // ちょうどその分を狙い撃ちできず永久に鳴らなくなるのを防ぐため。
      if (
        nowMinutes >= targetMinutes &&
        settings.days.includes(now.getDay()) &&
        lastFiredRef.current !== todayStr
      ) {
        lastFiredRef.current = todayStr;
        localStorage.setItem(LAST_FIRED_KEY, todayStr);
        setLastFired(todayStr);
        triggerNow();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [settings, triggerNow]);

  const resetTodaysFireFlag = () => {
    lastFiredRef.current = "";
    localStorage.removeItem(LAST_FIRED_KEY);
    setLastFired("");
  };

  const toggleDay = (day: number) => {
    setSettings((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day].sort()
    }));
  };

  const setAllDays = (days: number[]) => setSettings((prev) => ({ ...prev, days }));

  const addDateRule = () => {
    setSettings((prev) => ({
      ...prev,
      dateRules: [
        ...prev.dateRules,
        { id: newRuleId(), startDate: "", endDate: "", patternId: "standard", customMessage: "" }
      ]
    }));
  };

  const updateDateRule = (id: string, patch: Partial<DateRule>) => {
    setSettings((prev) => ({
      ...prev,
      dateRules: prev.dateRules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }));
  };

  const removeDateRule = (id: string) => {
    setSettings((prev) => ({ ...prev, dateRules: prev.dateRules.filter((r) => r.id !== id) }));
  };

  const bulkLines = useMemo(
    () =>
      bulkText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [bulkText]
  );

  const applyBulkMessages = () => {
    if (!bulkStartDate || bulkLines.length === 0) return;
    const newRules: DateRule[] = bulkLines.map((line, i) => {
      const dateStr = addDaysToDateStr(bulkStartDate, i);
      return { id: newRuleId(), startDate: dateStr, endDate: dateStr, patternId: "custom", customMessage: line };
    });
    setSettings((prev) => ({ ...prev, dateRules: [...prev.dateRules, ...newRules] }));
    setBulkText("");
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAudioError("");
    try {
      await saveAudio(file, file.name);
      if (audioInfo) URL.revokeObjectURL(audioInfo.url);
      const url = URL.createObjectURL(file);
      setAudioInfo({ name: file.name, url });
    } catch {
      setAudioError("音声ファイルの保存に失敗しました。もう一度お試しください。");
    }
  };

  const handleDeleteAudio = async () => {
    try {
      await deleteAudio();
    } catch {
      // 削除に失敗しても表示上はクリアする
    }
    if (audioInfo) URL.revokeObjectURL(audioInfo.url);
    setAudioInfo(null);
  };

  const preview = useMemo(() => messageFor(settings), [settings, nowLabel]);
  const nextFire = useMemo(() => nextFireLabel(settings), [settings, nowLabel]);
  const firedToday = useMemo(() => lastFired !== "" && lastFired === localDateStr(new Date()), [lastFired, nowLabel]);
  const todayActiveRule = useMemo(() => findActiveDateRule(settings.dateRules, new Date()), [settings.dateRules, nowLabel]);

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

        {firedToday && (
          <div className="morning-row morning-row-top fired-today-notice">
            <span className="muted">✅ 本日はすでに再生済みです（次は明日以降の対象曜日に再生されます）</span>
            <button type="button" onClick={resetTodaysFireFlag}>
              本日分をリセット
            </button>
          </div>
        )}

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

        <div className="morning-row">
          <span className="muted">音声ソース</span>
          <div className="voice-source-options">
            <label className="voice-source-option">
              <input
                type="radio"
                name="voice-source"
                checked={settings.voiceSource === "tts"}
                onChange={() => setSettings((prev) => ({ ...prev, voiceSource: "tts" }))}
              />
              読み上げ（音声合成）
            </label>
            <label className="voice-source-option">
              <input
                type="radio"
                name="voice-source"
                checked={settings.voiceSource === "upload"}
                onChange={() => setSettings((prev) => ({ ...prev, voiceSource: "upload" }))}
              />
              アップロードした音声
            </label>
          </div>
        </div>

        {settings.voiceSource === "upload" ? (
          <div className="morning-row audio-upload-box">
            <label htmlFor="morning-audio-upload">音声ファイル（mp3, m4a, wav など）</label>
            <input id="morning-audio-upload" type="file" accept="audio/*" onChange={handleAudioUpload} />
            {audioError && <span className="muted">{audioError}</span>}
            {audioInfo ? (
              <div className="audio-file-row">
                <span className="audio-file-name">🎵 {audioInfo.name}</span>
                <button type="button" onClick={playUploadedAudio}>
                  ▶ 試聴
                </button>
                <button type="button" onClick={handleDeleteAudio}>
                  削除
                </button>
              </div>
            ) : (
              <span className="muted">まだ音声がアップロードされていません。</span>
            )}
          </div>
        ) : (
          <>
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

            <div className="morning-row date-rules-section">
              <span className="muted">期間ごとのメッセージ（任意）</span>
              <p className="muted note-text date-rules-hint">
                指定した期間中は、上の「メッセージパターン」の代わりにここで設定したメッセージが使われます。
                期間外の日は上のパターンのままです。1日だけ変えたい場合は開始日と終了日に同じ日を指定してください。
                {todayActiveRule && "（本日はいずれかの期間設定が適用されています）"}
              </p>
              {settings.dateRules.map((rule) => (
                <div className="date-rule-row" key={rule.id}>
                  <div className="date-rule-dates">
                    <input
                      type="date"
                      value={rule.startDate}
                      onChange={(e) => updateDateRule(rule.id, { startDate: e.target.value })}
                    />
                    <span className="muted">〜</span>
                    <input
                      type="date"
                      value={rule.endDate}
                      onChange={(e) => updateDateRule(rule.id, { endDate: e.target.value })}
                    />
                    <button type="button" className="phase-remove" onClick={() => removeDateRule(rule.id)} aria-label="削除">
                      ✕
                    </button>
                  </div>
                  <select value={rule.patternId} onChange={(e) => updateDateRule(rule.id, { patternId: e.target.value })}>
                    {PATTERNS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {rule.patternId === "custom" && (
                    <textarea
                      className="custom-message-input"
                      rows={2}
                      value={rule.customMessage}
                      onChange={(e) => updateDateRule(rule.id, { customMessage: e.target.value })}
                      placeholder="この期間中に読み上げるメッセージ（{time} で時刻を挿入できます）"
                    />
                  )}
                  <span className="muted date-rule-preview">
                    「{textForPattern(rule.patternId, rule.customMessage, settings.time)}」
                  </span>
                </div>
              ))}
              <button type="button" onClick={addDateRule}>
                + 期間を追加
              </button>

              <div className="date-rules-bulk">
                <span className="muted">まとめて入力（毎日ちがうメッセージを一括登録）</span>
                <p className="muted note-text date-rules-hint">
                  開始日を選び、1行に1日分のメッセージを入力してください。1行目が開始日、2行目がその翌日…と、
                  入力した行数ぶん自動的に1日1件ずつ登録されます（例: 30行入力すれば30日分をまとめて登録できます）。
                </p>
                <label htmlFor="bulk-start-date">開始日</label>
                <input
                  id="bulk-start-date"
                  type="date"
                  value={bulkStartDate}
                  onChange={(e) => setBulkStartDate(e.target.value)}
                />
                <textarea
                  className="custom-message-input"
                  rows={6}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"1日目のメッセージ\n2日目のメッセージ\n3日目のメッセージ\n..."}
                />
                {bulkLines.length > 0 && bulkStartDate && (
                  <span className="muted">
                    {bulkStartDate} 〜 {addDaysToDateStr(bulkStartDate, bulkLines.length - 1)} の {bulkLines.length}
                    日分を登録します
                  </span>
                )}
                <button type="button" onClick={applyBulkMessages} disabled={!bulkStartDate || bulkLines.length === 0}>
                  この内容で一括登録
                </button>
              </div>
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
          </>
        )}

        <div className="morning-actions">
          <button className="primary" onClick={triggerNow}>
            🔔 今すぐテスト再生
          </button>
        </div>

        <p className="muted note-text">
          この機能はこのアプリ（ブラウザ／PWA）を開いている間だけ、端末の時計を見て動作します。
          スリープさせず、閉じずに開いたままにしておいてください。
          ブラウザの自動再生制限があるため、一度「今すぐテスト再生」を押しておくと、以降の自動再生が有効になります。
        </p>
        <p className="muted note-text">
          会社・学校のパソコンなど、しばらく操作しないと自動で画面ロック／スリープする設定の場合、
          ロック中はこのアプリも動作が止まります。ちょうどその時刻を狙い撃ちできなくても、
          ロックが解除されて画面に戻った時点で指定時刻を過ぎていれば、その時点ですぐに再生されます。
        </p>
        <p className="muted note-text">
          iPad で使う場合は、画面ロック（自動ロック）がかかるとアプリが停止してしまいます。
          設定アプリの「画面表示と明るさ」→「自動ロック」を「なし」にし、充電しながら画面をつけたまま
          このアプリを開いておいてください。
        </p>
      </div>
    </div>
  );
}
