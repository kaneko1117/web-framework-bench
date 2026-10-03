import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create(AppModule);
// whitelist で余計な項目を捨てる。transform は既定のまま切っておき、型の自動変換をしない。
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
await app.listen(3000);
