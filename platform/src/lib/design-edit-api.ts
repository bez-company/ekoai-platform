// design-edit-api.ts: a resposta das rotas do ajuste rápido (SPEC 019). Conflito e reprovação do revisor
// levam dados a mais que o apiError padrão não carrega (a versão atual, os achados que travam).

import { NextResponse } from 'next/server';
import { apiError } from './api';
import { RevisionBlocked, RevisionConflict } from './post-design-revisions';

export function designEditError(e: unknown, scope: string): NextResponse {
  if (e instanceof RevisionConflict) return NextResponse.json({ error: e.message, code: 'version_conflict', current: e.current }, { status: 409 });
  if (e instanceof RevisionBlocked) return NextResponse.json({ error: e.message, code: 'review_blocked', issues: e.issues.map(({ rule, message, where }) => ({ rule, message, where })) }, { status: 422 });
  return apiError(e, scope);
}
