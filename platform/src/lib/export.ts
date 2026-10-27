// export.ts: tudo que a plataforma guarda do tenant, em um JSON (LGPD, portabilidade).
// Só lê, só do tenant da sessão. Os tokens das redes (social_account_secrets) não têm tenant_id e
// não estão em TENANT_TABLES, então nunca saem aqui; o hash do token de convite é cortado abaixo.

// Colunas que nunca entram no arquivo, por tabela.
const REDACTED: Record<string, readonly string[]> = {
  invitations: ['token_hash'],
};

import type { TenantDb } from './tenant-db';
import { TENANT_TABLES } from './tenant-tables';
import { defaultStore, readLogo, type BlobStore, type LogoVariant } from './brand-logo';
import { log } from './log';

const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 50_000;

function redact(table: string, row: unknown): unknown {
  const drop = REDACTED[table];
  if (!drop || typeof row !== 'object' || row === null) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key)));
}

async function readAll(t: TenantDb, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
    const { data, error } = await t.select(table).range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao exportar ${table}: ${error.message}`);
    rows.push(...(data || []).map((row) => redact(table, row)));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export type ExportedFile = { path: string; content_type: string; encoding: 'base64'; data: string };

// O arquivo do logo vai dentro do JSON, em base64 (até 2 MB), para o pacote ser tudo que a conta
// guarda. Os tokens das redes nunca entram.
async function logoFile(t: TenantDb, store: BlobStore, variant: LogoVariant = 'main'): Promise<ExportedFile | null> {
  const logo = await readLogo(t, store, variant);
  if (!logo) return null;
  const asset = await t.select('brand_assets', 'storage_path').eq('id', logo.assetId).maybeSingle();
  if (asset.error) throw new Error(`Falha ao exportar o logo: ${asset.error.message}`);
  return { path: String(asset.data?.storage_path ?? ''), content_type: logo.contentType, encoding: 'base64', data: Buffer.from(logo.bytes).toString('base64') };
}

export async function exportTenant(t: TenantDb, store: BlobStore = defaultStore()): Promise<{
  tenant: string;
  exported_at: string;
  tables: Record<string, unknown[]>;
  files: { logo: ExportedFile | null; logoVariants: Partial<Record<'dark' | 'light' | 'symbol', ExportedFile>> };
}> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TENANT_TABLES) tables[name] = await readAll(t, name);
  const logo = await logoFile(t, store).catch((e) => {
    // Um arquivo que sumiu do bucket não pode impedir o titular de levar o resto dos dados.
    log('error', 'export', 'não leu o logo para a exportação', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  // As variações da logo (SPEC 026) vão junto; uma que sumiu do bucket não impede o resto.
  const logoVariants: Partial<Record<'dark' | 'light' | 'symbol', ExportedFile>> = {};
  for (const v of ['dark', 'light', 'symbol'] as const) {
    const file = await logoFile(t, store, v).catch((e) => {
      log('error', 'export', 'não leu uma variação do logo para a exportação', { variant: v, error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (file) logoVariants[v] = file;
  }
  return { tenant: t.tenantId, exported_at: new Date().toISOString(), tables, files: { logo, logoVariants } };
}
