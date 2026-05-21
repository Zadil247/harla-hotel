export function LightboxImage(src, label, buttonClass = "") {
  return `
    <button class="image-zoom-button ${buttonClass}" type="button" data-lightbox-src="${src}" data-lightbox-label="${label}" aria-label="View ${label}">
      <img src="${src}" alt="${label}" loading="lazy" />
    </button>
  `;
}

export function LightboxMarkup(label = "Image viewer") {
  return `
    <div class="image-lightbox" data-room-lightbox hidden aria-modal="true" role="dialog" aria-label="${label}">
      <button class="lightbox-close" type="button" data-lightbox-close aria-label="Close image viewer">&times;</button>
      <figure>
        <img src="" alt="" data-lightbox-image />
        <figcaption data-lightbox-caption></figcaption>
      </figure>
    </div>
  `;
}

export function initImageLightbox(root = document) {
  const lightbox = root.querySelector("[data-room-lightbox]");
  const lightboxImage = root.querySelector("[data-lightbox-image]");
  const lightboxCaption = root.querySelector("[data-lightbox-caption]");
  const lightboxClose = root.querySelector("[data-lightbox-close]");
  let lastLightboxTrigger = null;

  if (!lightbox || !lightboxImage || !lightboxCaption || !lightboxClose) {
    return;
  }

  function openLightbox(trigger) {
    lastLightboxTrigger = trigger;
    lightboxImage.src = trigger.dataset.lightboxSrc;
    lightboxImage.alt = `${trigger.dataset.lightboxLabel} at Harla Hotel`;
    lightboxCaption.textContent = trigger.dataset.lightboxLabel;
    lightbox.hidden = false;
    document.body.classList.add("is-lightbox-open");
    lightboxClose.focus();
  }

  function closeLightbox() {
    if (lightbox.hidden) {
      return;
    }

    lightbox.hidden = true;
    document.body.classList.remove("is-lightbox-open");
    lightboxImage.removeAttribute("src");
    lightboxImage.alt = "";
    lightboxCaption.textContent = "";
    lastLightboxTrigger?.focus({ preventScroll: true });
  }

  root.querySelectorAll("[data-lightbox-src]").forEach((trigger) => {
    trigger.addEventListener("click", () => openLightbox(trigger));
  });

  lightboxClose.addEventListener("click", closeLightbox);

  lightbox.addEventListener("click", (event) => {
    const clickedImage = event.target === lightboxImage;
    const clickedClose = event.target.closest("[data-lightbox-close]");
    if (!clickedImage && !clickedClose) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  });
}
