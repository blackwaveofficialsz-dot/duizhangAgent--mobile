import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readRuntimeConfig } from '@/config/env';
import { getAccessTokenSnapshot } from '@/services/auth/accessToken';

const REPORT_CACHE_DIRECTORY = 'task-reports';
const REPORT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function cleanupExpiredReportFiles(now = Date.now()): void {
  try {
    const directory = new Directory(Paths.cache, REPORT_CACHE_DIRECTORY);
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      if ('lastModified' in entry && typeof entry.lastModified === 'number' && now - entry.lastModified >= REPORT_CACHE_TTL_MS) {
        try { entry.delete(); } catch {}
      }
    }
  } catch {}
}

export async function downloadAndShareReport(path: string): Promise<void> {
  if (!path.startsWith('/api/')) throw new Error('无效下载地址');

  const { token } = getAccessTokenSnapshot();
  if (!token) throw new Error('登录状态已失效，请重新登录');
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备不支持系统分享');

  const { apiUrl } = readRuntimeConfig();
  const directory = new Directory(Paths.cache, REPORT_CACHE_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const file = await File.downloadFileAsync(`${apiUrl}${path}`, directory, {
    headers: { Authorization: `Bearer ${token}` },
  });

  try {
    await Sharing.shareAsync(file.uri, { mimeType: reportMimeType(path) });
  } finally {
    try { file.delete(); } finally { cleanupExpiredReportFiles(); }
  }
}

function reportMimeType(path: string): string {
  if (path.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (path.toLowerCase().endsWith('.csv')) return 'text/csv';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
