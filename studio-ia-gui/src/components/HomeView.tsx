import { motion } from 'framer-motion';
import { BookOpen, Database, HardDrive, Cpu } from 'lucide-react';

export function HomeView() {
  const stats = [
    { label: 'Documenti Utente', value: '0', icon: HardDrive, color: 'from-violet-500 to-purple-500' },
    { label: 'Libri Database', value: '0', icon: BookOpen, color: 'from-blue-500 to-cyan-500' },
    { label: 'Vettori Totali', value: '0', icon: Database, color: 'from-emerald-500 to-teal-500' },
    { label: 'Conversioni Oggi', value: '0', icon: Cpu, color: 'from-orange-500 to-red-500' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-white mb-2">
          Benvenuto in Studio IA
        </h1>
        <p className="text-gray-400">
          Sistema RAG avanzato per la gestione intelligente dei tuoi documenti
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02, y: -2 }}
              className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:border-white/20 transition-all"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center mb-4`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
              <p className="text-sm text-gray-400">{stat.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-gradient-to-r from-violet-600/10 to-blue-600/10 rounded-2xl p-6 border border-violet-500/20"
      >
        <h2 className="text-xl font-bold text-white mb-4">Azioni Rapide</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <h3 className="font-medium text-white mb-2">📄 Converti File</h3>
            <p className="text-sm text-gray-400 mb-3">
              Trasforma PDF, Word e immagini in Markdown vettorizzato
            </p>
            <div className="text-xs text-violet-400">→ Vai a Conversione</div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <h3 className="font-medium text-white mb-2">📚 Carica Libri</h3>
            <p className="text-sm text-gray-400 mb-3">
              Aggiungi libri pre-processati al database
            </p>
            <div className="text-xs text-blue-400">→ Vai a Libri Data Base</div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <h3 className="font-medium text-white mb-2">💬 Chat RAG</h3>
            <p className="text-sm text-gray-400 mb-3">
              Interroga i documenti con intelligenza artificiale
            </p>
            <div className="text-xs text-emerald-400">→ Vai a Chat</div>
          </div>
        </div>
      </motion.div>

      {/* Info Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10">
          <h3 className="font-semibold text-white mb-2">Cartella Utente</h3>
          <p className="text-sm text-gray-400">
            I file caricati vengono convertiti in Markdown, vettorizzati e salvati in{' '}
            <code className="px-2 py-0.5 bg-white/10 rounded text-violet-300">user_files/</code>
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10">
          <h3 className="font-semibold text-white mb-2">Database Libri</h3>
          <p className="text-sm text-gray-400">
            I libri pre-selezionati sono già vettorizzati e disponibili in{' '}
            <code className="px-2 py-0.5 bg-white/10 rounded text-blue-300">data_base/</code>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
