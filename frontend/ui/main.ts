const menu = document.querySelector<HTMLButtonElement>('.menu-toggle');
const navigation = document.querySelector<HTMLElement>('#navigation');
function closeMenu() {
  navigation?.classList.remove('open');
  menu?.setAttribute('aria-expanded', 'false');
}
menu?.addEventListener('click', () => {
  const open = navigation?.classList.toggle('open') ?? false;
  menu.setAttribute('aria-expanded', String(open));
});
navigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });

const scenarios = document.querySelectorAll<HTMLButtonElement>('[data-scenario]');
scenarios.forEach(button => button.addEventListener('click', () => {
  const reached = button.dataset.scenario === 'reached';
  scenarios.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('.consensus-demo')?.classList.toggle('below', !reached);
  document.querySelectorAll('.operator').forEach((operator, index) => operator.classList.toggle('inactive', !reached && index >= 3));
  const votes = document.querySelector('[data-votes]');
  if (votes) votes.textContent = reached ? '6 of 6 votes' : '3 of 6 votes';
  const result = document.querySelector('[data-result]');
  if (result) {
    // Same floor-rounded even median as the Rust aggregate_scalar example.
    const observations = [523n, 524n, 525n, 526n, 527n, 528n];
    const median = (observations[2]! + observations[3]!) / 2n;
    const status = document.createElement('span');
    status.className = 'published-label';
    status.textContent = reached ? 'Published' : 'No publication';
    result.replaceChildren(reached ? `${median} bps ` : 'Quorum unmet ', status);
  }
  const note = document.querySelector('[data-demo-note]');
  if (note) note.textContent = reached
    ? 'Example after window close, with publication triggers met. No network connection.'
    : '3 votes fall below the minimum of 4. The previously published value is retained.';
}));

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function selectTab(tab: HTMLButtonElement) {
  tabs.forEach(item => {
    const selected = tab === item;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls') ?? '');
    if (panel) panel.hidden = !selected;
  });
  const producer = tab.id === 'producer-tab';
  const title = document.querySelector('[data-code-title]');
  if (title) title.textContent = `QUORUM / ${producer ? 'PRODUCER' : 'CONSUMER'}`;
  const description = document.querySelector('[data-role-description]');
  if (description) description.textContent = producer
    ? 'Read one source. Publish one metric. Run independently.'
    : 'Read published feeds. Apply the rubric. Submit allocation weights.';
  const setup = document.querySelector<HTMLAnchorElement>('.code-bottom a');
  if (setup) setup.href = `book/workers.html#configure-a-${producer ? 'producer' : 'consumer'}`;
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next]?.focus();
    if (tabs[next]) selectTab(tabs[next]);
  });
});
document.querySelector('.copy-button')?.addEventListener('click', async () => {
  const code = document.querySelector('[role="tabpanel"]:not([hidden]) pre')?.textContent;
  const status = document.querySelector('[data-copy-status]');
  if (!code || !status) return;
  try {
    await navigator.clipboard.writeText(code);
    status.textContent = 'Worker command copied';
  } catch {
    status.textContent = 'Copy unavailable. Select the command to copy it manually.';
  }
});
