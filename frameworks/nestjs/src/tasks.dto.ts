import { IsBoolean, IsString, MinLength, ValidateIf } from "class-validator";

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  // @IsOptional は null も素通りさせるので、省略(undefined)のときだけチェックを飛ばす。
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  done?: boolean;
}

export class UpdateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsBoolean()
  done!: boolean;
}
