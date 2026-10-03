import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { CreateTaskDto, UpdateTaskDto } from "./tasks.dto.js";

type Task = { id: number; title: string; done: boolean; createdAt: string };

@Controller("tasks")
export class TasksController {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  @Post()
  create(@Body() body: CreateTaskDto): Task {
    const task: Task = { id: this.nextId++, title: body.title, done: body.done ?? false, createdAt: new Date().toISOString() };
    this.tasks.set(task.id, task);
    return task;
  }

  @Get()
  list(): Task[] {
    return [...this.tasks.values()];
  }

  @Get(":id")
  get(@Param("id") id: string): Task {
    return this.find(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: UpdateTaskDto): Task {
    const updated: Task = { ...this.find(id), title: body.title, done: body.done };
    this.tasks.set(updated.id, updated);
    return updated;
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string): void {
    if (!this.tasks.delete(Number(id))) throw new NotFoundException();
  }

  /** 番号のタスクを返す。無ければ 404。 */
  private find(id: string): Task {
    const task = this.tasks.get(Number(id));
    if (!task) throw new NotFoundException();
    return task;
  }
}
