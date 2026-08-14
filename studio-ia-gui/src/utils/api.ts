// API base URL - server Python locale
const API_BASE_URL = 'http://127.0.0.1:8765/api';

export interface ApiResponse {
  success: boolean;
  error?: string;
  path?: string;
  message?: string;
  response?: string;
  conversation_id?: string;
  vectors_created?: number;
  destination?: string;
  caption?: string;
  ocr_text?: string;
  latex?: string;
}

export interface BookInfo {
  name: string;
  path: string;
  chunks: number;
}

export interface SystemInfo {
  ram_total: number;
  ram_available: number;
  disk_total: number;
  disk_free: number;
  user_files_count: number;
  database_files_count: number;
}

async function fetchApi<T>(endpoint: string, data?: any): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const options: RequestInit = {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API error (${endpoint}):`, error);
    throw error;
  }
}

export async function convertFile(
  filePath: string,
  fileType: string
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/convert', { file_path: filePath, file_type: fileType });
}

export async function vectorizeMdFile(
  mdFilePath: string,
  destination: 'user' | 'database'
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/vectorize', { 
    md_file_path: mdFilePath, 
    destination 
  });
}

export async function processImage(
  imagePath: string,
  bookName: string = '',
  pageNum: number = 0
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/process_image', { 
    image_path: imagePath, 
    book_name: bookName, 
    page_num: pageNum 
  });
}

export async function chatWithRAG(
  message: string,
  conversationId?: string
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/chat', { 
    message, 
    conversation_id: conversationId 
  });
}

export async function getDatabaseBooks(): Promise<BookInfo[]> {
  return await fetchApi<BookInfo[]>('/books');
}

export async function uploadBookToDatabase(
  mdFilePath: string,
  bookTitle: string,
  author: string
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/upload_book', { 
    md_file_path: mdFilePath, 
    book_title: bookTitle, 
    author 
  });
}

export async function loadModel(
  modelPath: string,
  modelType: 'text' | 'vision'
): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/load_model', { 
    model_path: modelPath, 
    model_type: modelType 
  });
}

export async function getSettings(): Promise<any> {
  return await fetchApi<any>('/settings');
}

export async function saveSettings(settings: any): Promise<ApiResponse> {
  return await fetchApi<ApiResponse>('/settings', settings);
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return await fetchApi<SystemInfo>('/system');
}
