import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/configuration';
import { PrismaService } from './common/prisma.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix('api');
  app.use(
    helmet({
      // A documentacao OpenAPI e consumida pelo frontend e por ferramentas.
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      // Rotas de autenticacao tem limite mais apertado (forca bruta de senha).
      skip: (req) => req.path.endsWith('/login') || req.path.endsWith('/refresh'),
      message: { statusCode: 429, message: 'Muitas requisicoes. Aguarde alguns instantes.' },
    }),
  );

  app.use(
    '/api/auth',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.authMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Tentativas excedidas. Aguarde antes de tentar novamente.' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const documentConfig = new DocumentBuilder()
    .setTitle('API - Plataforma de Gestao Logistica')
    .setDescription(
      'API de operacao logistica: clientes, rotas, jornadas, visitas, localizacao, alertas e relatorios. ' +
      'Todos os indicadores derivam de dados persistidos; dados de demonstracao sao marcados com isDemo.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('Autenticacao')
    .addTag('Clientes')
    .addTag('Importacao de clientes')
    .addTag('Rotas')
    .addTag('Otimizacao')
    .addTag('Jornadas e visitas')
    .addTag('Localizacao e sincronizacao')
    .addTag('Alertas')
    .addTag('Dashboard')
    .addTag('Relatorios')
    .addTag('Usuarios e motoristas')
    .addTag('Configuracoes')
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const prisma = app.get(PrismaService);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API em http://localhost:${config.port}/api | docs em /api/docs`);
  logger.log(`Banco: ${prisma.safeTarget} | provedor de rotas: ${process.env.ROUTING_PROVIDER ?? 'heuristic'}`);
  if (!config.isProduction) {
    logger.warn('Modo de desenvolvimento: segredos padrao em uso. Nao usar em producao.');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} recebido, encerrando.`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
