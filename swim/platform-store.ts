import { swimDbQuery } from '../server-db.js';
import {
  AutomationApproval,
  CustomsRule,
  ShipmentRecord,
  SwimEvent,
  SwimEventInput,
  TrackingCheckpoint,
  TrackingProviderRegistration
} from './domain.js';
import { newSwimId, requireSafeId } from './security.js';

export async function initSwimPlatformStore(): Promise<void> {
  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_events (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL,
      organization_id VARCHAR(80),
      event_type VARCHAR(120) NOT NULL,
      category VARCHAR(40) NOT NULL,
      aggregate_type VARCHAR(80) NOT NULL,
      aggregate_id VARCHAR(160) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
      actor_id VARCHAR(80),
      actor_name VARCHAR(200),
      source VARCHAR(120) NOT NULL DEFAULT 'SWIM',
      dedupe_key VARCHAR(240),
      correlation_id VARCHAR(80),
      causation_id VARCHAR(80),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sequence BIGSERIAL NOT NULL
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_events_tenant_time ON swim_events(warehouse_id, recorded_at DESC)`);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_events_aggregate ON swim_events(warehouse_id, aggregate_type, aggregate_id, sequence)`);
  await swimDbQuery(`CREATE UNIQUE INDEX IF NOT EXISTS idx_swim_events_dedupe ON swim_events(source, dedupe_key) WHERE dedupe_key IS NOT NULL`);

  await swimDbQuery(`
    CREATE OR REPLACE FUNCTION prevent_swim_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'swim_events is append-only';
    END;
    $$ LANGUAGE plpgsql
  `);
  await swimDbQuery(`DROP TRIGGER IF EXISTS swim_events_immutable ON swim_events`);
  await swimDbQuery(`
    CREATE TRIGGER swim_events_immutable
    BEFORE UPDATE OR DELETE ON swim_events
    FOR EACH ROW EXECUTE FUNCTION prevent_swim_event_mutation()
  `);

  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_shipments (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      organization_id VARCHAR(80),
      reference VARCHAR(120) NOT NULL,
      direction VARCHAR(30) NOT NULL,
      mode VARCHAR(30) NOT NULL,
      status VARCHAR(40) NOT NULL,
      origin_country VARCHAR(2),
      origin_location TEXT,
      destination_country VARCHAR(2),
      destination_location TEXT,
      supplier_id VARCHAR(80),
      purchase_order_id VARCHAR(80),
      customer_reference VARCHAR(160),
      freight_forwarder VARCHAR(200),
      master_tracking_number VARCHAR(120),
      carrier_code VARCHAR(40),
      estimated_arrival TIMESTAMPTZ,
      actual_arrival TIMESTAMPTZ,
      currency VARCHAR(3),
      goods_value NUMERIC(16,2),
      freight_cost NUMERIC(16,2),
      insurance_cost NUMERIC(16,2),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(warehouse_id, reference),
      UNIQUE(warehouse_id, id)
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_shipments_tenant_status ON swim_shipments(warehouse_id, status, updated_at DESC)`);

  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_tracking_checkpoints (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      shipment_id VARCHAR(80) NOT NULL,
      FOREIGN KEY (warehouse_id, shipment_id)
        REFERENCES swim_shipments(warehouse_id, id) ON DELETE CASCADE,
      tracking_number VARCHAR(120) NOT NULL,
      carrier_code VARCHAR(40) NOT NULL,
      status VARCHAR(40) NOT NULL,
      status_detail TEXT,
      location TEXT,
      country_code VARCHAR(2),
      event_time TIMESTAMPTZ NOT NULL,
      source VARCHAR(120) NOT NULL,
      raw_provider_status VARCHAR(160),
      provider_event_id VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(warehouse_id, carrier_code, tracking_number, provider_event_id)
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_tracking_shipment_time ON swim_tracking_checkpoints(warehouse_id, shipment_id, event_time DESC)`);

  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_tracking_registrations (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      shipment_id VARCHAR(80) NOT NULL,
      provider_code VARCHAR(40) NOT NULL,
      FOREIGN KEY (warehouse_id, shipment_id)
        REFERENCES swim_shipments(warehouse_id, id) ON DELETE CASCADE,
      provider_tracking_id VARCHAR(160) NOT NULL,
      tracking_number VARCHAR(120) NOT NULL,
      carrier_code VARCHAR(40),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_code, provider_tracking_id),
      UNIQUE(warehouse_id, shipment_id, provider_code, tracking_number)
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_tracking_registration_shipment ON swim_tracking_registrations(warehouse_id, shipment_id)`);

  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_customs_rules (
      id VARCHAR(100) PRIMARY KEY,
      jurisdiction_code VARCHAR(8) NOT NULL,
      hs_code_prefix VARCHAR(16) NOT NULL,
      description TEXT,
      import_duty_rate NUMERIC(10,6),
      vat_rate NUMERIC(10,6),
      customs_service_rate NUMERIC(10,6),
      excise_rate NUMERIC(10,6),
      environmental_levy_rate NUMERIC(10,6),
      other_rate NUMERIC(10,6),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      official_source_url TEXT NOT NULL,
      source_title TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL,
      version VARCHAR(80) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_customs_lookup ON swim_customs_rules(jurisdiction_code, hs_code_prefix, effective_from DESC)`);

  await swimDbQuery(`
    CREATE TABLE IF NOT EXISTS swim_approvals (
      id VARCHAR(80) PRIMARY KEY,
      warehouse_id VARCHAR(50) NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      action_type VARCHAR(120) NOT NULL,
      aggregate_type VARCHAR(80) NOT NULL,
      aggregate_id VARCHAR(160) NOT NULL,
      requested_by VARCHAR(80) NOT NULL,
      rationale TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at TIMESTAMPTZ,
      decided_by VARCHAR(80),
      expires_at TIMESTAMPTZ
    )
  `);
  await swimDbQuery(`CREATE INDEX IF NOT EXISTS idx_swim_approvals_tenant_status ON swim_approvals(warehouse_id, status, requested_at DESC)`);
}

export async function appendSwimEvent(input: SwimEventInput): Promise<SwimEvent> {
  const warehouseId = requireSafeId(input.warehouseId, 'warehouseId');
  const id = newSwimId('evt');
  const occurredAt = input.occurredAt || new Date().toISOString();
  const result = await swimDbQuery<any>(
    `INSERT INTO swim_events (
      id, warehouse_id, organization_id, event_type, category, aggregate_type,
      aggregate_id, severity, actor_id, actor_name, source, dedupe_key, correlation_id,
      causation_id, metadata, occurred_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16
    )
    ON CONFLICT (source, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO NOTHING
    RETURNING *, recorded_at AS "recordedAt", occurred_at AS "occurredAt"`,
    [
      id,
      warehouseId,
      input.organizationId || null,
      input.eventType,
      input.category,
      input.aggregateType,
      input.aggregateId,
      input.severity || 'INFO',
      input.actorId || null,
      input.actorName || null,
      input.source || 'SWIM',
      input.dedupeKey || null,
      input.correlationId || null,
      input.causationId || null,
      JSON.stringify(input.metadata || {}),
      occurredAt
    ]
  );
  if (result.rows.length === 0 && input.dedupeKey) {
    const existing = await swimDbQuery<any>(
      `SELECT * FROM swim_events WHERE source = $1 AND dedupe_key = $2 LIMIT 1`,
      [input.source || 'SWIM', input.dedupeKey]
    );
    if (existing.rows[0]) return mapSwimEvent(existing.rows[0]);
  }
  const row = result.rows[0];
  return mapSwimEvent(row);
}

function mapSwimEvent(row: any): SwimEvent {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    organizationId: row.organization_id || undefined,
    eventType: row.event_type,
    category: row.category,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    severity: row.severity,
    actorId: row.actor_id || undefined,
    actorName: row.actor_name || undefined,
    source: row.source,
    dedupeKey: row.dedupe_key || undefined,
    correlationId: row.correlation_id || undefined,
    causationId: row.causation_id || undefined,
    metadata: row.metadata || {},
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    sequence: Number(row.sequence)
  };
}

export async function listSwimEvents(warehouseId: string, limit = 100): Promise<SwimEvent[]> {
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_events WHERE warehouse_id = $1 ORDER BY sequence DESC LIMIT $2`,
    [requireSafeId(warehouseId, 'warehouseId'), safeLimit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    warehouseId: row.warehouse_id,
    organizationId: row.organization_id || undefined,
    eventType: row.event_type,
    category: row.category,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    severity: row.severity,
    actorId: row.actor_id || undefined,
    actorName: row.actor_name || undefined,
    source: row.source,
    correlationId: row.correlation_id || undefined,
    causationId: row.causation_id || undefined,
    metadata: row.metadata || {},
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    sequence: Number(row.sequence)
  }));
}

export async function createShipment(shipment: ShipmentRecord): Promise<ShipmentRecord> {
  const result = await swimDbQuery<any>(
    `INSERT INTO swim_shipments (
      id, warehouse_id, organization_id, reference, direction, mode, status,
      origin_country, origin_location, destination_country, destination_location,
      supplier_id, purchase_order_id, customer_reference, freight_forwarder,
      master_tracking_number, carrier_code, estimated_arrival, actual_arrival,
      currency, goods_value, freight_cost, insurance_cost, notes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
    ) RETURNING *`,
    [
      shipment.id,
      shipment.warehouseId,
      shipment.organizationId || null,
      shipment.reference,
      shipment.direction,
      shipment.mode,
      shipment.status,
      shipment.originCountry || null,
      shipment.originLocation || null,
      shipment.destinationCountry || null,
      shipment.destinationLocation || null,
      shipment.supplierId || null,
      shipment.purchaseOrderId || null,
      shipment.customerReference || null,
      shipment.freightForwarder || null,
      shipment.masterTrackingNumber || null,
      shipment.carrierCode || null,
      shipment.estimatedArrival || null,
      shipment.actualArrival || null,
      shipment.currency || null,
      shipment.goodsValue ?? null,
      shipment.freightCost ?? null,
      shipment.insuranceCost ?? null,
      shipment.notes || null
    ]
  );
  return mapShipment(result.rows[0]);
}

export async function listShipments(warehouseId: string): Promise<ShipmentRecord[]> {
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_shipments WHERE warehouse_id = $1 ORDER BY updated_at DESC, created_at DESC`,
    [requireSafeId(warehouseId, 'warehouseId')]
  );
  return result.rows.map(mapShipment);
}

export async function getShipment(
  warehouseId: string,
  shipmentId: string
): Promise<ShipmentRecord | undefined> {
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_shipments WHERE warehouse_id = $1 AND id = $2 LIMIT 1`,
    [requireSafeId(warehouseId, 'warehouseId'), requireSafeId(shipmentId, 'shipmentId')]
  );
  return result.rows[0] ? mapShipment(result.rows[0]) : undefined;
}

export async function updateShipmentTrackingState(
  warehouseId: string,
  shipmentId: string,
  status: ShipmentRecord['status'],
  carrierCode?: string,
  masterTrackingNumber?: string,
  estimatedArrival?: string
): Promise<ShipmentRecord | undefined> {
  const result = await swimDbQuery<any>(
    `UPDATE swim_shipments
       SET status = $3,
           carrier_code = COALESCE($4, carrier_code),
           master_tracking_number = COALESCE($5, master_tracking_number),
           estimated_arrival = COALESCE($6::timestamptz, estimated_arrival),
           actual_arrival = CASE WHEN $3 = 'DELIVERED' THEN COALESCE(actual_arrival, CURRENT_TIMESTAMP) ELSE actual_arrival END,
           updated_at = CURRENT_TIMESTAMP
     WHERE warehouse_id = $1 AND id = $2
     RETURNING *`,
    [
      requireSafeId(warehouseId, 'warehouseId'),
      requireSafeId(shipmentId, 'shipmentId'),
      status,
      carrierCode || null,
      masterTrackingNumber || null,
      estimatedArrival || null
    ]
  );
  return result.rows[0] ? mapShipment(result.rows[0]) : undefined;
}

export async function addTrackingCheckpoint(checkpoint: TrackingCheckpoint): Promise<TrackingCheckpoint> {
  const result = await swimDbQuery<any>(
    `INSERT INTO swim_tracking_checkpoints (
      id, warehouse_id, shipment_id, tracking_number, carrier_code, status,
      status_detail, location, country_code, event_time, source,
      raw_provider_status, provider_event_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (warehouse_id, carrier_code, tracking_number, provider_event_id)
    DO NOTHING
    RETURNING *`,
    [
      checkpoint.id,
      checkpoint.warehouseId,
      checkpoint.shipmentId,
      checkpoint.trackingNumber,
      checkpoint.carrierCode,
      checkpoint.status,
      checkpoint.statusDetail || null,
      checkpoint.location || null,
      checkpoint.countryCode || null,
      checkpoint.eventTime,
      checkpoint.source,
      checkpoint.rawProviderStatus || null,
      checkpoint.providerEventId || null
    ]
  );
  return result.rows.length ? mapCheckpoint(result.rows[0]) : checkpoint;
}

export async function listTrackingCheckpoints(
  warehouseId: string,
  shipmentId: string
): Promise<TrackingCheckpoint[]> {
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_tracking_checkpoints
     WHERE warehouse_id = $1 AND shipment_id = $2
     ORDER BY event_time DESC`,
    [requireSafeId(warehouseId, 'warehouseId'), requireSafeId(shipmentId, 'shipmentId')]
  );
  return result.rows.map(mapCheckpoint);
}

export async function registerTrackingProvider(
  registration: Omit<TrackingProviderRegistration, 'createdAt'>
): Promise<TrackingProviderRegistration> {
  const result = await swimDbQuery<any>(
    `INSERT INTO swim_tracking_registrations (
      id, warehouse_id, shipment_id, provider_code, provider_tracking_id,
      tracking_number, carrier_code
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (provider_code, provider_tracking_id)
    DO UPDATE SET carrier_code = EXCLUDED.carrier_code
    RETURNING *`,
    [
      registration.id,
      requireSafeId(registration.warehouseId, 'warehouseId'),
      requireSafeId(registration.shipmentId, 'shipmentId'),
      registration.providerCode,
      registration.providerTrackingId,
      registration.trackingNumber,
      registration.carrierCode || null
    ]
  );
  return mapTrackingRegistration(result.rows[0]);
}

export async function getTrackingRegistration(
  warehouseId: string,
  shipmentId: string,
  providerCode?: string
): Promise<TrackingProviderRegistration | undefined> {
  const params: any[] = [
    requireSafeId(warehouseId, 'warehouseId'),
    requireSafeId(shipmentId, 'shipmentId')
  ];
  let sql = `SELECT * FROM swim_tracking_registrations
             WHERE warehouse_id = $1 AND shipment_id = $2`;
  if (providerCode) {
    params.push(providerCode.trim().toUpperCase());
    sql += ` AND provider_code = $3`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 1`;
  const result = await swimDbQuery<any>(sql, params);
  return result.rows[0] ? mapTrackingRegistration(result.rows[0]) : undefined;
}

export async function getTrackingRegistrationByProviderId(
  providerCode: string,
  providerTrackingId: string
): Promise<TrackingProviderRegistration | undefined> {
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_tracking_registrations
     WHERE provider_code = $1 AND provider_tracking_id = $2
     LIMIT 1`,
    [providerCode.trim().toUpperCase(), providerTrackingId]
  );
  return result.rows[0] ? mapTrackingRegistration(result.rows[0]) : undefined;
}

export async function upsertCustomsRules(
  rules: CustomsRule[]
): Promise<number> {
  let changed = 0;
  for (const rule of rules) {
    await swimDbQuery(
      `INSERT INTO swim_customs_rules (
        id, jurisdiction_code, hs_code_prefix, description,
        import_duty_rate, vat_rate, customs_service_rate, excise_rate,
        environmental_levy_rate, other_rate, effective_from, effective_to,
        official_source_url, source_title, verified_at, version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      ON CONFLICT (id) DO UPDATE SET
        jurisdiction_code = EXCLUDED.jurisdiction_code,
        hs_code_prefix = EXCLUDED.hs_code_prefix,
        description = EXCLUDED.description,
        import_duty_rate = EXCLUDED.import_duty_rate,
        vat_rate = EXCLUDED.vat_rate,
        customs_service_rate = EXCLUDED.customs_service_rate,
        excise_rate = EXCLUDED.excise_rate,
        environmental_levy_rate = EXCLUDED.environmental_levy_rate,
        other_rate = EXCLUDED.other_rate,
        effective_from = EXCLUDED.effective_from,
        effective_to = EXCLUDED.effective_to,
        official_source_url = EXCLUDED.official_source_url,
        source_title = EXCLUDED.source_title,
        verified_at = EXCLUDED.verified_at,
        version = EXCLUDED.version`,
      [
        rule.id,
        rule.jurisdictionCode.toUpperCase(),
        rule.hsCodePrefix,
        rule.description || null,
        rule.importDutyRate ?? null,
        rule.vatRate ?? null,
        rule.customsServiceRate ?? null,
        rule.exciseRate ?? null,
        rule.environmentalLevyRate ?? null,
        rule.otherRate ?? null,
        rule.effectiveFrom,
        rule.effectiveTo || null,
        rule.officialSourceUrl,
        rule.sourceTitle,
        rule.verifiedAt,
        rule.version
      ]
    );
    changed += 1;
  }
  return changed;
}

export async function getCustomsRuleCoverage(): Promise<Array<{
  jurisdictionCode: string;
  ruleCount: number;
  latestVerifiedAt?: string;
  versions: string[];
}>> {
  const result = await swimDbQuery<any>(
    `SELECT jurisdiction_code,
            COUNT(*)::int AS rule_count,
            MAX(verified_at) AS latest_verified_at,
            ARRAY_AGG(DISTINCT version ORDER BY version) AS versions
       FROM swim_customs_rules
      GROUP BY jurisdiction_code
      ORDER BY jurisdiction_code`
  );
  return result.rows.map((row) => ({
    jurisdictionCode: row.jurisdiction_code,
    ruleCount: Number(row.rule_count || 0),
    latestVerifiedAt: row.latest_verified_at || undefined,
    versions: row.versions || []
  }));
}

export async function listCustomsRules(
  jurisdictionCode: string
): Promise<CustomsRule[]> {
  const result = await swimDbQuery<any>(
    `SELECT * FROM swim_customs_rules
     WHERE jurisdiction_code = $1
     ORDER BY length(hs_code_prefix) DESC, effective_from DESC`,
    [String(jurisdictionCode || '').trim().toUpperCase()]
  );
  return result.rows.map((row) => ({
    id: row.id,
    jurisdictionCode: row.jurisdiction_code,
    hsCodePrefix: row.hs_code_prefix,
    description: row.description || undefined,
    importDutyRate: Number(row.import_duty_rate || 0),
    vatRate: Number(row.vat_rate || 0),
    customsServiceRate: Number(row.customs_service_rate || 0),
    exciseRate: Number(row.excise_rate || 0),
    environmentalLevyRate: Number(row.environmental_levy_rate || 0),
    otherRate: Number(row.other_rate || 0),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    officialSourceUrl: row.official_source_url,
    sourceTitle: row.source_title,
    verifiedAt: row.verified_at,
    version: row.version
  }));
}

export async function createApproval(
  approval: AutomationApproval
): Promise<AutomationApproval> {
  const result = await swimDbQuery<any>(
    `INSERT INTO swim_approvals (
      id, warehouse_id, action_type, aggregate_type, aggregate_id,
      requested_by, rationale, payload, status, requested_at,
      decided_at, decided_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
    RETURNING *`,
    [
      approval.id,
      approval.warehouseId,
      approval.actionType,
      approval.aggregateType,
      approval.aggregateId,
      approval.requestedBy,
      approval.rationale,
      JSON.stringify(approval.payload || {}),
      approval.status,
      approval.requestedAt,
      approval.decidedAt || null,
      approval.decidedBy || null
    ]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    actionType: row.action_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    requestedBy: row.requested_by,
    rationale: row.rationale,
    payload: row.payload || {},
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at || undefined,
    decidedBy: row.decided_by || undefined
  };
}

function mapShipment(row: any): ShipmentRecord {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    organizationId: row.organization_id || undefined,
    reference: row.reference,
    direction: row.direction,
    mode: row.mode,
    status: row.status,
    originCountry: row.origin_country || undefined,
    originLocation: row.origin_location || undefined,
    destinationCountry: row.destination_country || undefined,
    destinationLocation: row.destination_location || undefined,
    supplierId: row.supplier_id || undefined,
    purchaseOrderId: row.purchase_order_id || undefined,
    customerReference: row.customer_reference || undefined,
    freightForwarder: row.freight_forwarder || undefined,
    masterTrackingNumber: row.master_tracking_number || undefined,
    carrierCode: row.carrier_code || undefined,
    estimatedArrival: row.estimated_arrival || undefined,
    actualArrival: row.actual_arrival || undefined,
    currency: row.currency || undefined,
    goodsValue: row.goods_value === null ? undefined : Number(row.goods_value),
    freightCost: row.freight_cost === null ? undefined : Number(row.freight_cost),
    insuranceCost: row.insurance_cost === null ? undefined : Number(row.insurance_cost),
    notes: row.notes || undefined
  };
}

function mapCheckpoint(row: any): TrackingCheckpoint {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    shipmentId: row.shipment_id,
    trackingNumber: row.tracking_number,
    carrierCode: row.carrier_code,
    status: row.status,
    statusDetail: row.status_detail || undefined,
    location: row.location || undefined,
    countryCode: row.country_code || undefined,
    eventTime: row.event_time,
    source: row.source,
    rawProviderStatus: row.raw_provider_status || undefined,
    providerEventId: row.provider_event_id || undefined
  };
}

function mapTrackingRegistration(row: any): TrackingProviderRegistration {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    shipmentId: row.shipment_id,
    providerCode: row.provider_code,
    providerTrackingId: row.provider_tracking_id,
    trackingNumber: row.tracking_number,
    carrierCode: row.carrier_code || undefined,
    createdAt: row.created_at
  };
}
