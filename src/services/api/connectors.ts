import { apiRequest } from './client';

export type ConnectorRecordTable = {
  columns: { field: string; label: string }[];
  rows: Record<string, string | number | null>[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  message?: string;
};

export function getConnectorSyncRunRecords(runId: string, page = 1, pageSize = 20) {
  return apiRequest<ConnectorRecordTable>(
    `/api/v1/connectors/sync-runs/${encodeURIComponent(runId)}/records?page=${page}&page_size=${pageSize}`,
  );
}
