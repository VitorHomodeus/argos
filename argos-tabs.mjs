// P22: abas usam as mesmas ações de clique, inclusive as guardas existentes.
export function installArgosTabs(root, Observer = MutationObserver) {
  const lists = () => [...root.querySelectorAll('[role="tablist"]')];
  const tabs = list => [...list.querySelectorAll('[role="tab"]')]
    .filter(tab => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true');
  function sync() {
    for (const list of lists()) {
      const items = tabs(list);
      const selected = items.find(tab => tab.getAttribute('aria-selected') === 'true') || items[0];
      for (const tab of items) tab.tabIndex = tab === selected ? 0 : -1;
    }
  }
  root.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tab = event.target.closest('[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    if (!list) return;
    const vertical = list.getAttribute('aria-orientation') === 'vertical';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (![next, previous, 'Home', 'End'].includes(event.key)) return;
    const items = tabs(list), index = items.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === next ? 1 : items.length - 1)) % items.length;
    const listIndex = lists().indexOf(list);
    const target = items[destination];
    target.click();
    // O original recria o DOM ao trocar a etapa. Recuperar o foco no novo botão.
    sync();
    const updated = lists()[listIndex];
    if (updated) tabs(updated)[destination]?.focus();
  });
  sync();
  const observer = new Observer(sync);
  observer.observe(root.documentElement, { childList: true, subtree: true });
  return observer;
}

if (typeof document !== 'undefined') installArgosTabs(document);
