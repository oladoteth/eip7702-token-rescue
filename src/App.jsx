import { AppProvider } from "./contexts/AppContext";
import { RescueTab } from "./components/RescueTab";
import "./styles/App.css";

function AppContent() {
  return (
    <div className="app">
      <header>
        <h1>Token Rescue Tool</h1>
        <p>
          Move tokens, NFTs and staked positions out of a compromised wallet in one EIP-7702 transaction
        </p>
      </header>

      <main>
        <RescueTab />
      </main>

      <footer>
          <p>
            Security Notice: All operations run locally. Private keys never
            leave your device.
          </p>
          <p>
            Your rescue wallet pays all gas. The compromised wallet never receives ETH, so
            a sweeper bot has nothing to take.
          </p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
