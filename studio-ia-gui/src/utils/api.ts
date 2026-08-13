import { invoke } from "@tauri-apps/api/core";

export async function convertFile(
  filePath: string,
  sourceType: string,
  targetType: string = 'md'
): Promise<string> {
  return await invoke('convert_file', { filePath, sourceType, targetType });
}

export async function vectorizeFile(
  filePath: string,
  destinationFolder: 'user_files' | 'data_base'
): Promise<void> {
  return await invoke('vectorize_file', { filePath, destinationFolder });
}

export async function chatWithRAG(
  message: string,
  conversationId?: string
): Promise<{ response: string; conversationId: string }> {
  return await invoke('chat_with_rag', { message, conversationId });
}

export async function getDatabaseBooks(): Promise<any[]> {
  return await invoke('get_database_books');
}

export async function uploadBookToDatabase(
  mdFilePath: string,
  bookTitle: string,
  author: string
): Promise<void> {
  return await invoke('upload_book_to_database', { mdFilePath, bookTitle, author });
}
