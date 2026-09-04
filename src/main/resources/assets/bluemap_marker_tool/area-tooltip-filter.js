/* Suppress empty area hover tooltips. */
(function () {
  "use strict";
  if (window.__blueMapMarkerEmptyTooltipFilterLoaded) return;
  window.__blueMapMarkerEmptyTooltipFilterLoaded = true;

  let scheduled = false;

  function hideIfEmpty() {
    scheduled = false;
    const tip = document.getElementById("xynTip");
    if (!tip || tip.style.display === "none") return;

    const title = tip.querySelector(".t")?.textContent?.trim() || "";
    const subtitle = tip.querySelector(".s")?.textContent?.trim() || "";
    if (!title && !subtitle) tip.style.display = "none";
  }

  window.addEventListener("pointermove", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(hideIfEmpty);
  }, true);
})();
