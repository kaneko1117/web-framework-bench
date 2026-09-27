import assert from "node:assert/strict";
import { test } from "node:test";

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) throw new Error("BASE_URL is required");

const MISSING_ID = 999_999_999;
const REQUEST_TIMEOUT_MS = 5_000;
const MALFORMED_JSON = "{not json";

// Invalid for both create and update; update additionally requires done.
const INVALID_BODIES = [
  ["missing title", { done: false }],
  ["empty title", { title: "" }],
  ["non-string title", { title: 1 }],
  ["non-boolean done", { title: "x", done: "yes" }],
  ["string boolean done", { title: "x", done: "true" }],
  ["numeric done", { title: "x", done: 1 }],
] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Task = { id: number; title: string; done: boolean; createdAt: string };

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return callRaw(method, path, body === undefined ? undefined : JSON.stringify(body));
}

function callRaw(method: string, path: string, body?: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readTask(res: Response): Promise<Task> {
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  const body: unknown = await res.json();
  assertTask(body);
  return body;
}

function assertTask(value: unknown): asserts value is Task {
  assert.ok(typeof value === "object" && value !== null, "task must be an object");
  assert.deepEqual(Object.keys(value).sort(), ["createdAt", "done", "id", "title"]);
  const task = value as Record<string, unknown>;
  assert.ok(Number.isInteger(task.id) && (task.id as number) > 0, "id must be a positive integer");
  assert.equal(typeof task.title, "string");
  assert.equal(typeof task.done, "boolean");
  assert.equal(typeof task.createdAt, "string");
  assert.match(task.createdAt as string, ISO_DATE);
  assert.equal(new Date(task.createdAt as string).toISOString(), task.createdAt);
}

async function create(body: unknown): Promise<Task> {
  const res = await call("POST", "/tasks", body);
  assert.equal(res.status, 201);
  return readTask(res);
}

test("POST /tasks creates a task with done defaulting to false", async () => {
  const task = await create({ title: "buy milk" });
  assert.equal(task.title, "buy milk");
  assert.equal(task.done, false);
});

test("POST /tasks keeps done and ignores unknown fields", async () => {
  const task = await create({ title: "walk", done: true, extra: "ignored" });
  assert.equal(task.done, true);
});

test("POST /tasks assigns increasing ids and never reuses deleted ones", async () => {
  const first = await create({ title: "a" });
  const second = await create({ title: "b" });
  assert.ok(second.id > first.id);

  assert.equal((await call("DELETE", `/tasks/${first.id}`)).status, 204);
  const third = await create({ title: "c" });
  assert.ok(third.id > second.id);
  assert.deepEqual(await readTask(await call("GET", `/tasks/${second.id}`)), second);
});

for (const [name, body] of INVALID_BODIES) {
  test(`POST /tasks rejects ${name} with 400`, async () => {
    const res = await call("POST", "/tasks", body);
    assert.equal(res.status, 400);
  });
}

test("POST /tasks rejects malformed JSON with 400", async () => {
  const res = await callRaw("POST", "/tasks", MALFORMED_JSON);
  assert.equal(res.status, 400);
});

test("GET /tasks lists all tasks in ascending id order", async () => {
  const created = [await create({ title: "list-1" }), await create({ title: "list-2" })];
  const res = await call("GET", "/tasks");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  const list: unknown = await res.json();
  assert.ok(Array.isArray(list));
  list.forEach(assertTask);
  const ids = (list as Task[]).map((t) => t.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  for (const task of created) {
    assert.deepEqual(
      (list as Task[]).find((t) => t.id === task.id),
      task,
    );
  }
});

test("GET /tasks/:id returns the task", async () => {
  const task = await create({ title: "get me" });
  const res = await call("GET", `/tasks/${task.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await readTask(res), task);
});

test("GET /tasks/:id returns 404 for a missing id", async () => {
  const res = await call("GET", `/tasks/${MISSING_ID}`);
  assert.equal(res.status, 404);
});

test("PUT /tasks/:id replaces title and done, keeping id and createdAt", async () => {
  const task = await create({ title: "before" });
  const res = await call("PUT", `/tasks/${task.id}`, { title: "after", done: true, extra: 1 });
  assert.equal(res.status, 200);
  const updated = await readTask(res);
  assert.deepEqual(updated, { ...task, title: "after", done: true });

  const fetched = await call("GET", `/tasks/${task.id}`);
  assert.deepEqual(await readTask(fetched), updated);
});

for (const [name, body] of [
  ...INVALID_BODIES.map(([n, b]) => [n, { done: true, ...b }] as const),
  ["missing done", { title: "x" }],
] as const) {
  test(`PUT /tasks/:id rejects ${name} with 400`, async () => {
    const task = await create({ title: "target" });
    const res = await call("PUT", `/tasks/${task.id}`, body);
    assert.equal(res.status, 400);
  });
}

test("PUT /tasks/:id rejects malformed JSON with 400", async () => {
  const task = await create({ title: "target" });
  const res = await callRaw("PUT", `/tasks/${task.id}`, MALFORMED_JSON);
  assert.equal(res.status, 400);
});

test("PUT /tasks/:id returns 404 for a missing id", async () => {
  const res = await call("PUT", `/tasks/${MISSING_ID}`, { title: "x", done: false });
  assert.equal(res.status, 404);
});

test("DELETE /tasks/:id removes the task with 204 and an empty body", async () => {
  const task = await create({ title: "delete me" });
  const res = await call("DELETE", `/tasks/${task.id}`);
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");

  const after = await call("GET", `/tasks/${task.id}`);
  assert.equal(after.status, 404);
});

test("DELETE /tasks/:id returns 404 for a missing id", async () => {
  const res = await call("DELETE", `/tasks/${MISSING_ID}`);
  assert.equal(res.status, 404);
});
