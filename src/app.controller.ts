import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { GeminiService } from './gemini/gemini.service';
import { PromptDto } from './dtos/promt.dto';

@Controller()
export class AppController {
  constructor(private geminiService: GeminiService) { }

  @Post('/gemini')
  getGeminiReponse(@Body() body: PromptDto) {
    if (!body.prompt) {
      throw new Error('Prompt is required');
    }
    return this.geminiService.getGeminiResponse(body.prompt);
  }


  @Post('/human-query')
  getHumanQuery(@Body() body: PromptDto) {
    if (!body.prompt) {
      throw new Error('Prompt is required');
    }
    return this.geminiService.getGeminiResponse(body.prompt);
  }
}
