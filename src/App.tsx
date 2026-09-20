import Header from "./components/Header";
import MorningCall from "./components/MorningCall";
import PasswordGate from "./components/PasswordGate";

export default function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <PasswordGate>
          <MorningCall />
        </PasswordGate>
      </main>
    </div>
  );
}
