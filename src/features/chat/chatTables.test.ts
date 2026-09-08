import { tableFromMessage, parseMarkdownTables, tablePartToMarkdownTable } from './chatTables';
import { structuredMessage } from '@/test/agentResponseFixture';

describe('parseMarkdownTables', () => {
  it('formats integer table cells with the same safe units and grouping as web', () => {
    const table = tablePartToMarkdownTable({
      kind: 'table',
      title: '整数单位',
      columns: [
        { key: 'orders', label: '订单数', data_type: 'integer', unit: 'order' },
        { key: 'stores', label: '门店数', data_type: 'integer', unit: 'store' },
        { key: 'items', label: '件数', data_type: 'integer', unit: 'item' },
        { key: 'people', label: '人数', data_type: 'integer', unit: 'person' },
      ],
      preview_rows: [{ orders: '12345', stores: 12, items: '1234', people: 1200 }],
    });

    expect(table.rows[0]).toEqual(['12,345单', '12家', '1,234件', '1,200人']);
  });

  it('formats supported units and comparison states without leaking unknown codes', () => {
    const diagnostic = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const table = tablePartToMarkdownTable({
      kind: 'table',
      columns: [
        { key: 'legacy_cny', label: '旧金额', unit: 'CNY' },
        { key: 'cny', label: '金额', unit: 'cny' },
        { key: 'legacy_hour', label: '旧人效', unit: 'CNY/hour' },
        { key: 'hour_rate', label: '人效', unit: 'cny_per_hour' },
        { key: 'localized_hour', label: '本地人效', unit: '元/工时' },
        { key: 'ratio', label: '占比', unit: 'ratio' },
        { key: 'period', label: '周期', unit: 'period' },
        { key: 'product', label: '产品', unit: 'product' },
        { key: 'item', label: '件数', unit: 'item' },
        { key: 'person', label: '人数', unit: 'person' },
        { key: 'comparison_status', label: '可比状态' },
        { key: 'unknown', label: '未知单位', unit: 'secret_internal_unit' },
        { key: 'missing', label: '空值' },
      ],
      preview_rows: [
        { legacy_cny: '-12345.67', cny: '12345.67', legacy_hour: '82.46', hour_rate: '82.46', localized_hour: '82.46', ratio: '0.092', period: '3', product: '10', item: '1234', person: '12', comparison_status: 'comparable', unknown: '7', missing: null },
        { comparison_status: 'not_comparable' },
        { comparison_status: 'secret_internal_state' },
      ],
    });

    expect(table.rows[0]).toEqual(['¥-12,345.67', '¥12,345.67', '¥82.46/工时', '¥82.46/工时', '82.46元/工时', '9.2%', '3期', '10种', '1,234件', '12人', '可比', '7', '—']);
    expect(table.rows[1][10]).toBe('不可比');
    expect(table.rows[2][10]).toBe('未知');
    expect(JSON.stringify(table.rows)).not.toContain('secret_internal');
    expect(diagnostic).toHaveBeenCalled();
    expect(diagnostic.mock.calls.flat().join(' ')).not.toContain('secret_internal');
  });

  it('prefers a validated structured table and formats its cells for the detail route', () => {
    const message = structuredMessage();

    expect(tableFromMessage(message, 0)).toMatchObject({ columns: ['门店', '实际人效'] });
    expect(tableFromMessage(message, 0)?.rows).toEqual([['门店1', '80'], ['门店2', '81'], ['门店3', '82'], ['门店4', '83'], ['门店5', '84'], ['门店6', '85'], ['门店7', '86'], ['门店8', '87']]);
  });

  it('falls back to Markdown tables for legacy messages', () => {
    expect(tableFromMessage({
      id: 'legacy',
      role: 'assistant',
      content: '| 名称 | 数值 |\n| --- | ---: |\n| 门店1 | 80 |',
      created_at: '2026-08-21T10:00:00+08:00',
    }, 0)).toMatchObject({ columns: ['名称', '数值'], rows: [['门店1', '80']] });
  });

  it('extracts every table and leaves only narrative text', () => {
    const result = parseMarkdownTables([
      '经营概览',
      '',
      '#### 门店表现',
      '| 门店 | 净实收 |',
      '| --- | ---: |',
      '| 茅坡店 | 1200 |',
      '| 台北湾店 | 800 |',
      '',
      '#### 产品结构',
      '| 产品 | 销量 |',
      '| --- | ---: |',
      '| 肉夹馍 | 100 |',
      '| 凉皮 | 80 |',
      '',
      '建议关注客单价。',
    ].join('\n'));

    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].columns).toEqual(['门店', '净实收']);
    expect(result.tables[1].rows).toEqual([['肉夹馍', '100'], ['凉皮', '80']]);
    expect(result.text).toContain('经营概览');
    expect(result.text).toContain('建议关注客单价。');
    expect(result.text).not.toContain('|');
  });

  it('pads an incomplete body row without swallowing the next table', () => {
    const result = parseMarkdownTables([
      '| 门店 | 金额 |',
      '| --- | ---: |',
      '| 茅坡店 | 120 |',
      '| 被服务端截断的残行',
      '| 产品 | 销量 | 备注 |',
      '| --- | ---: | --- |',
      '| 肉夹馍 | 10 | 正常 |',
      '结果已截断。',
    ].join('\n'));

    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].rows).toEqual([['茅坡店', '120'], ['被服务端截断的残行', '']]);
    expect(result.tables[1].columns).toEqual(['产品', '销量', '备注']);
    expect(result.text).toBe('结果已截断。');
  });

  it('parses standard tables without outer pipes', () => {
    const result = parseMarkdownTables([
      '门店 | 净实收',
      '--- | ---:',
      '茅坡店 | 1200',
      '台北湾店 | 800',
    ].join('\n'));

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].columns).toEqual(['门店', '净实收']);
    expect(result.tables[0].rows).toEqual([['茅坡店', '1200'], ['台北湾店', '800']]);
  });

  it('keeps escaped pipes inside cells without dropping later rows', () => {
    const result = parseMarkdownTables([
      '| 套餐 | 渠道 |',
      '| --- | --- |',
      '| 套餐 A | 堂食 \\| 外卖 |',
      '| 套餐 B | 堂食 |',
    ].join('\n'));

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toEqual([['套餐 A', '堂食 | 外卖'], ['套餐 B', '堂食']]);
    expect(result.text).toBe('');
  });

  it('does not extract table examples from fenced code blocks', () => {
    const content = [
      '示例：',
      '```markdown',
      '| 字段 | 含义 |',
      '| --- | --- |',
      '| amount | 金额 |',
      '```',
    ].join('\n');
    const result = parseMarkdownTables(content);

    expect(result.tables).toHaveLength(0);
    expect(result.text).toBe(content);
  });

  it('preserves the original order of narrative and tables', () => {
    const result = parseMarkdownTables([
      '经营概览',
      '| 门店 | 金额 |',
      '| --- | ---: |',
      '| 茅坡店 | 120 |',
      '产品结构',
      '| 产品 | 销量 |',
      '| --- | ---: |',
      '| 肉夹馍 | 10 |',
      '建议关注客单价。',
    ].join('\n'));

    expect(result.blocks.map((block) => block.type)).toEqual(['text', 'table', 'text', 'table', 'text']);
    expect(result.blocks[0]).toEqual({ type: 'text', text: '经营概览' });
    expect(result.blocks[2]).toEqual({ type: 'text', text: '产品结构' });
    expect(result.blocks[4]).toEqual({ type: 'text', text: '建议关注客单价。' });
  });

  it('pads missing body cells and ignores extra body cells', () => {
    const result = parseMarkdownTables([
      '| 门店 | 金额 | 备注 |',
      '| --- | ---: | --- |',
      '| 茅坡店 | 120 |',
      '| 台北湾店 | 80 | 正常 | 忽略此列 |',
    ].join('\n'));

    expect(result.tables[0].rows).toEqual([
      ['茅坡店', '120', ''],
      ['台北湾店', '80', '正常'],
    ]);
    expect(result.text).toBe('');
  });

  it('parses a one-column table', () => {
    const result = parseMarkdownTables([
      '| 状态 |',
      '| --- |',
      '| 已完成 |',
      '| 已归档 |',
    ].join('\n'));

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toMatchObject({ columns: ['状态'], rows: [['已完成'], ['已归档']] });
  });

  it('does not close a fenced block when the marker has trailing text', () => {
    const content = [
      '```markdown',
      '```not-a-close',
      '| 字段 | 含义 |',
      '| --- | --- |',
      '| amount | 金额 |',
      '```',
    ].join('\n');
    const result = parseMarkdownTables(content);

    expect(result.tables).toHaveLength(0);
    expect(result.text).toBe(content);
  });
});
