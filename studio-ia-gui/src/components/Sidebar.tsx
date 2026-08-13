import { motion } from 'framer-motion';
import { Home, FileText, MessageSquare, Settings, BookOpen } from 'lucide-react';

type View = 'home' | 'conversion' | 'chat' | 'settings' | 'database';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const menuItems = [
    { id: 'home' as View, icon: Home, label: 'Home' },
    { id: 'conversion' as View, icon: FileText, label: 'Conversione' },
    { id: 'database' as View, icon: BookOpen, label: 'Libri Data Base' },
    { id: 'chat' as View, icon: MessageSquare, label: 'Chat RAG' },
    { id: 'settings' as View, icon: Settings, label: 'Impostazioni' },
  ] as const;

  return (
    <motion.aside
      initial={{ x: -280 }}
      animate={{ x: 0 }}
      className="w-70 bg-gradient-to-b from-gray-900/95 to-gray-800/95 backdrop-blur-xl border-r border-white/10 flex flex-col h-full"
    >
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
          Studio IA
        </h1>
        <p className="text-xs text-gray-400 mt-1">RAG System v2.0</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <motion.button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/20 text-white border border-violet-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-1.5 h-1.5 rounded-full bg-gradient-to-r from-violet-400 to-blue-400"
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <div className="bg-gradient-to-r from-violet-600/10 to-blue-600/10 rounded-xl p-3 border border-violet-500/20">
          <p className="text-xs text-gray-300 font-medium">Database Attivo</p>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-400">user_files & data_base</span>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
