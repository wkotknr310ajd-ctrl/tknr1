import Header from "./components/Header";
import TimerView from "./components/TimerView";

export default function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <TimerView />
      </main>
    </div>
  );
}
