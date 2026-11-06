const messages = {
  settings: 'Configure PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE in .env.local.',
  client_missing: 'PostgreSQL client is missing. Install psql and make it available on the server PATH.',
  unavailable: 'Airflow warehouse is unreachable. Start Docker and the local Airflow stack, then retry the quest.',
  authentication: 'Airflow warehouse authentication failed. Check the PostgreSQL credentials in .env.local.',
  timeout: 'Airflow warehouse connection timed out. Check that the local PostgreSQL service is healthy.',
  no_run: 'No completed warehouse run found. Complete the tennis DAG before starting a quest.',
  query: 'Airflow warehouse query failed. Check database settings and complete the tennis DAG first.',
};

export function warehouseErrorMessage(code) {
  return Object.hasOwn(messages, code) ? messages[code] : messages.query;
}

export function classifyWarehouseFailure(error, stderr = '') {
  if (error?.code === 'ENOENT') return 'client_missing';
  if (error?.code === 'ETIMEDOUT' || /timeout expired|connection timed out/i.test(stderr)) return 'timeout';
  if (/connection refused|could not connect to server|no such file or directory/i.test(stderr)) return 'unavailable';
  if (/password authentication failed|no password supplied|pg_hba.conf/i.test(stderr)) return 'authentication';
  return 'query';
}
