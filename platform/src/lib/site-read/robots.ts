// robots.ts: o robots.txt do site manda (SPEC 033). Puro. Vale o grupo do nosso agente ou, sem ele, o "*"; a regra mais longa vence e, em
// empate, "Allow" vence. Aceita "*" e "$" nos caminhos.

type Rule = { allow: boolean; path: string };

function rulesFor(text: string, agent: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.slice(0, 200_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const at = line.indexOf(':');
    if (at < 1) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return pick.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split('*');
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      if (!path.startsWith(part)) return false;
      pos = part.length;
    } else {
      const found = path.indexOf(part, pos);
      if (found < 0) return false;
      pos = found + part.length;
    }
  }
  return anchored ? (parts.length === 1 ? path === body : path.endsWith(parts[parts.length - 1]) && pos <= path.length) : true;
}

export function robotsAllows(text: string, path: string, agent = 'ekoaibot'): boolean {
  let best: Rule | null = null;
  for (const rule of rulesFor(text, agent.toLowerCase())) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
