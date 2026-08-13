export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

export interface FileUpload {
  name: string;
  type: 'pdf' | 'word' | 'image' | 'md';
  path?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress?: number;
}

export interface ConversionTask {
  id: string;
  fileName: string;
  sourceType: string;
  targetType: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  outputPath?: string;
  error?: string;
}

export interface DatabaseBook {
  id: string;
  title: string;
  author: string;
  vectorCount: number;
  lastUpdated: Date;
}
