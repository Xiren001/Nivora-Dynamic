if (!window.themeAccordionAnimationInit) {
  window.themeAccordionAnimationInit = true;

  const OPEN_DURATION = 300;
  const CLOSE_DURATION = 250;
  const EASING = 'ease';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animatingDetails = new WeakSet();

  const getContent = (details) => {
    const summary = details.querySelector(':scope > summary');
    return summary ? summary.nextElementSibling : null;
  };

  const expand = (details, content) => {
    details.setAttribute('open', '');
    animatingDetails.add(details);
    content.style.overflow = 'hidden';
    const endHeight = content.scrollHeight;
    const animation = content.animate([{ height: '0px' }, { height: `${endHeight}px` }], {
      duration: OPEN_DURATION,
      easing: EASING,
    });
    animation.onfinish = () => {
      content.style.overflow = '';
      content.style.height = '';
      animatingDetails.delete(details);
    };
  };

  const collapse = (details, content) => {
    animatingDetails.add(details);
    content.style.overflow = 'hidden';
    const startHeight = content.scrollHeight;
    const animation = content.animate([{ height: `${startHeight}px` }, { height: '0px' }], {
      duration: CLOSE_DURATION,
      easing: EASING,
    });
    animation.onfinish = () => {
      details.removeAttribute('open');
      content.style.overflow = '';
      content.style.height = '';
      animatingDetails.delete(details);
    };
  };

  document.addEventListener('click', (event) => {
    if (prefersReducedMotion) return;

    const summary = event.target.closest('summary');
    if (!summary) return;

    const details = summary.closest('details');
    if (!details || !details.closest('.accordion')) return;

    const content = getContent(details);
    if (!content) return;

    event.preventDefault();
    if (animatingDetails.has(details)) return;

    if (details.hasAttribute('open')) {
      collapse(details, content);
    } else {
      expand(details, content);
    }
  });
}
