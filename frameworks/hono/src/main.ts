import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

type Task = { id: number; title: string; done: boolean; createdAt: string };

const createBody = z.object({ title: z.string().min(1), done: z.boolean().optional() });
const updateBody = z.object({ title: z.string().min(1), done: z.boolean() });

const tasks = new Map<number, Task>();
let nextId = 1;

const app = new Hono();

app.post("/tasks", zValidator("json", createBody), (c) => {
  const body = c.req.valid("json");
  const task: Task = { id: nextId++, title: body.title, done: body.done ?? false, createdAt: new Date().toISOString() };
  tasks.set(task.id, task);
  return c.json(task, 201);
});

app.get("/tasks", (c) => c.json([...tasks.values()]));

app.get("/tasks/:id", (c) => {
  const task = tasks.get(Number(c.req.param("id")));
  if (!task) return c.body(null, 404);
  return c.json(task);
});

app.put("/tasks/:id", zValidator("json", updateBody), (c) => {
  const task = tasks.get(Number(c.req.param("id")));
  if (!task) return c.body(null, 404);
  const body = c.req.valid("json");
  const updated: Task = { ...task, title: body.title, done: body.done };
  tasks.set(task.id, updated);
  return c.json(updated);
});

app.delete("/tasks/:id", (c) => {
  if (!tasks.delete(Number(c.req.param("id")))) return c.body(null, 404);
  return c.body(null, 204);
});

serve({ fetch: app.fetch, port: 3000 });
