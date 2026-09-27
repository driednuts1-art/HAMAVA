import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ReportReasonDto } from '../../safety/dto/report-reason.dto';

export class ReportConversationDto extends ReportReasonDto {
  @ApiPropertyOptional({
    description: 'A specific message to point the report at, if any',
  })
  @IsOptional()
  @IsUUID()
  messageId?: string;
}
