import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Database, FolderOpen, Bell, Palette } from 'lucide-react';

export function SettingsView() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="text-2xl font-bold text-white mb-2">Impostazioni</h2>
          <p className="text-gray-400">Configura il sistema RAG e le preferenze dell'applicazione</p>
        </motion.div>

        {/* Database Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg font-semibold text-white">Cartelle Database</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Cartella Utente (user_files)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value="./user_files"
                  readOnly
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-gray-300 text-sm"
                />
                <button className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" />
                  Cambia
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Contiene i vettori dei file caricati dall'utente
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Cartella Libri (data_base)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value="./data_base"
                  readOnly
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-gray-300 text-sm"
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" />
                  Cambia
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Contiene i vettori dei libri pre-caricati
              </p>
            </div>
          </div>
        </motion.section>

        {/* Appearance */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-4">
            <Palette className="w-5 h-5 text-pink-400" />
            <h3 className="text-lg font-semibold text-white">Aspetto</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Tema Colore
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { name: 'Viola', gradient: 'from-violet-600 to-blue-600' },
                  { name: 'Verde', gradient: 'from-emerald-600 to-teal-600' },
                  { name: 'Arancio', gradient: 'from-orange-600 to-red-600' },
                ].map((theme) => (
                  <button
                    key={theme.name}
                    className={`h-12 rounded-lg bg-gradient-to-r ${theme.gradient} ring-2 ring-white/20 hover:ring-white/40 transition-all`}
                  >
                    <span className="sr-only">{theme.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Notifications */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-4">
            <Bell className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">Notifiche</h3>
          </div>

          <div className="space-y-3">
            {[
              { label: 'Conversione completata', enabled: true },
              { label: 'Errore durante la conversione', enabled: true },
              { label: 'Nuovo libro nel database', enabled: false },
            ].map((setting) => (
              <div
                key={setting.label}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
              >
                <span className="text-sm text-gray-300">{setting.label}</span>
                <button
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    setting.enabled ? 'bg-violet-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      setting.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </motion.section>

        {/* About */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-4">
            <SettingsIcon className="w-5 h-5 text-gray-400" />
            <h3 className="text-lg font-semibold text-white">Informazioni</h3>
          </div>

          <div className="space-y-2 text-sm text-gray-400">
            <p>Versione: 2.0.0</p>
            <p>Tecnologia: Tauri + React + TypeScript</p>
            <p>Sistema RAG con supporto per PDF, Word, Immagini e Markdown</p>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
