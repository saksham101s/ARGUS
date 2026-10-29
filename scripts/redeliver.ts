/**
 * Re-sends the most recent GitHub webhook delivery of a given event to the
 * App's configured URL (production), then prints the response — the same
 * as clicking "Redeliver" in the GitHub App settings. Safe to repeat: every
 * webhook write is idempotent, and a failed review is retried.
 *
 * Run: npm run redeliver -- <event>[.action]
 *   e.g. npm run redeliver -- pull_request.synchronize
 *        npm run redeliver -- installation.created
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const [event, action] = (process.argv[2] ?? '').split('.');
  if (!event) {
    console.error('Usage: npm run redeliver -- <event>[.action]');
    process.exit(1);
  }

  const { getAppClient } = await import('../lib/github/app');
  const app = getAppClient();

  // Original deliveries only — a redelivery of a redelivery is confusing.
  const { data: deliveries } = await app.apps.listWebhookDeliveries({ per_page: 100 });
  const target = deliveries.find(
    (d) => d.event === event && (!action || d.action === action) && !d.redelivery,
  );
  if (!target) {
    console.error(`No recent delivery for ${process.argv[2]}.`);
    process.exit(1);
  }

  console.log(
    `Redelivering ${target.event}.${target.action ?? ''} from ${target.delivered_at}…`,
  );
  await app.apps.redeliverWebhookDelivery({ delivery_id: target.id });

  // GitHub records the new attempt asynchronously; give it a moment.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data: latest } = await app.apps.listWebhookDeliveries({ per_page: 5 });
    const attempt = latest.find((d) => d.guid === target.guid && d.redelivery);
    if (attempt) {
      const { data: detail } = await app.apps.getWebhookDelivery({
        delivery_id: attempt.id,
      });
      console.log(`→ ${attempt.status_code} ${detail.response.payload ?? ''}`);
      console.log(
        'Background work (file fetch, indexing) continues on Vercel — check `npm run status`.',
      );
      return;
    }
  }
  console.log(
    'Redelivery requested, but no response recorded yet. Check `npm run status`.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
