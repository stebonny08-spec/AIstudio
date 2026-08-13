import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import { ConversionView } from "./components/ConversionView";
import { ChatView } from "./components/ChatView";
import { DatabaseView } from "./components/DatabaseView";
import { SettingsView } from "./components/SettingsView";
import "./App.css";

type View = 'home' | 'conversion' | 'chat' | 'settings' | 'database';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return <HomeView />;
      case 'conversion':
        return <ConversionView />;
      case 'chat':
        return <ChatView />;
      case 'database':
        return <DatabaseView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1 overflow-hidden">
        {renderView()}
      </main>
    </div>
  );
}

export default App;
