import express from "express";
import { z } from "zod";

type Task = { id: number; title: string; done: boolean; createdAt: string };

const createBody = z.object({ title: z.string().min(1), done: z.boolean().optional() });
const updateBody = z.object({ title: z.string().min(1), done: z.boolean() });

const tasks = new Map<number, Task>();
let nextId = 1;

const app = express();
app.use(express.json());

app.post("/tasks", (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const task: Task = {
    id: nextId++,
    title: parsed.data.title,
    done: parsed.data.done ?? false,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  res.status(201).json(task);
});

app.get("/tasks", (_req, res) => {
  res.json([...tasks.values()]);
});

app.get("/tasks/:id", (req, res) => {
  const task = tasks.get(Number(req.params.id));
  if (!task) {
    res.sendStatus(404);
    return;
  }
  res.json(task);
});

app.put("/tasks/:id", (req, res) => {
  const task = tasks.get(Number(req.params.id));
  if (!task) {
    res.sendStatus(404);
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.issues });
    return;
  }
  const updated: Task = { ...task, title: parsed.data.title, done: parsed.data.done };
  tasks.set(task.id, updated);
  res.json(updated);
});

app.delete("/tasks/:id", (req, res) => {
  if (!tasks.delete(Number(req.params.id))) {
    res.sendStatus(404);
    return;
  }
  res.sendStatus(204);
});

app.listen(3000);
