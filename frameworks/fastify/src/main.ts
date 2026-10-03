import Fastify from "fastify";

type Task = { id: number; title: string; done: boolean; createdAt: string };

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    done: { type: "boolean" },
    createdAt: { type: "string" },
  },
} as const;

const createBody = {
  type: "object",
  required: ["title"],
  properties: { title: { type: "string", minLength: 1 }, done: { type: "boolean" } },
} as const;

const updateBody = {
  type: "object",
  required: ["title", "done"],
  properties: { title: { type: "string", minLength: 1 }, done: { type: "boolean" } },
} as const;

const tasks = new Map<number, Task>();
let nextId = 1;

// 仕様で型の自動変換を禁じているので、Fastify 標準の coerceTypes を切る。
const app = Fastify({ ajv: { customOptions: { coerceTypes: false } } });

app.post<{ Body: { title: string; done?: boolean } }>(
  "/tasks",
  { schema: { body: createBody, response: { 201: taskSchema } } },
  async (req, reply) => {
    const task: Task = {
      id: nextId++,
      title: req.body.title,
      done: req.body.done ?? false,
      createdAt: new Date().toISOString(),
    };
    tasks.set(task.id, task);
    return reply.code(201).send(task);
  },
);

app.get("/tasks", { schema: { response: { 200: { type: "array", items: taskSchema } } } }, async () => [
  ...tasks.values(),
]);

app.get<{ Params: { id: string } }>(
  "/tasks/:id",
  { schema: { response: { 200: taskSchema } } },
  async (req, reply) => {
    const task = tasks.get(Number(req.params.id));
    if (!task) return reply.code(404).send();
    return task;
  },
);

app.put<{ Params: { id: string }; Body: { title: string; done: boolean } }>(
  "/tasks/:id",
  { schema: { body: updateBody, response: { 200: taskSchema } } },
  async (req, reply) => {
    const task = tasks.get(Number(req.params.id));
    if (!task) return reply.code(404).send();
    const updated: Task = { ...task, title: req.body.title, done: req.body.done };
    tasks.set(task.id, updated);
    return updated;
  },
);

app.delete<{ Params: { id: string } }>("/tasks/:id", async (req, reply) => {
  if (!tasks.delete(Number(req.params.id))) return reply.code(404).send();
  return reply.code(204).send();
});

// Docker の外から届くよう、全ての宛先で待ち受ける(Fastify の初期値は自分自身だけ)。
await app.listen({ port: 3000, host: "0.0.0.0" });
