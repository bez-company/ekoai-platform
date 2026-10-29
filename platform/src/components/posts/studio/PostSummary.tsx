// PostSummary.tsx: o resumo do post (SPEC 030, protótipo v28). Mostra o que a pessoa escolheu: modelo, tipo, imagem, qualidade e tempo.
// Sem preço: o consumo de cada post aparece em Fatura e uso (SPEC 031).

import Link from 'next/link';
import { IMAGE_QUALITY, STYLES, levelOf, usesImage, type Effort, type ImageQuality } from '@/lib/studio/levels';

function styleName(style: string): string {
  if (style === 'auto') return 'A Ekoai escolhe';
  if (style === 'auto-minimalista') return 'A Ekoai escolhe, entre os minimalistas';
  if (style === 'auto-imagem') return 'A Ekoai escolhe, entre os com imagem';
  return STYLES.find((s) => s.id === style)?.name ?? 'A Ekoai escolhe';
}

export default function PostSummary({ effort, style, imageQuality }: { effort: Effort; style: string; imageQuality: ImageQuality }) {
  const level = levelOf(effort);
  const image = usesImage(style);
  return (
    <section className="card space-y-3" aria-label="Resumo do post">
      <h2 className="text-lg font-semibold">Resumo do post</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Modelo</dt>
        <dd>{styleName(style)}</dd>
        <dt className="text-muted">Tipo</dt>
        <dd>{image === 'maybe' ? 'Definido pelo modelo' : image === 'yes' ? 'Com imagem de fundo' : 'Minimalista, sem imagem de IA'}</dd>
        {image !== 'no' && (
          <>
            <dt className="text-muted">Imagem</dt>
            <dd>{IMAGE_QUALITY[imageQuality].name}</dd>
          </>
        )}
        <dt className="text-muted">Qualidade</dt>
        <dd>{level.name}</dd>
        <dt className="text-muted">Tempo</dt>
        <dd>{level.time}</dd>
      </dl>
      <Link href="/configuracoes/fatura" className="btn-ghost min-h-9 px-3 text-xs">
        Ver fatura e uso
      </Link>
    </section>
  );
}
