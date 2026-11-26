import { IsString, IsOptional, IsInt, Min, Max, IsArray, IsIn, IsBoolean } from 'class-validator';

export class CreatePrivateDebateDto {
  @IsString()
  title: string;

  @IsString()
  hostView: string;

  @IsInt()
  @Min(2)
  @Max(10)
  mode: number;

  @IsOptional()
  @IsString()
  privateContext?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themes?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['COMPETITIVE', 'EXPLORATORY'], { message: 'gameMode doit être COMPETITIVE ou EXPLORATORY' })
  gameMode?: 'COMPETITIVE' | 'EXPLORATORY';

  @IsOptional()
  @IsBoolean()
  isLive?: boolean; // true = live (défaut), false = async

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(30)
  maxMessagesPerUser?: number; // 10, 20 ou 30 pour async
}
