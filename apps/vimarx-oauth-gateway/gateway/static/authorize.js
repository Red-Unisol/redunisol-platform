(() => {
  const form = document.querySelector("form[data-busy-label]");
  if (!form) return;
  let busy = false;
  const buttons = [...form.querySelectorAll("button")];
  const labels = buttons.map(button => button.textContent);
  form.addEventListener("submit", event => {
    if (busy) { event.preventDefault(); return; }
    busy = true;
    form.setAttribute("aria-busy", "true");
    buttons.forEach(button => button.setAttribute("aria-disabled", "true"));
    // Keep the submitter enabled so its approve=yes/no value is still posted.
    if (event.submitter) event.submitter.textContent = form.dataset.busyLabel;
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    busy = false;
    form.removeAttribute("aria-busy");
    buttons.forEach((button, index) => {
      button.removeAttribute("aria-disabled");
      button.textContent = labels[index];
    });
  });
})();
