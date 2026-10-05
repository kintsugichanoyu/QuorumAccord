import { PROGRAM, readDevnet, usd } from './model.ts';

function element<K extends keyof HTMLElementTagNameMap>(name: K, value?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
const root = document.querySelector<HTMLElement>('#devnet-inspector');
if (root) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const output = root.querySelector<HTMLElement>('[data-output]')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Verifying devnet and reading confirmed accounts…';
    output.replaceChildren();
    void (async () => {
      try {
        const endpoint = new FormData(form).get('rpc');
        if (typeof endpoint !== 'string') throw new Error('Missing RPC URL');
        const state = await readDevnet(endpoint);
        status.textContent = `Confirmed RPC context slot ${state.context}. Read-only; not an exact historical snapshot.`;
        const grid = element('div', undefined, 'quorum-grid');
        for (const feed of state.prices) {
          const card = element('section', undefined, 'quorum-card');
          card.append(element('h3', feed.symbol), element('p', feed.view ? usd(feed.view.price) : 'Not initialized', 'quorum-price'),
            element('span', feed.view?.status.toUpperCase() ?? 'MISSING', `quorum-badge ${feed.view?.status ?? 'unset'}`));
          if (feed.view) card.append(element('p', `Tick ${feed.view.tick} · finalized slot ${feed.view.finalized}`));
          const link = element('a', 'Inspect feed ↗');
          link.href = `https://explorer.solana.com/address/${feed.address}?cluster=devnet`;
          link.rel = 'noopener noreferrer'; link.target = '_blank';
          card.append(link); grid.append(card);
        }
        output.append(grid);
        if (state.allocation) {
          output.append(element('h3', `Published allocation · round ${state.allocation.round}`),
            element('p', 'Test-only venue indices, not verified integrations with named lending protocols. No capital is moved.'));
          for (const [index, weight] of state.allocation.weights.entries()) {
            const row = element('div', undefined, 'quorum-weight');
            const label = element('span', `Venue ${index} · ${(weight / 100).toFixed(2)}%`);
            const meter = element('progress'); meter.max = 10_000; meter.value = weight;
            meter.setAttribute('aria-label', `Venue ${index}, ${weight} basis points`);
            row.append(label, meter); output.append(row);
          }
          output.append(element('p', `Allocation updated at slot ${state.allocation.updated}. This reader does not certify allocation freshness or financial safety.`));
        } else output.append(element('p', 'Allocation account is not initialized yet.'));
        output.append(element('p', `Test program: ${PROGRAM}`));
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Unable to read devnet';
      } finally { button.disabled = false; }
    })();
  });
  const snapshot = root.querySelector<HTMLElement>('[data-snapshot]')!;
  void fetch('evidence/latest-devnet.json').then(async response => {
    if (!response.ok) throw new Error('No published verification snapshot');
    const data = await response.json() as { status?: string; completed_at?: string; verification?: { integration_scenarios_passed?: number } };
    snapshot.textContent = `Recorded test status: ${data.status ?? 'unknown'} · ${data.completed_at ?? 'date unavailable'}${data.verification?.integration_scenarios_passed ? ` · ${data.verification.integration_scenarios_passed} scenarios passed` : ''}. This snapshot is not a live price read.`;
  }).catch(() => { snapshot.textContent = 'Recorded verification snapshot unavailable. Live RPC reads remain available.'; });
}
