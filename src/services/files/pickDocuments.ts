import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { UploadDocument } from '@/services/api/uploads';

const DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];
const SUPPORTED_EXTENSION = /\.(csv|pdf|xls|xlsx)$/i;

export async function pickDocuments(): Promise<UploadDocument[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: DOCUMENT_TYPES,
  });
  if (result.canceled) return [];

  const documents = result.assets.map((asset) => ({
    mimeType: asset.mimeType ?? null,
    name: asset.name,
    size: asset.size ?? null,
    uri: asset.uri,
  }));
  const accepted = documents.filter((document) => SUPPORTED_EXTENSION.test(document.name));
  cleanupPickedDocuments(documents.filter((document) => !SUPPORTED_EXTENSION.test(document.name)));
  return accepted;
}

export function cleanupPickedDocuments(documents: UploadDocument[]): void {
  for (const document of documents) {
    try {
      new File(document.uri).delete();
    } catch {
      // 临时文件清理失败不影响任务结果，系统缓存会自行回收。
    }
  }
}
