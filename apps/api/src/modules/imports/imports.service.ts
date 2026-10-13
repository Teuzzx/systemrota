import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CustomerStatus, ImportSeverity, ImportStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CustomersService } from '../customers/customers.service';
import { normalizeName } from '../customers/customers.service';

export type ImportField =
  | 'externalId' | 'tradeName' | 'contactName' | 'phone' | 'addressLine'
  | 'neighborhood' | 'city' | 'state' | 'zipCode'
  | 'latitude' | 'longitude' | 'notes' | 'openingHours' | 'priority';

export const IMPORT_FIELDS: ImportField[] = [
  'externalId', 'tradeName', 'contactName', 'phone', 'addressLine',
  'neighborhood', 'city', 'state', 'zipCode', 'latitude', 'longitude',
  'notes', 'openingHours', 'priority',
];

export type ImportMapping = Partial<Record<ImportField, string>>;

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string>;
}

/** Linha ja mapeada para os campos internos. */
export interface MappedRow {
  externalId: string | null;
  tradeName: string;
  contactName: string | null;
  phone: string | null;
  addressLine: string | null;
  neighborhood: string | null;
  city: string;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  openingHours: string | null;
  priority: number;
}

export interface RowIssue {
  rowNumber: number;
  column?: string;
  message: string;
  severity: ImportSeverity;
  rawValue?: string;
}

export interface ParsedFile {
  headers: string[];
  rows: ParsedRow[];
  format: 'CSV' | 'XLSX';
}

/**
 * Importacao de clientes do sistema comercial existente.
 *
 * Regras do briefing respeitadas:
 *  - fluxo em etapas: upload -> colunas -> mapeamento -> validacao -> previa
 *    -> duplicidades -> confirmacao -> processamento -> erros -> relatorio;
 *  - idempotencia por checksum do arquivo + chave do lote;
 *  - NUNCA sobrescreve dado existente sem regra explicita;
 *  - coordenadas nunca inventadas: ausencia vira pendencia geografica.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
  ) {}

  // ------------------------------ ETAPA 1: upload -------------------------

  async upload(file: { originalname: string; buffer: Buffer; size: number }, actorId: string | null) {
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const format: 'CSV' | 'XLSX' = /\.xlsx?$/i.test(file.originalname) ? 'XLSX' : 'CSV';

    // Idempotencia: o mesmo arquivo reenviado reaproveita o lote existente.
    const existing = await this.prisma.customerImport.findUnique({
      where: { idempotencyKey: `${checksum}:${format}` },
      include: { errors: { take: 50 } },
    });
    if (existing) {
      this.logger.log(`Arquivo reenviado. Lote ${existing.id} reaproveitado (idempotencia).`);
      return {
        importId: existing.id,
        reusedExistingBatch: true,
        status: existing.status,
        message:
          'Este arquivo ja havia sido processado. O lote existente foi reaproveitado para evitar duplicidade.',
        headers: [],
        totalRows: existing.totalRows,
        insertedCount: existing.insertedCount,
        updatedCount: existing.updatedCount,
        skippedCount: existing.skippedCount,
        errorCount: existing.errorCount,
        errors: existing.errors,
      };
    }

    let parsed: ParsedFile;
    try {
      parsed = await this.parseBuffer(file.buffer, format);
    } catch (error) {
      throw new BadRequestException(`Nao foi possivel ler o arquivo: ${String(error)}`);
    }
    if (parsed.headers.length === 0) {
      throw new BadRequestException('Arquivo sem cabecalho reconhecido.');
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException('Arquivo sem linhas de dados.');
    }

    const created = await this.prisma.customerImport.create({
      data: {
        fileName: file.originalname.slice(0, 255),
        fileSizeBytes: file.size,
        fileChecksum: checksum,
        format,
        idempotencyKey: `${checksum}:${format}`,
        status: ImportStatus.UPLOADED,
        totalRows: parsed.rows.length,
        uploadedById: actorId,
        // Guardamos o arquivo cru para reprocessar sem novo upload.
        mapping: { __rows: parsed.rows.slice(0, 5000) } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      actorId, action: 'import.uploaded', entity: 'CustomerImport', entityId: created.id,
      after: { fileName: created.fileName, totalRows: parsed.rows.length, checksum },
    });

    return {
      importId: created.id,
      reusedExistingBatch: false,
      status: created.status,
      headers: parsed.headers,
      totalRows: parsed.rows.length,
      suggestedMapping: suggestMapping(parsed.headers),
      fields: IMPORT_FIELDS,
    };
  }

  // ------------------- ETAPAS 2-4: mapeamento, validacao, previa ----------

  async preview(importId: string, mapping: ImportMapping) {
    const batch = await this.requireBatch(importId);
    const rows = this.readRows(batch);
    const resolved = { ...suggestMapping(rows.headers), ...mapping };
    const issues = this.validateRows(rows, resolved);
    const previewRows = rows.rows.slice(0, 20).map((row) => ({
      rowNumber: row.rowNumber,
      parsed: mapRow(row.raw, resolved),
    }));
    const duplicates = await this.detectDuplicates(rows, resolved);
    const summary = this.summarize(rows, resolved, issues, duplicates);

    await this.prisma.customerImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.VALIDATED,
        mapping: { ...resolved, __rows: rows.rows.slice(0, 5000) } as unknown as Prisma.InputJsonValue,
        errorCount: issues.filter((i) => i.severity === ImportSeverity.ERRO).length,
      },
    });

    return { importId, mapping: resolved, previewRows, issues: issues.slice(0, 200), issueTotal: issues.length, duplicates, summary };
  }

  // --------------- ETAPAS 8-10: confirmacao, processamento, relatorio ----

  async commit(
    importId: string,
    options: { onConflict?: 'SKIP' | 'UPDATE_FIELDS'; updateFields?: ImportField[] },
    actorId: string | null,
  ) {
    const batch = await this.requireBatch(importId);
    const rows = this.readRows(batch);
    const mapping = (batch.mapping ?? {}) as ImportMapping;
    const onConflict = options.onConflict ?? 'SKIP';
    const updateFields = options.updateFields ?? [];

    await this.prisma.customerImport.update({
      where: { id: importId },
      data: { status: ImportStatus.VALIDATING, startedAt: new Date() },
    });

    const issues = this.validateRows(rows, mapping);
    for (const issue of issues) {
      await this.prisma.customerImportError.create({
        data: {
          importId,
          rowNumber: issue.rowNumber,
          column: issue.column ?? null,
          rawValue: issue.rawValue?.slice(0, 500) ?? null,
          message: issue.message.slice(0, 500),
          severity: issue.severity,
        },
      });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows.rows) {
      const rowIssues = issues.filter((i) => i.rowNumber === row.rowNumber && i.severity === ImportSeverity.ERRO);
      if (rowIssues.length > 0) {
        skipped += 1;
        continue;
      }
      const parsed = mapRow(row.raw, mapping);
      const geo = CustomersService.classifyCoordinates(parsed.latitude, parsed.longitude);
      const externalId = parsed.externalId?.trim();

      try {
        if (externalId) {
          const existing = await this.prisma.customer.findUnique({
            where: { sourceSystem_externalId: { sourceSystem: 'LEGACY_IMPORT', externalId } },
          });
          if (existing) {
            if (onConflict === 'UPDATE_FIELDS' && updateFields.length > 0) {
              const patch: Record<string, unknown> = {};
              for (const field of updateFields) {
                const value = (parsed as unknown as Record<string, unknown>)[field];
                if (value !== undefined && value !== null && value !== '') patch[field] = value;
              }
              if (Object.keys(patch).length > 0) {
                patch.geocodeStatus = geo.status;
                await this.prisma.customer.update({ where: { id: existing.id }, data: patch });
                updated += 1;
              } else {
                skipped += 1;
              }
            } else {
              // Padrao: nunca sobrescreve dado existente sem regra explicita.
              skipped += 1;
            }
            continue;
          }
        }
        const data = this.customers.buildData(
          {
            externalId: parsed.externalId,
            sourceSystem: 'LEGACY_IMPORT',
            tradeName: parsed.tradeName,
            contactName: parsed.contactName,
            phone: parsed.phone,
            addressLine: parsed.addressLine,
            neighborhood: parsed.neighborhood,
            city: parsed.city,
            state: parsed.state ?? undefined,
            zipCode: parsed.zipCode,
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            notes: parsed.notes,
            openingHours: parsed.openingHours,
            priority: parsed.priority,
          },
          geo.status,
          importId,
        );
        const created = await this.prisma.$transaction(async (tx) => {
          const customer = await tx.customer.create({ data });
          if (geo.valid && parsed.latitude != null && parsed.longitude != null) {
            await tx.$executeRaw`
              UPDATE "customers"
                 SET "location" = ST_SetSRID(ST_MakePoint(${parsed.longitude}, ${parsed.latitude}), 4326)::geography
               WHERE "id" = ${customer.id}::uuid
            `;
          }
          return customer;
        });
        inserted += 1;
        void created;
      } catch (error) {
        skipped += 1;
        await this.prisma.customerImportError.create({
          data: {
            importId,
            rowNumber: row.rowNumber,
            message: `Falha ao gravar: ${String(error).slice(0, 300)}`,
            severity: ImportSeverity.ERRO,
          },
        });
      }
    }

    const result = await this.prisma.customerImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.COMMITTED,
        insertedCount: inserted,
        updatedCount: updated,
        skippedCount: skipped,
        finishedAt: new Date(),
      },
    });

    await this.audit.record({
      actorId, action: 'import.committed', entity: 'CustomerImport', entityId: importId,
      after: { inserted, updated, skipped },
    });

    return {
      importId,
      status: result.status,
      insertedCount: inserted,
      updatedCount: updated,
      skippedCount: skipped,
      errorCount: await this.prisma.customerImportError.count({ where: { importId } }),
      report: 'Lote processado com sucesso. Consulte os erros para as linhas rejeitadas.',
    };
  }

  async list() {
    return this.prisma.customerImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { errors: true, customers: true } } },
    });
  }

  async errors(importId: string) {
    return this.prisma.customerImportError.findMany({
      where: { importId },
      orderBy: { rowNumber: 'asc' },
      take: 1000,
    });
  }

  // ------------------------------ Exportacao ------------------------------

  async exportCsv(query: { city?: string; status?: CustomerStatus }) {
    const rows = await this.prisma.customer.findMany({
      where: {
        city: query.city ?? undefined,
        status: query.status ?? undefined,
      },
      orderBy: [{ city: 'asc' }, { tradeName: 'asc' }],
    });
    const csv = stringifyCsv(
      rows.map((c) => ({
        identificador_original: c.externalId ?? '',
        nome_estabelecimento: c.tradeName,
        responsavel: c.contactName ?? '',
        telefone: c.phone ?? '',
        endereco: c.addressLine ?? '',
        bairro: c.neighborhood ?? '',
        cidade: c.city,
        estado: c.state,
        cep: c.zipCode ?? '',
        latitude: c.latitude ?? '',
        longitude: c.longitude ?? '',
        status_geo: c.geocodeStatus,
        status_cadastro: c.status,
        ultima_visita: c.lastVisitAt?.toISOString() ?? '',
        dados_demo: c.isDemo ? 'SIM' : 'NAO',
        importado_em: c.createdAt.toISOString(),
      })),
      { header: true, delimiter: ';' },
    );
    return csv;
  }

  async exportXlsx(query: { city?: string; status?: CustomerStatus }) {
    const rows = await this.prisma.customer.findMany({
      where: { city: query.city ?? undefined, status: query.status ?? undefined },
      orderBy: [{ city: 'asc' }, { tradeName: 'asc' }],
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.columns = [
      { header: 'Identificador original', key: 'externalId', width: 20 },
      { header: 'Estabelecimento', key: 'tradeName', width: 38 },
      { header: 'Responsavel', key: 'contactName', width: 24 },
      { header: 'Telefone', key: 'phone', width: 16 },
      { header: 'Endereco', key: 'addressLine', width: 34 },
      { header: 'Bairro', key: 'neighborhood', width: 20 },
      { header: 'Cidade', key: 'city', width: 18 },
      { header: 'Estado', key: 'state', width: 8 },
      { header: 'Latitude', key: 'latitude', width: 13 },
      { header: 'Longitude', key: 'longitude', width: 13 },
      { header: 'Status geo', key: 'geocodeStatus', width: 14 },
      { header: 'Dados demo', key: 'isDemo', width: 12 },
    ];
    for (const row of rows) {
      sheet.addRow({
        externalId: row.externalId ?? '',
        tradeName: row.tradeName,
        contactName: row.contactName ?? '',
        phone: row.phone ?? '',
        addressLine: row.addressLine ?? '',
        neighborhood: row.neighborhood ?? '',
        city: row.city,
        state: row.state,
        latitude: row.latitude ?? '',
        longitude: row.longitude ?? '',
        geocodeStatus: row.geocodeStatus,
        isDemo: row.isDemo ? 'SIM' : 'NAO',
      });
    }
    sheet.getRow(1).font = { bold: true };
    return workbook.xlsx.writeBuffer();
  }

  // ------------------------------ Internos --------------------------------

  private async requireBatch(importId: string) {
    const batch = await this.prisma.customerImport.findUnique({ where: { id: importId } });
    if (!batch) throw new BadRequestException('Lote de importacao nao encontrado.');
    if (batch.status === ImportStatus.COMMITTED) {
      throw new BadRequestException('Lote ja processado. Reenvie o arquivo para um novo lote ou use a idempotencia.');
    }
    return batch;
  }

  private readRows(batch: {
    mapping: Prisma.JsonValue | null;
  }): { headers: string[]; rows: ParsedRow[] } {
    const stored = (batch.mapping ?? {}) as { __rows?: ParsedRow[] };
    const rows = stored.__rows ?? [];
    const headers = rows.length > 0 ? Object.keys(rows[0]!.raw) : [];
    return { headers, rows };
  }

  private validateRows(data: { rows: ParsedRow[] }, mapping: ImportMapping): RowIssue[] {
    const issues: RowIssue[] = [];
    if (!mapping.tradeName) {
      issues.push({ rowNumber: 0, column: 'tradeName', message: 'E necessario mapear a coluna do nome do estabelecimento.', severity: ImportSeverity.ERRO });
    }
    if (!mapping.city) {
      issues.push({ rowNumber: 0, column: 'city', message: 'E necessario mapear a coluna da cidade.', severity: ImportSeverity.ERRO });
    }
    for (const row of data.rows) {
      const parsed = mapRow(row.raw, mapping);
      if (!parsed.tradeName) {
        issues.push({ rowNumber: row.rowNumber, message: 'Nome do estabelecimento ausente.', severity: ImportSeverity.ERRO });
      }
      if (!parsed.city) {
        issues.push({ rowNumber: row.rowNumber, column: 'city', message: 'Cidade ausente.', severity: ImportSeverity.ERRO });
      }
      const geo = CustomersService.classifyCoordinates(parsed.latitude, parsed.longitude);
      if (!geo.valid) {
        issues.push({
          rowNumber: row.rowNumber,
          column: mapping.latitude ?? mapping.longitude,
          message: `Coordenadas nao confiaveis (${geo.status}): ${geo.reason ?? 'sem coordenada'}. Cliente sera importado como PENDENTE de geolocalizacao.`,
          severity: ImportSeverity.AVISO,
          rawValue: String(parsed.latitude ?? ''),
        });
      }
      if (parsed.latitude != null && parsed.longitude == null) {
        issues.push({ rowNumber: row.rowNumber, message: 'Latitude informada sem longitude.', severity: ImportSeverity.AVISO });
      }
    }
    return issues;
  }

  private async detectDuplicates(data: { rows: ParsedRow[] }, mapping: ImportMapping) {
    const results: Array<{ rowNumber: number; tradeName: string; reason: string; existingCustomerId: string | null }> = [];
    const externalIds = data.rows.map((r) => mapRow(r.raw, mapping).externalId).filter(Boolean) as string[];
    if (externalIds.length > 0) {
      const existing = await this.prisma.customer.findMany({
        where: { sourceSystem: 'LEGACY_IMPORT', externalId: { in: externalIds.slice(0, 1000) } },
        select: { id: true, externalId: true },
      });
      const byExternal = new Map(existing.map((c) => [c.externalId as string, c.id]));
      data.rows.forEach((row) => {
        const externalId = mapRow(row.raw, mapping).externalId;
        if (externalId && byExternal.has(externalId)) {
          results.push({
            rowNumber: row.rowNumber,
            tradeName: mapRow(row.raw, mapping).tradeName ?? '',
            reason: 'Ja existe cliente com o mesmo identificador do sistema comercial',
            existingCustomerId: byExternal.get(externalId) as string,
          });
        }
      });
    }
    const names = data.rows.map((r) => mapRow(r.raw, mapping).tradeName).filter(Boolean) as string[];
    if (names.length > 0) {
      const existingByName = await this.prisma.customer.findMany({
        where: { tradeName: { in: names.slice(0, 500), mode: 'insensitive' } },
        select: { id: true, tradeName: true },
      });
      const normalized = new Map(existingByName.map((c) => [normalizeName(c.tradeName), c.id]));
      data.rows.forEach((row) => {
        const tradeName = mapRow(row.raw, mapping).tradeName;
        if (!tradeName) return;
        const id = normalized.get(normalizeName(tradeName));
        if (id && !results.some((r) => r.rowNumber === row.rowNumber)) {
          results.push({
            rowNumber: row.rowNumber,
            tradeName,
            reason: 'Ja existe cliente com nome muito parecido',
            existingCustomerId: id,
          });
        }
      });
    }
    return results;
  }

  private summarize(
    data: { rows: ParsedRow[] },
    mapping: ImportMapping,
    issues: RowIssue[],
    duplicates: Array<{ rowNumber: number }>,
  ) {
    const errorRows = new Set(issues.filter((i) => i.severity === ImportSeverity.ERRO && i.rowNumber > 0).map((i) => i.rowNumber));
    const duplicateRows = new Set(duplicates.map((d) => d.rowNumber));
    const pendingGeo = new Set(
      issues.filter((i) => i.message.includes('geolocalizacao')).map((i) => i.rowNumber),
    );
    return {
      totalRows: data.rows.length,
      willInsert: data.rows.length - errorRows.size,
      willSkip: errorRows.size,
      duplicateRows: duplicateRows.size,
      pendingGeocodeRows: pendingGeo.size,
      hasBlockingErrors: issues.some((i) => i.severity === ImportSeverity.ERRO && i.rowNumber === 0),
      mappingComplete: Boolean(mapping.tradeName && mapping.city),
    };
  }

  private async parseBuffer(buffer: Buffer, format: 'CSV' | 'XLSX'): Promise<ParsedFile> {
    if (format === 'CSV') {
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
      const records = parseCsv(text, {
        columns: (header: string[]) => header.map((h) => h.trim()),
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true,
        // Exportacao de Excel em pt-BR normalmente usa ';'. Detectamos pelo
        // cabecalho em vez de exigir que o administrador escolha.
        delimiter: detectDelimiter(text),
      }) as Array<Record<string, string>>;
      return {
        format,
        headers: records.length > 0 ? Object.keys(records[0]!) : [],
        rows: records.map((raw, index) => ({ rowNumber: index + 2, raw })),
      };
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Planilha sem aba de dados.');
    const rows: ParsedRow[] = [];
    let headers: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        headers = (row.values as unknown[]).slice(1).map((v) => String(v ?? '').trim());
        return;
      }
      const values = (row.values as unknown[]).slice(1);
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[header] = values[index] === null || values[index] === undefined ? '' : String(values[index]).trim();
      });
      if (Object.values(raw).some((v) => v !== '')) rows.push({ rowNumber, raw });
    });
    return { format, headers, rows };
  }
}

/**
 * Detecta o delimitador do CSV contando occurrencias na PRIMEIRA linha.
 * Padrao de exportacao brasileira (Excel pt-BR) e ';'.
 */
function detectDelimiter(text: string): string | string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// Suge o mapeamento automatico: alias em pt-BR e nome tecnico, por aproximacao.
function suggestMapping(headers: string[]): ImportMapping {
  const aliases: Record<ImportField, string[]> = {
    externalId: ['identificador', 'codigo', 'cod', 'id', 'idcliente', 'codcliente', 'externalid'],
    tradeName: ['estabelecimento', 'nome', 'razaosocial', 'nomefantasia', 'cliente', 'tradename', 'pontovenda'],
    contactName: ['responsavel', 'contato', 'nomecontato', 'contactname'],
    phone: ['telefone', 'fone', 'celular', 'tel', 'phone'],
    addressLine: ['endereco', 'logradouro', 'rua', 'address', 'enderecocompleto'],
    neighborhood: ['bairro', 'neighborhood', 'bairrocliente'],
    city: ['cidade', 'municipio', 'city'],
    state: ['estado', 'uf', 'state'],
    zipCode: ['cep', 'zipcode', 'codigopostal'],
    latitude: ['latitude', 'lat', 'coordy', 'y'],
    longitude: ['longitude', 'long', 'lng', 'lon', 'coordx', 'x'],
    notes: ['observacao', 'obs', 'nota', 'notes', 'observacoes'],
    openingHours: ['horario', 'horariofuncionamento', 'openinghours'],
    priority: ['prioridade', 'priority'],
  };
  const mapping: ImportMapping = {};
  for (const header of headers) {
    const normalized = normalizeName(header);
    for (const [field, options] of Object.entries(aliases) as Array<[ImportField, string[]]>) {
      if (mapping[field]) continue;
      if (options.some((alias) => normalizeName(alias) === normalized)) {
        mapping[field] = header;
        break;
      }
    }
  }
  return mapping;
}

function mapRow(raw: Record<string, string>, mapping: ImportMapping): MappedRow {
  const get = (field: ImportField): string | undefined => {
    const column = mapping[field];
    return column ? raw[column] : undefined;
  };
  const numberOrNull = (value: string | undefined): number | null => {
    if (value === undefined || value === '') return null;
    const cleaned = value.replace(',', '.').replace(/\s/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    externalId: get('externalId')?.trim() || null,
    tradeName: get('tradeName')?.trim() ?? '',
    contactName: get('contactName')?.trim() || null,
    phone: get('phone')?.trim() || null,
    addressLine: get('addressLine')?.trim() || null,
    neighborhood: get('neighborhood')?.trim() || null,
    city: get('city')?.trim() ?? '',
    state: get('state')?.trim() || null,
    zipCode: get('zipCode')?.trim() || null,
    latitude: numberOrNull(get('latitude')),
    longitude: numberOrNull(get('longitude')),
    notes: get('notes')?.trim() || null,
    openingHours: get('openingHours')?.trim() || null,
    priority: numberOrNull(get('priority')) ?? 5,
  };
}
