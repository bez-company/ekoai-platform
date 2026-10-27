// notification-prefs.ts: leitura e gravação do que a pessoa quer receber (BEZ-366). Por pessoa, não por conta.

import { db } from './db';
import { mutedInApp, withDefaults, type Category, type CategoryPref } from './notification-prefs-model';

export async function getPrefs(userId: string): Promise<CategoryPref[]> {
  const { data, error } = await db().from('notification_preferences').select('category,in_app,email').eq('user_id', userId);
  if (error) throw new Error(`preferências de aviso: ${error.message}`);
  return withDefaults((data ?? []) as { category: string; in_app: boolean; email: boolean }[]);
}

// Muda só os canais enviados; o outro canal mantém o que estava.
export async function setPref(userId: string, change: { category: Category; inApp?: boolean; email?: boolean }): Promise<CategoryPref[]> {
  const current = (await getPrefs(userId)).find((p) => p.category === change.category)!;
  const { error } = await db()
    .from('notification_preferences')
    .upsert(
      { user_id: userId, category: change.category, in_app: change.inApp ?? current.inApp, email: change.email ?? current.email, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' },
    );
  if (error) throw new Error(`gravar preferência de aviso: ${error.message}`);
  return getPrefs(userId);
}

// As categorias que a pessoa desligou no app. Falha de leitura não esconde aviso: na dúvida, mostra.
export async function mutedCategories(userId: string | null) {
  if (!userId) return new Set<Category>();
  try {
    return mutedInApp(await getPrefs(userId));
  } catch {
    return new Set<Category>();
  }
}
