
(() => {
  "use strict";

  function navigate() {
    const page = location.hash.slice(1).split("/")[0] || "overview";

    const sections = document.querySelectorAll("[data-section]");
    const target = Array.from(sections).find(
      section => section.dataset.section === page
    );

    if (!target) return;

    sections.forEach(section => {
      section.hidden = section !== target;
    });

    document.querySelectorAll("[data-page]").forEach(link => {
      const active = link.dataset.page === page;
      link.classList.toggle("active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    document.querySelector("#sidebar")?.classList.remove("open");
  }

  window.addEventListener("hashchange", navigate);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", navigate);
  } else {
    navigate();
  }
})();
