import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readRuntimeConfig } from '@/config/env';
import { getAccessTokenSnapshot } from '@/services/auth/accessToken';
import { cleanupExpiredReportFiles, downloadAndShareReport } from './downloadReport';

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: { downloadFileAsync: jest.fn() },
  Paths: { cache: 'cache://reports' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/config/env', () => ({ readRuntimeConfig: jest.fn() }));
jest.mock('@/services/auth/accessToken', () => ({ getAccessTokenSnapshot: jest.fn() }));

const mockDownload = File.downloadFileAsync as jest.MockedFunction<typeof File.downloadFileAsync>;
const mockShareAvailable = Sharing.isAvailableAsync as jest.MockedFunction<typeof Sharing.isAvailableAsync>;
const mockShare = Sharing.shareAsync as jest.MockedFunction<typeof Sharing.shareAsync>;
const mockRuntimeConfig = readRuntimeConfig as jest.MockedFunction<typeof readRuntimeConfig>;
const mockToken = getAccessTokenSnapshot as jest.MockedFunction<typeof getAccessTokenSnapshot>;
const mockDirectory = Directory as unknown as jest.Mock;
const reportDirectory = {
  create: jest.fn(),
  exists: true,
  list: jest.fn(),
  uri: 'cache://reports/task-reports',
};

describe('downloadAndShareReport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    reportDirectory.exists = true;
    reportDirectory.create.mockReset();
    reportDirectory.list.mockReset().mockReturnValue([]);
    mockDirectory.mockImplementation(() => reportDirectory);
    mockRuntimeConfig.mockReturnValue({
      apiUrl: 'http://127.0.0.1:8000',
      appEnv: 'development',
      authMode: 'legacy',
      enableCacheDiagnostics: false,
    });
    mockToken.mockReturnValue({ token: 'access-token', version: 1 });
    mockShareAvailable.mockResolvedValue(true);
  });

  it('downloads an internal report with Bearer auth, shares it, and clears the temporary file', async () => {
    const temporaryFile = { delete: jest.fn(), uri: 'file:///cache/report.xlsx' };
    mockDownload.mockResolvedValue(temporaryFile as never);

    await downloadAndShareReport('/api/v1/reports/download/report-1');

    expect(mockDownload).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/reports/download/report-1',
      reportDirectory,
      { headers: { Authorization: 'Bearer access-token' } },
    );
    expect(mockDirectory).toHaveBeenCalledWith(Paths.cache, 'task-reports');
    expect(mockShare).toHaveBeenCalledWith('file:///cache/report.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(temporaryFile.delete).toHaveBeenCalledTimes(1);
    expect(reportDirectory.list).toHaveBeenCalledTimes(1);
  });

  it('rejects external report URLs before sending the access token', async () => {
    await expect(downloadAndShareReport('https://outside.example/report.xlsx')).rejects.toThrow('无效下载地址');

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('clears report files older than 24 hours and keeps recent files', () => {
    const now = Date.parse('2026-07-17T15:00:00+08:00');
    const expired = { delete: jest.fn(), lastModified: now - 25 * 60 * 60 * 1000 };
    const recent = { delete: jest.fn(), lastModified: now - 60 * 60 * 1000 };
    reportDirectory.list.mockReturnValue([expired, recent]);

    cleanupExpiredReportFiles(now);

    expect(expired.delete).toHaveBeenCalledTimes(1);
    expect(recent.delete).not.toHaveBeenCalled();
  });
});
