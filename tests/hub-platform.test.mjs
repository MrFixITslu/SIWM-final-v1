import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";

const platformSecret = "siwm-platform-secret-12345678901234567890";
const launchSecret = "siwm-launch-secret-123456789012345678901";
const jwtSecret = "siwm-jwt-secret-123456789012345678901234567890";

function canonical(method, pathname, timestamp, body = "") {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return [method.toUpperCase(), pathname, timestamp, bodyHash].join("\n");
}
function sign(method, pathname, timestamp, body = "", secret = platformSecret) {
  return crypto.createHmac("sha256", secret).update(canonical(method, pathname, timestamp, body)).digest("hex");
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("Hub provisioning pins the same owner to isolated SIWM warehouses", { timeout: 45000 }, async t => {
  const sessions = new Map([
    ["ticket-a-abcdefghijklmnopqrstuvwxyz123456", {
      organization: { id: "hub-org-a-1234", name: "Warehouse A", slug: "warehouse-a" },
      user: { id: "hub-user-a-1234", email: "shared-owner@example.test", name: "Shared Owner" },
      role: "owner", entitlement: { product: "siwm", enabled: true, access: "owner" }, plan: "hub",
    }],
    ["ticket-b-abcdefghijklmnopqrstuvwxyz123456", {
      organization: { id: "hub-org-b-1234", name: "Warehouse B", slug: "warehouse-b" },
      user: { id: "hub-user-b-1234", email: "shared-owner@example.test", name: "Shared Owner" },
      role: "owner", entitlement: { product: "siwm", enabled: true, access: "owner" }, plan: "hub",
    }],
  ]);

  const hubServer = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (req.method !== "POST" || pathname !== "/api/platform/session/consume") {
      res.writeHead(404).end();
      return;
    }
    const timestamp = String(req.headers["x-v79-timestamp"] || "");
    assert.equal(req.headers["x-v79-service-id"], "v79-siwm");
    assert.equal(String(req.headers["x-v79-signature"] || ""), sign("POST", pathname, timestamp, body, launchSecret));
    const session = sessions.get(JSON.parse(body).ticket);
    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "expired" }));
      return;
    }
    sessions.delete(JSON.parse(body).ticket);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(session));
  });
  await new Promise(resolve => hubServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => hubServer.close(resolve)));

  const port = await freePort();
  const hubPort = hubServer.address().port;
  const child = spawn(process.execPath, ["dist/server.cjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(port), JWT_SECRET: jwtSecret,
      V79_PLATFORM_SHARED_SECRET: platformSecret, V79_SIWM_LAUNCH_SECRET: launchSecret,
      V79_HUB_INTERNAL_URL: `http://127.0.0.1:${hubPort}`, V79_HUB_PUBLIC_URL: "https://hub.v79sl.com",
      SEED_DEMO_DATA: "false", DATABASE_URL: "", DB_HOST: "", PGHOST: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", c => logs += c);
  child.stderr.on("data", c => logs += c);
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(r => child.once("exit", r)), new Promise(r => setTimeout(r, 1500))]);
    }
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
    if (i === 199) assert.fail(logs || "SIWM server did not start");
    await new Promise(r => setTimeout(r, 50));
  }

  async function platform(pathname, { method = "GET", body = "" } = {}) {
    const timestamp = String(Date.now());
    const response = await fetch(base + pathname, {
      method,
      headers: {
        "content-type": "application/json",
        "x-v79-service-id": "v79-hub",
        "x-v79-timestamp": timestamp,
        "x-v79-signature": sign(method, pathname, timestamp, body),
      },
      body: body || undefined,
      redirect: "manual",
    });
    return { response, payload: await response.json().catch(() => ({})) };
  }

  async function provision(orgId, name, hubUserId) {
    const body = JSON.stringify({
      organization: { id: orgId, name, slug: name.toLowerCase().replace(/\s+/g, "-") },
      user: { id: hubUserId, email: "shared-owner@example.test", name: "Shared Owner" },
      role: "owner", plan: "hub",
    });
    const result = await platform("/api/platform/provision", { method: "POST", body });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    return result.payload;
  }

  const a = await provision("hub-org-a-1234", "Warehouse A", "hub-user-a-1234");
  const b = await provision("hub-org-b-1234", "Warehouse B", "hub-user-b-1234");
  assert.notEqual(a.warehouseId, b.warehouseId);
  assert.equal(a.userId, b.userId);
  const repeatedA = await provision("hub-org-a-1234", "Warehouse A", "hub-user-a-1234");
  assert.equal(repeatedA.warehouseId, a.warehouseId);

  const summaryA = await platform("/api/platform/summary/hub-org-a-1234");
  const summaryB = await platform("/api/platform/summary/hub-org-b-1234");
  assert.equal(summaryA.response.status, 200);
  assert.equal(summaryB.response.status, 200);
  assert.equal(summaryA.payload.subjectId, a.warehouseId);
  assert.equal(summaryB.payload.subjectId, b.warehouseId);

  async function launch(ticket, expectedWarehouseId) {
    const response = await fetch(base + `/api/platform/launch?ticket=${ticket}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = response.headers.get("location") || "";
    assert.ok(location.startsWith("/#hub_token="));
    const token = decodeURIComponent(location.split("#hub_token=")[1]);
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    const me = await fetch(base + "/api/auth/me", { headers });
    assert.equal(me.status, 200, await me.clone().text());
    const identity = await me.json();
    assert.equal(identity.warehouse.id, expectedWarehouseId);
    assert.equal(identity.hubManaged, true);
    const warehouses = await fetch(base + "/api/auth/warehouses", { headers });
    assert.deepEqual((await warehouses.json()).warehouses.map(w => w.id), [expectedWarehouseId]);
    return headers;
  }

  const headersA = await launch("ticket-a-abcdefghijklmnopqrstuvwxyz123456", a.warehouseId);
  await launch("ticket-b-abcdefghijklmnopqrstuvwxyz123456", b.warehouseId);
  const forbidden = await fetch(base + "/api/auth/warehouses/switch", {
    method: "POST", headers: headersA, body: JSON.stringify({ warehouseId: b.warehouseId }),
  });
  assert.equal(forbidden.status, 403);

  const replay = await fetch(base + "/api/platform/launch?ticket=ticket-a-abcdefghijklmnopqrstuvwxyz123456", { redirect: "manual" });
  assert.equal(replay.status, 302);
  assert.match(replay.headers.get("location") || "", /hub\.v79sl\.com/);

  const unsigned = await fetch(base + "/api/platform/provision", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(unsigned.status, 401);
});
