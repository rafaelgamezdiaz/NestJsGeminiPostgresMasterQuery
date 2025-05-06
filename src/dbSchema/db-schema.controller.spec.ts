import { Test, TestingModule } from '@nestjs/testing';
import { DbSchemaControllerController } from './db-schema.controller';

describe('DbSchemaControllerController', () => {
  let controller: DbSchemaControllerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DbSchemaControllerController],
    }).compile();

    controller = module.get<DbSchemaControllerController>(DbSchemaControllerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
