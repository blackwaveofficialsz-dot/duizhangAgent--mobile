import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { shareWorkbook } from './shareWorkbook';

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { cache: 'cache://exports' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('xlsx', () => ({
  utils: { book_append_sheet: jest.fn(), book_new: jest.fn(), json_to_sheet: jest.fn() },
  write: jest.fn(),
}));

const mockDirectory = Directory as unknown as jest.Mock;
const mockFile = File as unknown as jest.Mock;
const mockShareAvailable = Sharing.isAvailableAsync as jest.MockedFunction<typeof Sharing.isAvailableAsync>;
const mockShare = Sharing.shareAsync as jest.MockedFunction<typeof Sharing.shareAsync>;

describe('shareWorkbook', () => {
  const file = { create: jest.fn(), delete: jest.fn(), exists: true, uri: 'file:///cache/orders.xlsx', write: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    mockDirectory.mockImplementation(() => ({ create: jest.fn() }));
    mockFile.mockImplementation(() => file);
    mockShareAvailable.mockResolvedValue(true);
    jest.mocked(XLSX.utils.book_new).mockReturnValue({} as never);
    jest.mocked(XLSX.utils.json_to_sheet).mockReturnValue({} as never);
    jest.mocked(XLSX.write).mockReturnValue(new Uint8Array([1, 2, 3]) as never);
  });

  it('writes each named sheet, shares the workbook, and deletes it afterwards', async () => {
    await shareWorkbook({
      fileName: '订单统计.xlsx',
      sheets: [{ name: '订单明细', rows: [{ 净实收: 1200, 维度: '唐城医院店' }] }],
      title: '订单统计',
    });

    expect(mockDirectory).toHaveBeenCalledWith(Paths.cache, 'chart-exports');
    expect(mockShare).toHaveBeenCalledWith(file.uri, expect.objectContaining({ dialogTitle: '分享订单统计' }));
    expect(file.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the temporary workbook when sharing fails', async () => {
    mockShare.mockRejectedValueOnce(new Error('cancelled'));

    await expect(shareWorkbook({
      fileName: '订单统计.xlsx',
      sheets: [{ name: '订单明细', rows: [{ 净实收: 1200, 维度: '唐城医院店' }] }],
      title: '订单统计',
    })).rejects.toThrow('cancelled');

    expect(file.delete).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'write'] as const)('deletes the temporary workbook when file.%s fails', async (method) => {
    file[method].mockImplementationOnce(() => { throw new Error(`${method} failed`); });

    await expect(shareWorkbook({
      fileName: '订单统计.xlsx',
      sheets: [{ name: '订单明细', rows: [{ 净实收: 1200, 维度: '唐城医院店' }] }],
      title: '订单统计',
    })).rejects.toThrow(`${method} failed`);

    expect(file.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects empty sheets before creating a file', async () => {
    await expect(shareWorkbook({ fileName: '订单统计.xlsx', sheets: [{ name: '订单明细', rows: [] }], title: '订单统计' })).rejects.toThrow('当前没有可导出的数据');
    expect(mockFile).not.toHaveBeenCalled();
  });
});
