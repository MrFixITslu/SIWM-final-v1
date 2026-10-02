import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, newId, requirePermission } from './security.js';
import {
  addSwimTrackingCheckpoint,
  appendSwimBusinessEvent,
  createSwimShipment,
  consolidateSwimShipments,
  getItems,
  getPurchaseOrders,
  getSuppliers,
  getSwimCustomsRules,
  getSwimOutboundDemandSummary,
  getSwimShipment,
  getSwimReplenishmentPolicy,
  listSwimChildShipments,
  listSwimBusinessEvents,
  listSwimLogisticsUnits,
  listSwimShipments,
  listSwimTrackingCheckpoints,
  listSwimShipmentLegs,
  listSwimReplenishmentPolicies,
  saveSwimCustomsEstimate,
  saveSwimLogisticsUnit,
  saveSwimShipmentLeg,
  upsertSwimReplenishmentPolicy,
  verifySwimBusinessEventLedger,
} from '../server-db.js';
import { calculateCustomsEstimate } from '../src/domain/customs.js';
import { canContain, type LogisticsUnitType } from '../src/domain/shipping.js';
import { detectCarrier, summarizeTracking } from '../src/domain/tracking.js';
import { forecastReplenishment } from '../src/domain/replenishment.js';

const shipmentStatus = z.enum(['PLANNED','BOOKED','IN_TRANSIT','CUSTOMS','RECEIVED','DELIVERED','EXCEPTION','CANCELLED']);
const shipmentMode = z.enum(['PARCEL','AIR','OCEAN','GROUND','COURIER','INTER_ISLAND']);
const trackingStatus = z.enum(['LABEL_CREATED','PICKED_UP','IN_TRANSIT','AT_FORWARDER','CUSTOMS','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURNED','UNKNOWN']);
const logisticsUnitType = z.enum(['ITEM','CARTON','PACKAGE','PALLET','CONTAINER']);
const isoDateTime = z.string().datetime({ offset: true });

const createShipmentSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  mode: shipmentMode,
  status: shipmentStatus.default('PLANNED'),
  carrier: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(220).optional(),
  trackingProvider: z.string().trim().max(80).optional(),
  purchaseOrderId: z.string().trim().max(80).optional(),
  supplierId: z.string().trim().max(80).optional(),
  customerOrderReference: z.string().trim().max(120).optional(),
  origin: z.string().trim().max(500).optional(),
  destination: z.string().trim().max(500).optional(),
  estimatedArrivalAt: isoDateTime.optional(),
});

const trackingCheckpointSchema = z.object({
  carrierEventId: z.string().trim().max(180).optional(),
  status: trackingStatus,
  description: z.string().trim().min(1).max(1000),
  location: z.string().trim().max(500).optional(),
  occurredAt: isoDateTime,
  estimatedDeliveryAt: isoDateTime.optional(),
  source: z.string().trim().min(1).max(80),
});

const logisticsUnitSchema = z.object({
  shipmentId: z.string().min(1).max(100),
  parentUnitId: z.string().max(100).optional(),
  type: logisticsUnitType,
  reference: z.string().trim().max(180).optional(),
  quantity: z.number().int().positive().max(10_000_000).optional(),
  weightGrams: z.number().int().nonnegative().max(10_000_000_000).optional(),
});

const shipmentLegSchema = z.object({
  sequence: z.number().int().positive().max(1000),
  mode: shipmentMode,
  carrier: z.string().trim().max(100).optional(),
  service: z.string().trim().max(120).optional(),
  origin: z.string().trim().min(1).max(500),
  destination: z.string().trim().min(1).max(500),
  trackingNumber: z.string().trim().max(220).optional(),
  plannedDepartureAt: isoDateTime.optional(),
  plannedArrivalAt: isoDateTime.optional(),
  actualDepartureAt: isoDateTime.optional(),
  actualArrivalAt: isoDateTime.optional(),
}).strict();

const consolidationSchema = z.object({
  childShipmentIds: z.array(z.string().trim().min(1).max(80)).min(1).max(500),
}).strict();

const leadTimeDays = z.number().int().min(0).max(3650);

const replenishmentPolicySchema = z.object({
  supplierId: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  supplierProcessingDays: leadTimeDays,
  originTransportDays: leadTimeDays,
  forwarderHandlingDays: leadTimeDays,
  internationalTransitDays: leadTimeDays,
  customsClearanceDays: leadTimeDays,
  localDeliveryDays: leadTimeDays,
  safetyStockDays: leadTimeDays,
  targetCoverageDays: leadTimeDays,
  demandWindowDays: z.number().int().min(1).max(3650).default(90),
}).strict();

const customsEstimateSchema = z.object({
  shipmentId: z.string().max(100).optional(),
  save: z.boolean().default(true),
  destinationCountry: z.string().trim().min(2).max(3).transform((value) => value.toUpperCase()),
  originCountry: z.string().trim().min(2).max(3).transform((value) => value.toUpperCase()).optional(),
  hsCode: z.string().trim().min(2).max(24),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  goodsValueMinor: z.number().int().nonnegative().safe(),
  freightMinor: z.number().int().nonnegative().safe(),
  insuranceMinor: z.number().int().nonnegative().safe(),
  brokerageMinor: z.number().int().nonnegative().safe().optional(),
  portFeesMinor: z.number().int().nonnegative().safe().optional(),
  localDeliveryMinor: z.number().int().nonnegative().safe().optional(),
  concessionCodes: z.array(z.string().trim().max(100)).max(20).optional(),
  valuationDate: z.string().date(),
});

function invalid(res: any, error: z.ZodError) {
  res.status(400).json({
    error: 'Invalid request.',
    fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

export function createSwimRouter() {
  const router = Router();
  router.use(authenticateToken);

  router.get('/shipments', requirePermission('shipments.read'), async (req: any, res) => {
    try {
      const limit = Math.min(Number(req.query.limit || 100), 500);
      res.json({ shipments: await listSwimShipments(req.user.warehouseId, limit) });
    } catch (error) {
      console.error('SWIM shipment list error:', error);
      res.status(500).json({ error: 'Unable to retrieve shipments.' });
    }
  });

  router.post('/shipments', requirePermission('shipments.write'), async (req: any, res) => {
    const parsed = createShipmentSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const input = parsed.data;
      const detections = input.trackingNumber ? detectCarrier(input.trackingNumber) : [];
      const highConfidenceCarrier = detections.find((result) => result.confidence === 'HIGH' && result.carrier !== 'UNKNOWN');
      const shipment = await createSwimShipment(req.user.warehouseId, {
        id: newId('ship'),
        ...input,
        carrier: input.carrier || highConfidenceCarrier?.carrier,
      });
      await appendSwimBusinessEvent({
        eventId: newId('evt'), warehouseId: req.user.warehouseId,
        eventType: input.trackingNumber ? 'TRACKING_NUMBER_ADDED' : 'SUPPLIER_DISPATCHED',
        aggregateType: 'shipment', aggregateId: shipment.id, actorId: req.user.id,
        occurredAt: new Date().toISOString(),
        payload: { reference: shipment.reference, carrier: shipment.carrier || null, trackingNumber: shipment.trackingNumber || null },
      });
      res.status(201).json({ shipment, carrierDetection: detections });
    } catch (error: any) {
      console.error('SWIM shipment create error:', error);
      res.status(400).json({ error: error?.message || 'Unable to create shipment.' });
    }
  });

  router.get('/shipments/:id', requirePermission('shipments.read'), async (req: any, res) => {
    try {
      const shipment = await getSwimShipment(req.user.warehouseId, req.params.id);
      if (!shipment) { res.status(404).json({ error: 'Shipment not found.' }); return; }
      const [tracking, units, legs, childShipments] = await Promise.all([
        listSwimTrackingCheckpoints(req.user.warehouseId, shipment.id),
        listSwimLogisticsUnits(req.user.warehouseId, shipment.id),
        listSwimShipmentLegs(req.user.warehouseId, shipment.id),
        listSwimChildShipments(req.user.warehouseId, shipment.id),
      ]);
      res.json({
        shipment,
        tracking,
        trackingSummary: summarizeTracking(tracking),
        logisticsUnits: units,
        legs,
        childShipments,
      });
    } catch (error) {
      console.error('SWIM shipment detail error:', error);
      res.status(500).json({ error: 'Unable to retrieve shipment details.' });
    }
  });

  router.get('/shipments/:id/legs', requirePermission('shipments.read'), async (req: any, res) => {
    try {
      res.json({ legs: await listSwimShipmentLegs(req.user.warehouseId, req.params.id) });
    } catch (error: any) {
      res.status(404).json({ error: error?.message || 'Shipment not found.' });
    }
  });

  router.post('/shipments/:id/legs', requirePermission('shipments.write'), async (req: any, res) => {
    const parsed = shipmentLegSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const leg = await saveSwimShipmentLeg(req.user.warehouseId, req.params.id, {
        id: newId('leg'),
        ...parsed.data,
      });
      res.status(201).json({ leg });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Unable to add shipment leg.' });
    }
  });

  router.post('/shipments/:id/consolidate', requirePermission('shipments.write'), async (req: any, res) => {
    const parsed = consolidationSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const result = await consolidateSwimShipments(
        req.user.warehouseId,
        req.params.id,
        parsed.data.childShipmentIds,
      );
      await appendSwimBusinessEvent({
        eventId: newId('evt'),
        warehouseId: req.user.warehouseId,
        eventType: 'SHIPMENT_CONSOLIDATED',
        aggregateType: 'shipment',
        aggregateId: req.params.id,
        actorId: req.user.id,
        occurredAt: new Date().toISOString(),
        payload: { childShipmentIds: result.children.map((child) => child.id) },
      });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Unable to consolidate shipments.' });
    }
  });

  router.post('/shipments/:id/tracking-events', requirePermission('tracking.write'), async (req: any, res) => {
    const parsed = trackingCheckpointSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const checkpoint = { ...parsed.data, id: newId('track') };
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
      await addSwimTrackingCheckpoint(req.user.warehouseId, req.params.id, { ...checkpoint, payloadHash });
      await appendSwimBusinessEvent({
        eventId: newId('evt'), warehouseId: req.user.warehouseId,
        eventType: checkpoint.status === 'EXCEPTION' ? 'SHIPMENT_DELAYED' : 'SHIPMENT_CHECKPOINT_RECORDED',
        aggregateType: 'shipment', aggregateId: req.params.id, actorId: req.user.id,
        occurredAt: checkpoint.occurredAt,
        payload: { status: checkpoint.status, location: checkpoint.location || null, source: checkpoint.source, carrierEventId: checkpoint.carrierEventId || null },
      });
      const tracking = await listSwimTrackingCheckpoints(req.user.warehouseId, req.params.id);
      res.status(201).json({ checkpoint, trackingSummary: summarizeTracking(tracking) });
    } catch (error: any) {
      console.error('SWIM tracking event error:', error);
      res.status(400).json({ error: error?.message || 'Unable to record tracking checkpoint.' });
    }
  });

  router.get('/shipments/:id/tracking-events', requirePermission('tracking.read'), async (req: any, res) => {
    try {
      const tracking = await listSwimTrackingCheckpoints(req.user.warehouseId, req.params.id);
      res.json({ tracking, summary: summarizeTracking(tracking) });
    } catch (error: any) {
      res.status(404).json({ error: error?.message || 'Shipment not found.' });
    }
  });

  router.post('/tracking/detect-carrier', requirePermission('tracking.read'), (req: any, res) => {
    const trackingNumber = typeof req.body?.trackingNumber === 'string' ? req.body.trackingNumber.trim() : '';
    if (!trackingNumber || trackingNumber.length > 220) { res.status(400).json({ error: 'A valid tracking number is required.' }); return; }
    res.json({ trackingNumber, candidates: detectCarrier(trackingNumber), note: 'Local detection is advisory; the configured tracking provider should make the final carrier determination when confidence is not high.' });
  });

  router.post('/logistics-units', requirePermission('shipments.write'), async (req: any, res) => {
    const parsed = logisticsUnitSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const input = parsed.data;
      if (input.parentUnitId) {
        const units = await listSwimLogisticsUnits(req.user.warehouseId, input.shipmentId);
        const parent = units.find((unit) => unit.id === input.parentUnitId);
        if (!parent) { res.status(400).json({ error: 'Parent logistics unit does not exist in this shipment.' }); return; }
        if (!canContain(parent.type as LogisticsUnitType, input.type as LogisticsUnitType)) {
          res.status(400).json({ error: `${parent.type} cannot contain ${input.type}.` }); return;
        }
      }
      const unit = await saveSwimLogisticsUnit(req.user.warehouseId, { id: newId('unit'), ...input });
      res.status(201).json({ unit });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Unable to create logistics unit.' });
    }
  });

  router.get('/replenishment/policies', requirePermission('replenishment.read'), async (req: any, res) => {
    try {
      res.json({ policies: await listSwimReplenishmentPolicies(req.user.warehouseId) });
    } catch (error) {
      res.status(500).json({ error: 'Unable to retrieve replenishment policies.' });
    }
  });

  router.post('/replenishment/policies', requirePermission('replenishment.manage'), async (req: any, res) => {
    const parsed = replenishmentPolicySchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try {
      const input = parsed.data;
      if (input.supplierId) {
        const suppliers = await getSuppliers(req.user.warehouseId);
        if (!suppliers.some((supplier: any) => supplier.id === input.supplierId)) {
          res.status(400).json({ error: 'Supplier does not exist in this workspace.' });
          return;
        }
      }
      const policy = await upsertSwimReplenishmentPolicy({
        id: newId('policy'),
        warehouseId: req.user.warehouseId,
        supplierId: input.supplierId,
        name: input.name,
        demandWindowDays: input.demandWindowDays,
        actorId: req.user.id,
        policy: {
          supplierProcessingDays: input.supplierProcessingDays,
          originTransportDays: input.originTransportDays,
          forwarderHandlingDays: input.forwarderHandlingDays,
          internationalTransitDays: input.internationalTransitDays,
          customsClearanceDays: input.customsClearanceDays,
          localDeliveryDays: input.localDeliveryDays,
          safetyStockDays: input.safetyStockDays,
          targetCoverageDays: input.targetCoverageDays,
        },
      });
      await appendSwimBusinessEvent({
        eventId: newId('evt'),
        warehouseId: req.user.warehouseId,
        eventType: 'REPLENISHMENT_POLICY_CHANGED',
        aggregateType: 'inventory',
        aggregateId: policy.id,
        actorId: req.user.id,
        occurredAt: new Date().toISOString(),
        payload: {
          scopeKey: policy.scopeKey,
          supplierId: policy.supplierId || null,
          demandWindowDays: policy.demandWindowDays,
          totalLeadTimeDays:
            policy.supplierProcessingDays +
            policy.originTransportDays +
            policy.forwarderHandlingDays +
            policy.internationalTransitDays +
            policy.customsClearanceDays +
            policy.localDeliveryDays,
        },
      });
      res.status(201).json({ policy });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Unable to save replenishment policy.' });
    }
  });

  router.get('/replenishment/forecast', requirePermission('replenishment.read'), async (req: any, res) => {
    try {
      const [items, purchaseOrders, policies] = await Promise.all([
        getItems(req.user.warehouseId),
        getPurchaseOrders(req.user.warehouseId),
        listSwimReplenishmentPolicies(req.user.warehouseId),
      ]);

      const now = new Date();
      const windows = [...new Set(policies.map((policy) => policy.demandWindowDays))];
      const demandByWindow = new Map<number, Record<string, number>>();
      await Promise.all(windows.map(async (windowDays) => {
        const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
        demandByWindow.set(
          windowDays,
          await getSwimOutboundDemandSummary(req.user.warehouseId, since),
        );
      }));

      const defaultPolicy = policies.find((policy) => !policy.supplierId);
      const policyBySupplier = new Map(
        policies.filter((policy) => policy.supplierId).map((policy) => [policy.supplierId as string, policy]),
      );

      const inboundByItemId = new Map<string, number>();
      const inboundBySku = new Map<string, number>();
      const openStatuses = new Set(['ORDERED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED']);
      for (const po of purchaseOrders) {
        if (!openStatuses.has(po.status)) continue;
        for (const line of po.items || []) {
          const remaining = Math.max(0, Number(line.quantity || 0) - Number(line.quantityReceived || 0));
          if (!remaining) continue;
          if (line.itemId) inboundByItemId.set(line.itemId, (inboundByItemId.get(line.itemId) || 0) + remaining);
          if (line.sku) {
            const key = String(line.sku).trim().toUpperCase();
            inboundBySku.set(key, (inboundBySku.get(key) || 0) + remaining);
          }
        }
      }

      const riskOrder: Record<string, number> = {
        CRITICAL: 0,
        AT_RISK: 1,
        WATCH: 2,
        HEALTHY: 3,
        NO_DEMAND: 4,
        UNCONFIGURED: 5,
      };

      const forecasts = items.map((item: any) => {
        const policy = (item.supplierId && policyBySupplier.get(item.supplierId)) || defaultPolicy;
        const inbound = inboundByItemId.get(item.id) || inboundBySku.get(String(item.sku || '').toUpperCase()) || 0;
        if (!policy) {
          return {
            itemId: item.id,
            sku: item.sku,
            name: item.name,
            supplierId: item.supplierId || null,
            onHand: item.quantity,
            inboundConfirmed: inbound,
            policyConfigured: false,
            risk: 'UNCONFIGURED',
          };
        }
        const demandTotal = demandByWindow.get(policy.demandWindowDays)?.[item.id] || 0;
        const averageDailyDemand = demandTotal / policy.demandWindowDays;
        const forecast = forecastReplenishment({
          onHand: Number(item.quantity || 0),
          inboundConfirmed: inbound,
          averageDailyDemand,
          policy,
          asOf: now.toISOString(),
        });
        return {
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          supplierId: item.supplierId || null,
          onHand: item.quantity,
          policyConfigured: true,
          policy: {
            id: policy.id,
            name: policy.name,
            scopeKey: policy.scopeKey,
            demandWindowDays: policy.demandWindowDays,
          },
          ...forecast,
        };
      }).sort((a: any, b: any) =>
        (riskOrder[a.risk] ?? 99) - (riskOrder[b.risk] ?? 99) ||
        (a.stockoutInDays ?? Number.POSITIVE_INFINITY) - (b.stockoutInDays ?? Number.POSITIVE_INFINITY)
      );

      res.json({
        generatedAt: now.toISOString(),
        forecasts,
        notes: [
          'Demand uses actual OUTBOUND stock movements within each configured policy window.',
          'Confirmed inbound includes remaining quantities on ORDERED, IN_TRANSIT and PARTIALLY_RECEIVED purchase orders.',
          'Customer-order allocations are not subtracted until SWIM order allocation is enabled.',
        ],
      });
    } catch (error) {
      console.error('SWIM replenishment forecast error:', error);
      res.status(500).json({ error: 'Unable to calculate replenishment forecasts.' });
    }
  });

  router.post('/customs/estimate', requirePermission('customs.calculate'), async (req: any, res) => {
    const parsed = customsEstimateSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    const { shipmentId, save, ...input } = parsed.data;
    try {
      const rules = await getSwimCustomsRules(input.destinationCountry, input.valuationDate);
      const hsDigits = input.hsCode.replace(/\D/g, '');
      const matchingRules = rules.filter((rule) => hsDigits.startsWith(rule.hsCodePrefix.replace(/\D/g, '')));
      if (!matchingRules.length) {
        res.status(422).json({
          error: 'No verified customs rule set is available for this destination/HS code/date.',
          code: 'CUSTOMS_RULES_UNAVAILABLE',
          guidance: 'Do not treat a zero-duty result as valid. A platform administrator must load and verify the official customs rules first.',
        });
        return;
      }
      const estimate = calculateCustomsEstimate(input, matchingRules);
      const estimateId = newId('customs');
      if (save) await saveSwimCustomsEstimate(estimateId, req.user.warehouseId, shipmentId, input, estimate, req.user.id);
      await appendSwimBusinessEvent({
        eventId: newId('evt'), warehouseId: req.user.warehouseId,
        eventType: 'CUSTOMS_STATUS_CHANGED', aggregateType: 'customs', aggregateId: estimateId,
        actorId: req.user.id, occurredAt: new Date().toISOString(),
        payload: { shipmentId: shipmentId || null, destinationCountry: input.destinationCountry, hsCode: input.hsCode, estimatedLandedCostMinor: estimate.estimatedLandedCostMinor },
      });
      res.json({
        estimateId: save ? estimateId : undefined,
        estimate,
        disclaimer: 'SWIM provides an estimate based on the verified rules loaded for the selected date. The customs authority assessment and final HS classification take precedence.',
      });
    } catch (error: any) {
      console.error('SWIM customs estimate error:', error);
      res.status(400).json({ error: error?.message || 'Unable to calculate customs estimate.' });
    }
  });

  router.get('/events', requirePermission('audit.read'), async (req: any, res) => {
    try {
      const events = await listSwimBusinessEvents(req.user.warehouseId, Number(req.query.limit || 100));
      res.json({ events });
    } catch (error) {
      res.status(500).json({ error: 'Unable to retrieve the operational event ledger.' });
    }
  });

  router.get('/events/verify', requirePermission('audit.read'), async (req: any, res) => {
    try {
      res.json(await verifySwimBusinessEventLedger(req.user.warehouseId));
    } catch (error) {
      res.status(500).json({ error: 'Unable to verify the operational event ledger.' });
    }
  });

  return router;
}