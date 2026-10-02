import { getPurchaseOrders, listSwimShipments } from '../server-db.js';
import { buildOperationalExceptions } from '../src/domain/exceptions.js';
import { buildReplenishmentForecast } from './replenishment-service.js';

export async function buildOperationsInbox(warehouseId: string, now = new Date()) {
  const [shipments, purchaseOrders, replenishment] = await Promise.all([
    listSwimShipments(warehouseId, 500),
    getPurchaseOrders(warehouseId),
    buildReplenishmentForecast(warehouseId, now),
  ]);

  const items = buildOperationalExceptions({
    shipments,
    forecasts: replenishment.forecasts,
    purchaseOrders,
    now,
  });

  return {
    generatedAt: now.toISOString(),
    counts: {
      critical: items.filter((item) => item.severity === 'CRITICAL').length,
      warning: items.filter((item) => item.severity === 'WARNING').length,
      info: items.filter((item) => item.severity === 'INFO').length,
      total: items.length,
    },
    items,
  };
}
