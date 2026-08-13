import { motion } from 'framer-motion';
import { FileText, Image, File, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { ConversionTask } from '../types';

interface ConversionCardProps {
  task: ConversionTask;
}

export function ConversionCard({ task }: ConversionCardProps) {
  const getIcon = () => {
    switch (task.sourceType.toLowerCase()) {
      case 'pdf':
        return <FileText className="w-6 h-6" />;
      case 'image':
      case 'png':
      case 'jpg':
      case 'jpeg':
        return <Image className="w-6 h-6" />;
      default:
        return <File className="w-6 h-6" />;
    }
  };

  const getStatusColor = () => {
    switch (task.status) {
      case 'completed':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'processing':
        return 'text-blue-500';
      default:
        return 'text-gray-400';
    }
  };

  const getIconComponent = () => {
    switch (task.status) {
      case 'completed':
        return <CheckCircle className={`w-5 h-5 ${getStatusColor()}`} />;
      case 'error':
        return <AlertCircle className={`w-5 h-5 ${getStatusColor()}`} />;
      case 'processing':
        return <Loader2 className={`w-5 h-5 animate-spin ${getStatusColor()}`} />;
      default:
        return <div className={`w-5 h-5 rounded-full border-2 ${getStatusColor()} border-current`} />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="text-gray-400 mt-1">{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-white truncate">{task.fileName}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {task.sourceType.toUpperCase()} → {task.targetType.toUpperCase()}
          </p>
          {task.status === 'processing' && (
            <div className="mt-2 w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${task.progress}%` }}
                className="h-full bg-gradient-to-r from-violet-500 to-blue-500"
              />
            </div>
          )}
          {task.error && (
            <p className="text-xs text-red-400 mt-1">{task.error}</p>
          )}
        </div>
        <div className="flex-shrink-0">{getIconComponent()}</div>
      </div>
    </motion.div>
  );
}
