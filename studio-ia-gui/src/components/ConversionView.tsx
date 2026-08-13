import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText } from 'lucide-react';
import type { ConversionTask } from '../types';
import { ConversionCard } from './ConversionCard';

export function ConversionView() {
  const [isDatabaseMode, setIsDatabaseMode] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [tasks, _setTasks] = useState<ConversionTask[]>([]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      // Process files here
      console.log('Files dropped:', e.dataTransfer.files);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {isDatabaseMode ? 'Libri Data Base' : 'Conversione File'}
            </h2>
            <p className="text-gray-400 mt-1">
              {isDatabaseMode
                ? 'Converti e vettorizza libri per il database'
                : 'Converti PDF, Word e immagini in Markdown vettorizzato'}
            </p>
          </div>

          <motion.button
            onClick={() => setIsDatabaseMode(!isDatabaseMode)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`px-4 py-2 rounded-xl font-medium transition-all ${
              isDatabaseMode
                ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            {isDatabaseMode ? '← Torna a Conversione' : '📚 Libri Data Base'}
          </motion.button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Area */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
                dragActive
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-white/20 hover:border-white/30'
              }`}
            >
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.md"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => console.log('Files selected:', e.target.files)}
              />

              <div className="flex flex-col items-center">
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-blue-600/20 flex items-center justify-center mb-4"
                >
                  <Upload className="w-8 h-8 text-violet-400" />
                </motion.div>

                <h3 className="text-lg font-semibold text-white mb-2">
                  Trascina i file qui o clicca per caricare
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  Supporta PDF, Word (.doc/.docx), Immagini (.png/.jpg) e Markdown (.md)
                </p>

                <div className="flex gap-2 flex-wrap justify-center">
                  {['PDF', 'Word', 'Immagini', 'Markdown'].map((format) => (
                    <span
                      key={format}
                      className="px-3 py-1 bg-white/10 rounded-full text-xs text-gray-300"
                    >
                      {format}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Info Card */}
            <div className="bg-gradient-to-r from-violet-600/10 to-blue-600/10 rounded-xl p-4 border border-violet-500/20">
              <h4 className="font-medium text-white mb-2">
                {isDatabaseMode ? 'Flusso Database' : 'Flusso Utente'}
              </h4>
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <span>File</span>
                <span className="text-violet-400">→</span>
                <span>Markdown</span>
                <span className="text-violet-400">→</span>
                <span>Vettori</span>
                <span className="text-violet-400">→</span>
                <span className="font-medium">
                  {isDatabaseMode ? 'data_base/' : 'user_files/'}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Tasks List */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-4"
          >
            <h3 className="text-lg font-semibold text-white">
              Conversioni in corso
            </h3>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {tasks.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                    <FileText className="w-8 h-8 text-gray-500" />
                  </div>
                  <p className="text-gray-400">Nessuna conversione in corso</p>
                  <p className="text-sm text-gray-500 mt-1">
                    I file caricati appariranno qui
                  </p>
                </div>
              ) : (
                <AnimatePresence>
                  {tasks.map((task) => (
                    <ConversionCard key={task.id} task={task} />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
