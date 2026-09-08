import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { pickDocuments } from './pickDocuments';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ delete: jest.fn() })) }));

describe('pickDocuments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies selected Excel, PDF, and CSV files to cache while preserving Chinese names', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      assets: [
        { mimeType: 'application/pdf', name: '对账单_2026-07.pdf', size: 42, uri: 'file:///cache/report.pdf' },
        { mimeType: 'text/csv', name: '流水_2026-07.csv', size: 24, uri: 'file:///cache/report.csv' },
      ],
      canceled: false,
    } as never);

    await expect(pickDocuments()).resolves.toEqual([
      { mimeType: 'application/pdf', name: '对账单_2026-07.pdf', size: 42, uri: 'file:///cache/report.pdf' },
      { mimeType: 'text/csv', name: '流水_2026-07.csv', size: 24, uri: 'file:///cache/report.csv' },
    ]);
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({
      copyToCacheDirectory: true,
      multiple: true,
      type: expect.arrayContaining(['text/csv']),
    }));
  });

  it('deletes copied cache files that are filtered out', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      assets: [{ mimeType: 'text/plain', name: '说明.txt', size: 9, uri: 'file:///cache/notes.txt' }],
      canceled: false,
    } as never);

    await expect(pickDocuments()).resolves.toEqual([]);

    expect(File).toHaveBeenCalledWith('file:///cache/notes.txt');
    expect((jest.mocked(File).mock.results[0]?.value as { delete: jest.Mock }).delete).toHaveBeenCalledTimes(1);
  });
});
