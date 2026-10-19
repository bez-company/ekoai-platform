import { CAPABILITIES, type PublishMode } from '@/lib/capabilities';

const MODE_LABEL: Record<PublishMode, string> = {
  auto: 'Publica sozinho',
  planned: 'Ainda não',
  manual: 'Manual',
};

const METRICS_LABEL = { api: 'Pela API', csv: 'CSV semanal', none: 'Sem métrica' } as const;

export default function CapabilityTable() {
  return (
    <div className="space-y-3">
      {Object.entries(CAPABILITIES).map(([id, ch]) => (
        <div key={id} className="card space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-medium">{ch.label}</h3>
            <span className="chip" title={ch.metrics.note}>Métricas: {METRICS_LABEL[ch.metrics.source]}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {Object.entries(ch.formats)
              .filter(([fmt]) => !(id === 'twitter' && fmt === 'text'))
              .map(([fmt, cap]) => (
                <li key={fmt} className="flex gap-3">
                  <span className="w-40 shrink-0">{cap.label}</span>
                  <span className={`w-28 shrink-0 ${cap.publish === 'auto' ? 'text-success' : cap.publish === 'manual' ? 'text-warning' : 'text-muted'}`}>
                    {MODE_LABEL[cap.publish]}
                  </span>
                  {cap.note && <span className="text-muted">{cap.note}</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
