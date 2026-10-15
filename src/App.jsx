import { useState } from "react";
import { AppProvider } from "./contexts/AppContext";
import { RescueTab } from "./components/RescueTab";
import { DonateTab } from "./components/DonateTab";
import "./styles/App.css";

function AppContent() {
  const [activeTab, setActiveTab] = useState("rescue");

  return (
    <div className="app">
      <header>
        <h1>Token Rescue Tool</h1>
        <p>
          Rescue tokens and NFTs from compromised wallets using batcher contracts
        </p>
      </header>

      <div className="tabs">
        <button
          className={activeTab === "rescue" ? "active" : ""}
          onClick={() => setActiveTab("rescue")}
        >
          <span>Rescue</span>
        </button>
        <button
          className={activeTab === "donate" ? "active" : ""}
          onClick={() => setActiveTab("donate")}
        >
          <span>Donate</span>
        </button>
      </div>

      <main>
        {activeTab === "rescue" && <RescueTab />}

        {activeTab === "donate" && <DonateTab />}

      </main>

      <footer>
          <p>
            Security Notice: All operations run locally. Private keys never
            leave your device.
          </p>
          <p>
            This tool uses batcher contracts for batch execution. The rescue wallet
            pays for gas fees.
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
