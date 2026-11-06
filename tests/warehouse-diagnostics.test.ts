import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWarehouseFailure, warehouseErrorMessage } from '../lib/warehouse-diagnostics.mjs';

test('warehouse diagnostics distinguish unavailable services, missing clients, auth and timeouts', () => {
  assert.equal(classifyWarehouseFailure({ code: 'ENOENT' }), 'client_missing');
  assert.equal(classifyWarehouseFailure(null, 'psql: connection to server failed: Connection refused'), 'unavailable');
  assert.equal(classifyWarehouseFailure(null, 'FATAL: password authentication failed for user secret'), 'authentication');
  assert.equal(classifyWarehouseFailure({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(classifyWarehouseFailure(null, 'relation warehouse.run_metadata does not exist'), 'query');
  assert.match(warehouseErrorMessage('unavailable'), /Start Docker/);
  assert.match(warehouseErrorMessage('no_run'), /Complete the tennis DAG/);
  assert.equal(warehouseErrorMessage('private infrastructure error'), warehouseErrorMessage('query'));
  assert.equal(warehouseErrorMessage('__proto__'), warehouseErrorMessage('query'));
});
