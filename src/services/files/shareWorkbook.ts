import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

const EXPORT_DIRECTORY = 'chart-exports';

export type WorkbookSheet = {
  name: string;
  rows: Array<Record<string, string | number>>;
};

export async function shareWorkbook(input: {
  fileName: string;
  sheets: WorkbookSheet[];
  title: string;
}): Promise<void> {
  if (!input.sheets.some((sheet) => sheet.rows.length)) throw new Error('当前没有可导出的数据');
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备不支持系统分享');

  const workbook = XLSX.utils.book_new();
  for (const sheet of input.sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet.rows), sheet.name);
  }
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, input.fileName);

  try {
    file.create({ intermediates: true, overwrite: true });
    file.write(new Uint8Array(bytes));
    await Sharing.shareAsync(file.uri, {
      dialogTitle: `分享${input.title}`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } finally {
    try { if (file.exists) file.delete(); } catch {}
  }
}
