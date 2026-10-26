export type WarehouseCounts = {
  runId: string;
  extractedRows: number;
  matchesLoaded: number;
  totalWins: number;
  otherRunRows: number;
};

export function parseWarehouseCounts(value: unknown, runId?: string): WarehouseCounts {
  const data = value as WarehouseCounts | null;
  if (!data || typeof data.runId !== 'string' || !/^[a-zA-Z0-9_.:+-]{1,250}$/.test(data.runId) ||
      (runId && data.runId !== runId) ||
      ![data.extractedRows, data.matchesLoaded, data.totalWins, data.otherRunRows].every(number => Number.isSafeInteger(number) && number >= 0)) {
    throw new Error('Warehouse returned invalid counts or a different Airflow run.');
  }
  return data;
}

export function warehousePasses(data: WarehouseCounts, expectedRows: number): boolean {
  return expectedRows > 0 && data.extractedRows === expectedRows && data.matchesLoaded === expectedRows &&
    data.totalWins === data.matchesLoaded && data.otherRunRows === 0;
}
