import { motion } from 'framer-motion';
import { BookOpen, Upload, CheckCircle, Clock } from 'lucide-react';
import type { DatabaseBook } from '../types';

export function DatabaseView() {
  const books: DatabaseBook[] = [
    // Example books - will be populated from actual data_base folder
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <h2 className="text-2xl font-bold text-white mb-2">Libri Data Base</h2>
        <p className="text-gray-400">
          Gestisci i libri pre-vettorizzati nel database
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="bg-gradient-to-r from-violet-600/10 to-blue-600/10 rounded-2xl p-6 border border-violet-500/20">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-violet-400" />
                Carica Nuovo Libro
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    File Markdown (.md)
                  </label>
                  <input
                    type="file"
                    accept=".md"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-gray-300 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-violet-600 file:text-white file:hover:bg-violet-500 hover:border-white/30 transition-all cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Titolo del Libro
                  </label>
                  <input
                    type="text"
                    placeholder="Inserisci il titolo..."
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Autore
                  </label>
                  <input
                    type="text"
                    placeholder="Inserisci l'autore..."
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  />
                </div>

                <button className="w-full py-3 bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-xl font-medium hover:from-violet-500 hover:to-blue-500 transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" />
                  Carica e Vettorizza
                </button>
              </div>
            </div>

            {/* Info Card */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10">
              <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                Informazioni
              </h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span>I file MD vengono automaticamente vettorizzati</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span>I vettori sono salvati in data_base/</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Supporta chunking intelligente per testi lunghi</span>
                </li>
              </ul>
            </div>
          </motion.div>

          {/* Books List */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-4"
          >
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-400" />
              Libri nel Database
            </h3>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {books.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                    <BookOpen className="w-8 h-8 text-gray-500" />
                  </div>
                  <p className="text-gray-400">Nessun libro nel database</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Carica un libro per iniziare
                  </p>
                </div>
              ) : (
                books.map((book, index) => (
                  <motion.div
                    key={book.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600/20 to-cyan-600/20 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="w-5 h-5 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-white truncate">{book.title}</h4>
                        <p className="text-sm text-gray-400 mt-0.5">{book.author}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-green-400" />
                            {book.vectorCount} vettori
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(book.lastUpdated).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
