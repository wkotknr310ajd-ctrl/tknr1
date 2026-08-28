import { useState } from "react";
import Header, { type Tab } from "./components/Header";
import TimerView from "./components/TimerView";
import MorningCall from "./components/MorningCall";

export default function App() {
  const [tab, setTab] = useState<Tab>("timer");

  return (
    <div className="app">
      <Header active={tab} onChange={setTab} />
      <main>{tab === "timer" ? <TimerView /> : <MorningCall />}</main>
    </div>
  );
}
