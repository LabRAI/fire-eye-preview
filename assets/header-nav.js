(() => {
  const trigger = document.getElementById('header-more-open');
  const links = document.getElementById('header-more-links');
  if (!trigger || !links) return;
  const header = trigger.closest('.masthead');
  const compact = window.matchMedia('(max-width: 640px)');
  const close = (restoreFocus = false) => {
    links.classList.remove('is-open');
    header?.classList.remove('navigation-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  trigger.addEventListener('click', () => {
    if (!compact.matches) return;
    const open = trigger.getAttribute('aria-expanded') !== 'true';
    links.classList.toggle('is-open', open);
    header?.classList.toggle('navigation-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!links.contains(event.target) && !trigger.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      close(true);
    }
  });
  links.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) close();
  });
  document.addEventListener('focusin', (event) => {
    if (!links.contains(event.target) && !trigger.contains(event.target)) close();
  });
  compact.addEventListener('change', () => close());
})();
